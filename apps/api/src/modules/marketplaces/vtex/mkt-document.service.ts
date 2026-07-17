import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import PDFDocument from 'pdfkit';

import type { VtexOrderDetail } from './vtex.types';

const TZ = 'America/Bogota';
/** Numeros y fechas como los imprime VTEX en español (COP 1.450.000,00 / 15/9/2025, 10:51 p. m.). */
const LOCALE = 'es-CO';
const DOC_LABEL: Record<string, string> = {
  CC: 'Cédula de Ciudadanía',
  NIT: 'NIT',
  CNPJ: 'NIT',
  CE: 'Cédula de Extranjería',
  PASSPORT: 'Pasaporte',
};

// Acceso laxo al detalle de VTEX (tiene index signature; leemos campos extra).
type Any = Record<string, any>;

/**
 * Genera el "MKT" (el documento Print order de VTEX) como PDF, IDENTICO al que
 * imprime VTEX. Se arma con pdfkit (Helvetica ~ Arial, US Letter) a partir del
 * detalle del pedido — validado 1:1 contra el original. 2 paginas: resumen del
 * pedido + factura/producto (con la imagen del producto de `items[].imageUrl`).
 *
 * Textos y formatos copiados del Print order REAL de VTEX en español
 * (MKT-1561962373865-01.pdf). Unica desviacion deliberada: el tipo de documento.
 * VTEX en español imprime ahi su clave de traduccion sin traducir
 * ("profile-form.field.COL_cedula"); nosotros ponemos "Cédula de Ciudadanía"
 * (ver DOC_LABEL), que es lo que VTEX muestra en ingles y lo unico legible.
 */
@Injectable()
export class MktDocumentService {
  private readonly logger = new Logger(MktDocumentService.name);

  async build(detail: VtexOrderDetail): Promise<Buffer> {
    const o = detail as unknown as Any;
    const cp: Any = o.clientProfileData ?? {};
    const a: Any = o.shippingData?.address ?? {};
    const li: Any = o.shippingData?.logisticsInfo?.[0] ?? {};
    const item: Any = o.items?.[0] ?? {};
    const totals: Record<string, number> = Object.fromEntries(
      (o.totals ?? []).map((t: Any) => [t.id, t.value]),
    );
    const pkg: Any = o.packageAttachment?.packages?.[0] ?? {};
    const pay: Any = o.paymentData?.transactions?.[0]?.payments?.[0] ?? {};
    const whId: string = li.deliveryIds?.[0]?.warehouseId ?? item.warehouseId ?? '';

    const img = await this.fetchImage(item.imageUrl);

    // === Layout ===
    const M = 57;
    const RX = 555;
    const VX = 250;
    const W = RX - M;
    const BLACK = '#000000';
    const GRAY = '#3a3a3a';
    const LINE = '#d0d0d0';

    const doc = new PDFDocument({ size: 'letter', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    let y = 0;
    const bar = (): void => {
      doc.rect(M, y, W, 3.5).fill(BLACK);
      y += 3.5;
    };
    const hline = (): void => {
      doc.moveTo(M, y).lineTo(RX, y).lineWidth(0.5).strokeColor(LINE).stroke();
    };
    const sectionTitle = (t: string): void => {
      y += 14;
      bar();
      y += 6;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK).text(t, M, y);
      y += 13;
      hline();
    };
    const row = (label: string, value: string): void => {
      // VTEX no imprime la fila cuando el pedido no trae el dato (p.ej. una
      // direccion sin "Información adicional"): omite etiqueta y todo. Si
      // pintaramos una fila vacia, ademas de sobrar, correria todo lo de abajo.
      if (!value.trim()) return;
      const pad = 5;
      doc.font('Helvetica').fontSize(9.5);
      const lh = doc.heightOfString(label, { width: VX - M - 12 });
      const vh = doc.heightOfString(value, { width: RX - VX });
      const h = Math.max(lh, vh);
      const ty = y + pad;
      doc.fillColor(GRAY).text(label, M, ty, { width: VX - M - 12 });
      doc.fillColor(BLACK).text(value, VX, ty, { width: RX - VX });
      y = ty + h + pad;
      hline();
    };

    // ===== PAGINA 1 =====
    y = 57;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Pedido nro.', M, y);
    y += 12;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BLACK).text(String(o.orderId ?? ''), M, y);
    y += 24;

    sectionTitle('Pedido');
    row('Fecha de creación', this.dtFull(o.creationDate));
    row('Status del pedido', 'Facturado');
    row('Integrado vía', `${o.marketplace?.name ?? ''} (${o.marketplaceOrderId ?? ''})`);

    sectionTitle('Cliente');
    row('Nombre', `${cp.firstName ?? ''} ${cp.lastName ?? ''}`.trim());
    row(DOC_LABEL[cp.documentType] ?? cp.documentType ?? 'Documento', String(cp.document ?? ''));
    row('Teléfono', this.phone(cp.phone));
    row('Email', String(cp.email ?? ''));

    sectionTitle('Dirección de envío');
    row('Dirección', [a.street, a.number].filter(Boolean).join(' '));
    row('Información adicional', String(a.complement ?? ''));
    row('Barrio', String(a.neighborhood ?? ''));
    row('Ciudad & Estado', [a.city, a.state].filter(Boolean).join(', '));
    row('Código postal', String(a.postalCode ?? ''));
    row('País', String(a.country ?? ''));
    row('Coordenadas geográficas', (a.geoCoordinates ?? []).join(', '));

    sectionTitle('Destinatario');
    row('Destinatario Nombre', String(a.receiverName ?? ''));

    sectionTitle('Valores');
    row('Artículos', this.money(totals.Items ?? 0));
    row('Valor final', this.money(o.value ?? 0));

    sectionTitle('Pago');
    row(
      'Método',
      `${pay.paymentSystemName ?? ''}\n${pay.installments ?? 1}x ${this.money(pay.value ?? 0)} = ${this.money(pay.value ?? 0)}`,
    );
    row('Autorización de gateway', this.dtNoComma(o.authorizedDate));

    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(`Pedido nro. ${o.orderId} (${o.sequence})`, M, 748);

    // ===== PAGINA 2 =====
    doc.addPage({ size: 'letter', margin: 0 });
    y = 57;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(BLACK)
      .text(`Factura - 1 de 1 (${o.items?.length ?? 1} artículos)`, M, y);
    y += 13;
    hline();
    row('Factura', String(pkg.invoiceNumber ?? ''));
    row('Entrega hasta el', li.shippingEstimateDate ? this.dateOnly(li.shippingEstimateDate) : '');
    row('Entregado por', String(pkg.courier ?? li.deliveryCompany ?? ''));
    row('Tipo', String(li.selectedSla ?? ''));

    y += 14;
    bar();
    y += 6;
    row('Total de artículos', this.money(totals.Items ?? 0));
    row('Valores extra', this.money((totals.Shipping ?? 0) + (totals.Tax ?? 0)));
    row('Valor', this.money(pkg.invoiceValue ?? o.value ?? 0));

    // Tabla de producto
    y += 14;
    bar();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK);
    doc.text('Producto', M, y);
    doc.text('Cant.', 400, y);
    doc.text('Valor total', 470, y);
    y += 15;
    hline();
    y += 12;

