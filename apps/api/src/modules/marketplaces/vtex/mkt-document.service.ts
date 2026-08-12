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
 * Genera el "MKT" (el documento Print order de VTEX) como PDF en UNA SOLA
 * PAGINA (pedido del negocio, calcado de MKT MUESTRA.pdf): resumen + cliente +
 * direccion + valores + pago + factura + tabla de producto, con metricas
 * compactas para que todo quepa en un Letter. Se arma con pdfkit (Helvetica ~
 * Arial) a partir del detalle del pedido.
 *
 * Textos y formatos copiados del Print order REAL de VTEX en español. Unica
 * desviacion deliberada: el tipo de documento. VTEX en español imprime su clave
 * de traduccion sin traducir ("profile-form.field.COL_cedula"); nosotros
 * ponemos "Cédula de Ciudadanía" (DOC_LABEL), lo unico legible.
 */
@Injectable()
export class MktDocumentService {
  private readonly logger = new Logger(MktDocumentService.name);

  async build(detail: VtexOrderDetail): Promise<Buffer> {
    const o = detail as unknown as Any;
    const cp: Any = o.clientProfileData ?? {};
    const a: Any = o.shippingData?.address ?? {};
    const li: Any = o.shippingData?.logisticsInfo?.[0] ?? {};
    const items: Any[] = Array.isArray(o.items) && o.items.length > 0 ? o.items : [{}];
    const totals: Record<string, number> = Object.fromEntries(
      (o.totals ?? []).map((t: Any) => [t.id, t.value]),
    );
    const pkg: Any = o.packageAttachment?.packages?.[0] ?? {};
    const pay: Any = o.paymentData?.transactions?.[0]?.payments?.[0] ?? {};
    const conn: Any = pay.connectorResponses ?? {};

    // Imagenes de los productos (en paralelo, best-effort).
    const imgs = await Promise.all(items.map((it) => this.fetchImage(it.imageUrl)));

    // === Layout (compacto: TODO en una pagina Letter) ===
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
      doc.rect(M, y, W, 3).fill(BLACK);
      y += 3;
    };
    const hline = (): void => {
      doc.moveTo(M, y).lineTo(RX, y).lineWidth(0.5).strokeColor(LINE).stroke();
    };
    const sectionTitle = (t: string, withBar = true): void => {
      y += 7;
      if (withBar) {
        bar();
        y += 3;
      }
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK).text(t, M, y);
      y += 11;
      hline();
    };
    const row = (label: string, value: string): void => {
      // VTEX no imprime la fila cuando el pedido no trae el dato (p.ej. una
      // direccion sin "Información adicional"): omite etiqueta y todo. Si
      // pintaramos una fila vacia, ademas de sobrar, correria todo lo de abajo.
      if (!value.trim()) return;
      const pad = 2;
      doc.font('Helvetica').fontSize(8);
      const lh = doc.heightOfString(label, { width: VX - M - 12 });
      const vh = doc.heightOfString(value, { width: RX - VX });
      const h = Math.max(lh, vh);
      const ty = y + pad;
      doc.fillColor(GRAY).text(label, M, ty, { width: VX - M - 12 });
      doc.fillColor(BLACK).text(value, VX, ty, { width: RX - VX });
      y = ty + h + pad;
      hline();
    };

    // ===== UNICA PAGINA =====
    y = 30;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Pedido nro.', M, y);
    y += 10;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLACK).text(String(o.orderId ?? ''), M, y);
    y += 17;

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

    // Como en la muestra: subtitulo SIN barra (subseccion de la direccion).
    sectionTitle('Destinatario', false);
    row('Destinatario Nombre', String(a.receiverName ?? ''));

    sectionTitle('Valores');
    row('Artículos', this.money(totals.Items ?? 0));
    row('Envío', totals.Shipping ? this.money(totals.Shipping) : '');
    row('Valor final', this.money(o.value ?? 0));

    sectionTitle('Pago');
    row(
      'Método',
      `${pay.paymentSystemName ?? ''}\n${pay.installments ?? 1}x ${this.money(pay.value ?? 0)} = ${this.money(pay.value ?? 0)}`,
    );
    row('Adquirente', String(conn.acquirer ?? ''));
    row('Autorización de gateway', this.dtNoComma(o.authorizedDate));
    row('ID de la transacción', String(pay.tid ?? conn.tid ?? ''));
    row('Retailer', String(o.sellers?.[0]?.name ?? ''));

    sectionTitle(`Factura - 1 de 1 (${items.length} artículos)`);
    row('Factura', String(pkg.invoiceNumber ?? ''));
    row('Entrega hasta el', li.shippingEstimateDate ? this.dateOnly(li.shippingEstimateDate) : '');
    row('Entregado por', String(pkg.courier ?? li.deliveryCompany ?? ''));
    row('Tipo', String(li.selectedSla ?? ''));

    y += 5;
    hline();
    row('Total de artículos', this.money(totals.Items ?? 0));
    row('Valores extra', this.money((totals.Shipping ?? 0) + (totals.Tax ?? 0)));
    row('Valor', this.money(pkg.invoiceValue ?? o.value ?? 0));

    // Tabla de producto(s)
    y += 7;
    bar();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
    doc.text('Producto', M, y);
    doc.text('Cant.', 400, y);
    doc.text('Valor total', 470, y);
    y += 12;
    hline();
    y += 6;

    const imgW = 32;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const whId: string = li.deliveryIds?.[0]?.warehouseId ?? item.warehouseId ?? '';
      const rowTop = y;
      if (imgs[i]) {
        try {
          doc.image(imgs[i]!, M, y, { width: imgW, height: imgW });
        } catch {
          /* imagen invalida — se omite */
        }
      }
      const tx = M + imgW + 10;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text(String(item.name ?? ''), tx, y, { width: 330 });
      let ty2 = doc.y + 2;
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(`SKU ${item.id ?? ''}`, tx, ty2);
      doc.text(`Ref. ${item.refId ?? ''}`, tx + 70, ty2, { width: 260 });
      ty2 = doc.y + 1;
      doc.text(`Almacén: ${whId}`, tx, ty2);
      ty2 = doc.y + 2;
      doc.text(`${this.money(item.price ?? 0)} / un`, tx, ty2);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`${item.quantity ?? 1} un`, 400, rowTop + 14);
      doc.text(this.money((item.price ?? 0) * (item.quantity ?? 1)), 470, rowTop + 14);
      y = Math.max(doc.y, rowTop + imgW) + 8;
    }

    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Pedido nro. ${o.orderId} (${o.sequence})`, M, 760);
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