    const imgW = 42;
    if (img) {
      try {
        doc.image(img, M, y, { width: imgW, height: imgW });
      } catch {
        /* imagen invalida — se omite */
      }
    }
    const tx = M + imgW + 12;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK).text(String(item.name ?? ''), tx, y, { width: 330 });
    let ty2 = doc.y + 2;
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(`SKU ${item.id ?? ''}`, tx, ty2);
    doc.text(`Ref. ${item.refId ?? ''}`, tx + 70, ty2, { width: 260 });
    ty2 = doc.y + 1;
    doc.text(`Almacén: ${whId}`, tx, ty2);
    ty2 = doc.y + 3;
    doc.text(`${this.money(item.price ?? 0)} / un`, tx, ty2);
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(`${item.quantity ?? 1} un`, 400, y + 20);
    doc.text(this.money((item.price ?? 0) * (item.quantity ?? 1)), 470, y + 20);

    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(`Pedido nro. ${o.orderId} (${o.sequence})`, M, 748);
    doc.end();
    return done;
  }

  private async fetchImage(url: unknown): Promise<Buffer | null> {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
    try {
      const r = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 15_000 });
      return Buffer.from(r.data);
    } catch (err) {
      this.logger.warn(`No se pudo traer la imagen del producto: ${(err as Error).message}`);
      return null;
    }
  }

  /** "COP 1.450.000,00" — miles con punto y decimales con coma, como VTEX en español. */
  private money(cents: unknown): string {
    const n = Number(cents) / 100;
    return `COP ${(Number.isFinite(n) ? n : 0).toLocaleString(LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  /** "15/9/2025, 10:51 p. m." — dia/mes/año, como VTEX en español. */
  private dtFull(iso: unknown): string {
    if (!iso) return '';
    return new Date(String(iso)).toLocaleString(LOCALE, {
      timeZone: TZ,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  private dtNoComma(iso: unknown): string {
    return this.dtFull(iso).replace(',', '');
  }
  private dateOnly(iso: unknown): string {
    if (!iso) return '';
    return new Date(String(iso)).toLocaleDateString(LOCALE, {
      timeZone: TZ,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
  }
  private phone(p: unknown): string {
    const d = String(p ?? '')
      .replace(/\D/g, '')
      .replace(/^57(?=\d{10}$)/, '');
    return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p ?? '');
  }
}
