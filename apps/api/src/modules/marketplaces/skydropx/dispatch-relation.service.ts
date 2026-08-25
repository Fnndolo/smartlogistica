import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { code128Widths } from './code128';

/**
 * RELACION DE DESPACHO de Inter Rapidisimo, calcada del PDF que emite el panel
 * de Skydropx (su API no lo expone: probado endpoint por endpoint). Es el
 * comprobante que FIRMA el recolector al recibir el paquete, uno por guia, y
 * solo aplica a Inter Rapidisimo.
 *
 * El layout replica la muestra: horizontal, tres bloques con cabecera gris
 * (ORIGEN / PAQUETES / DETALLES) y las casillas de firma abajo.
 */

export interface DispatchAddress {
  company: string | null;
  name: string | null;
  taxId: string | null;
  street: string | null;
  /** Complemento (interior, oficina, referencia). */
  extra: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
}

export interface DispatchRelationInput {
  /** Numero de la relacion (arriba a la derecha). */
  relationNumber: string;
  trackingNumber: string;
  from: DispatchAddress;
  to: DispatchAddress;
  content: string;
  weightKg: number;
  length: number;
  width: number;
  height: number;
  packages: number;
}

// Paleta y metricas de la muestra.
const HEAD_BG = '#d9d9d9';
const CELL_BG = '#f2f2f2';
const LINE = '#7f7f7f';
const INK = '#000000';

@Injectable()
export class DispatchRelationService {
  /** Arma el PDF. Devuelve el buffer listo para adjuntar al chat. */
  async build(input: DispatchRelationInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const M = 26; // margen
    const W = doc.page.width - M * 2;
    /** Anchos como FRACCION del ancho util: la muestra se midio en pixeles y
     *  asi el documento escala exacto a la hoja (carta horizontal). */
    const w = (frac: number): number => Math.round(W * frac * 100) / 100;
    let y = 34;

    // ===== Titulo + caja del numero de relacion =====
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(INK)
      .text('Relación de despachos Inter Rapidísimo', M + w(0.1), y, { width: w(0.42) });

    const boxX = M + w(0.547);
    const boxLabel = w(0.269);
    const boxVal = W - w(0.547) - boxLabel;
    this.cell(doc, boxX, y - 6, boxLabel, 16, 'Relación de despachos núm.', { bold: true, bg: null, size: 7 });
    this.cell(doc, boxX + boxLabel, y - 6, boxVal, 16, input.relationNumber, { size: 7 });
    this.cell(doc, boxX, y + 10, boxLabel, 16, 'Fecha', { bold: true, bg: null, size: 7 });
    this.cell(doc, boxX + boxLabel, y + 10, boxVal, 16, '', {});
    y += 40;

    // ===== INFORMACION DE ORIGEN =====
    this.band(doc, M, y, W, 'INFORMACIÓN DE ORIGEN');
    y += 15;

    const f = input.from;
    const r1 = 22;
    const LBL = w(0.131); // ancho de las etiquetas de la izquierda
    // Compañia | valor | Nombre | valor | Num. de identificacion | valor
    let x = M;
    this.cell(doc, x, y, LBL, r1, 'Compañía', { bold: true, bg: CELL_BG, size: 7.5 });
    x += LBL;
    this.cell(doc, x, y, w(0.2), r1, f.company ?? '', { size: 7.5 });
    x += w(0.2);
    this.cell(doc, x, y, w(0.086), r1, 'Nombre', { bold: true, bg: CELL_BG, size: 7.5 });
    x += w(0.086);
    this.cell(doc, x, y, w(0.167), r1, f.name ?? '', { size: 7.5 });
    x += w(0.167);
    this.cell(doc, x, y, w(0.166), r1, 'Num. de identificación', { bold: true, bg: CELL_BG, size: 7.5 });
    x += w(0.166);
    this.cell(doc, x, y, M + W - x, r1, f.taxId ?? '', { size: 7.5 });
    y += r1;

    // Direccion | valor (ancho) | Codigo postal | valor
    x = M;
    this.cell(doc, x, y, LBL, r1, 'Dirección', { bold: true, bg: CELL_BG, size: 7.5 });
    x += LBL;
    this.cell(doc, x, y, w(0.441), r1, this.fullAddress(f), { size: 6.8 });
    x += w(0.441);
    this.cell(doc, x, y, w(0.178), r1, 'Código postal', { bold: true, bg: CELL_BG, size: 7.5 });
    x += w(0.178);
    this.cell(doc, x, y, M + W - x, r1, f.postalCode ?? '', { size: 7.5 });
    y += r1;

    // Correo | valor | Telefono | valor
    x = M;
    this.cell(doc, x, y, LBL, r1, 'Correo electrónico', { bold: true, bg: CELL_BG, size: 7.5 });
    x += LBL;
    this.cell(doc, x, y, w(0.2), r1, f.email ?? '', { size: 7.5 });
    x += w(0.2);
    this.cell(doc, x, y, w(0.116), r1, 'Número de teléfono', { bold: true, bg: CELL_BG, size: 7.5 });
    x += w(0.116);
    this.cell(doc, x, y, M + W - x, r1, f.phone ?? '', { size: 7.5 });
    y += r1 + 5;

    // ===== INFORMACION DE LOS PAQUETES =====
    this.band(doc, M, y, W, 'INFORMACIÓN DE LOS PAQUETES');
    y += 15;

    // Anchos de columna, en las mismas proporciones de la muestra (suman W).
    const cols = [w(0.2), w(0.202), w(0.196), w(0.196), w(0.103)];
    cols.push(W - cols.reduce((s, n) => s + n, 0));
    const heads = [
      'Referencia',
      'Destino',
      'Descripción',
      'Peso y dimensiones',
      'Cantidad de paquetes',
      'Marca X si fue recolectado',
    ];
    let cx = M;
    for (let i = 0; i < cols.length; i++) {
      this.cell(doc, cx, y, cols[i], 16, heads[i], { bold: true, bg: CELL_BG, center: true, size: 7 });
      cx += cols[i];
    }
    y += 16;

    // Fila del paquete (alta: cabe el codigo de barras y la direccion larga)
    const rowH = 78;
    cx = M;
    for (const w of cols) {
      doc.rect(cx, y, w, rowH).lineWidth(0.5).strokeColor(LINE).stroke();
      cx += w;
    }
    // 1) Referencia: codigo de barras + numero
    this.barcode(doc, input.trackingNumber, M + 22, y + 12, cols[0] - 44, 34);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(INK)
      .text(input.trackingNumber, M, y + 52, { width: cols[0], align: 'center' });
    // 2) Destino
    doc
      .font('Helvetica')
      .fontSize(7)
      .text(this.destinationLine(input.to), M + cols[0] + 6, y + 14, {
        width: cols[1] - 12,
        align: 'center',
      });
    // 3) Descripcion
    doc
      .fontSize(7.5)
      .text(input.content, M + cols[0] + cols[1], y + rowH / 2 - 4, { width: cols[2], align: 'center' });
    // 4) Peso y dimensiones
    const dims = `${this.n(input.weightKg)}kg, ${this.n(input.length)}x${this.n(input.width)}x${this.n(input.height)}`;
    doc.text(dims, M + cols[0] + cols[1] + cols[2], y + rowH / 2 - 4, { width: cols[3], align: 'center' });
    // 5) Cantidad
    doc.text(String(input.packages), M + cols[0] + cols[1] + cols[2] + cols[3], y + rowH / 2 - 4, {
      width: cols[4],
      align: 'center',
    });
    // 6) Casilla de recolectado
    const chkX = M + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + cols[5] / 2 - 7;
    doc.rect(chkX, y + rowH / 2 - 7, 14, 14).lineWidth(1).strokeColor('#3f3f3f').stroke();
    y += rowH + 6;

    // ===== DETALLES =====
    this.band(doc, M, y, W, 'DETALLES DE RELACIÓN DE DESPACHOS');
    y += 15;

    const dCols = [w(0.241), w(0.257), w(0.249)];
    dCols.push(W - dCols.reduce((s, n) => s + n, 0));
    const dHeads = ['Descripción de los valores', 'Observaciones', 'Cliente', 'Recolector'];
    cx = M;
    for (let i = 0; i < dCols.length; i++) {
      this.cell(doc, cx, y, dCols[i], 16, dHeads[i], { bold: true, bg: CELL_BG, center: true, size: 7 });
      cx += dCols[i];
    }
    y += 16;

    // Mini-tabla de totales (izquierda)
    const volume = (input.length * input.width * input.height) / 2000;
    const rows: Array<[string, string]> = [
      ['Total en peso', `${this.n(input.weightKg)} kg`],
      ['Total en volumen', this.n(volume)],
      ['Total de paquetes', String(input.packages)],
      ['Creado por', 'Skydropx'],
      ['Número de placa', ''],
    ];
    const rh = 21;
    const blockH = rh * rows.length;
    const miniLbl = w(0.122);
    let ry = y;
    for (const [k, v] of rows) {
      this.cell(doc, M, ry, miniLbl, rh, k, { bold: true, bg: CELL_BG, size: 7.5 });
      this.cell(doc, M + miniLbl, ry, dCols[0] - miniLbl, rh, v, { size: 7.5 });
      ry += rh;
    }
    // Celdas grandes: observaciones y las dos firmas
    let dx = M + dCols[0];
    for (let i = 1; i < dCols.length; i++) {
      doc.rect(dx, y, dCols[i], blockH).lineWidth(0.5).strokeColor(LINE).stroke();
      if (i >= 2) {
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#404040')
          .text('Nombre / Firma / fecha', dx, y + blockH - 14, { width: dCols[i], align: 'center' });
      }
      dx += dCols[i];
    }

    doc.end();
    return done;
  }

  /** Banda gris de seccion, con el titulo centrado. */
  private band(doc: PDFKit.PDFDocument, x: number, y: number, w: number, title: string): void {
    doc.rect(x, y, w, 15).fill(HEAD_BG);
    doc.rect(x, y, w, 15).lineWidth(0.5).strokeColor(LINE).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(INK)
      .text(title, x, y + 4, { width: w, align: 'center' });
  }

  /** Celda con borde, relleno opcional y texto centrado verticalmente. */
  private cell(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    opts: { bold?: boolean; bg?: string | null; center?: boolean; size?: number },
  ): void {
    if (opts.bg) doc.rect(x, y, w, h).fill(opts.bg);
    doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE).stroke();
    const size = opts.size ?? 8;
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(INK);
    const th = doc.heightOfString(text || ' ', { width: w - 10 });
    doc.text(text || '', x + 5, y + Math.max(2, (h - th) / 2), {
      width: w - 10,
      align: opts.center ? 'center' : 'left',
      lineGap: 0,
    });
  }

  /** Code 128 dibujado como barras (sin dependencias). */
  private barcode(
    doc: PDFKit.PDFDocument,
    value: string,
    x: number,
    y: number,
    maxW: number,
    h: number,
  ): void {
    const widths = code128Widths(value);
    const modules = widths.reduce((s, n) => s + n, 0);
    const unit = maxW / modules;
    let cx = x;
    let isBar = true; // el patron arranca en barra y alterna
    doc.fillColor(INK);
    for (const w of widths) {
      if (isBar) doc.rect(cx, y, unit * w, h).fill(INK);
      cx += unit * w;
      isBar = !isBar;
    }
  }

  /** "CALLE 1 # 2-3, OFICINA 4, CIUDAD, DEPTO, 050015, Colombia" */
  private fullAddress(a: DispatchAddress): string {
    return [a.street, a.extra, a.city, a.state, a.postalCode, 'Colombia']
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }

  /** "NOMBRE / CORREO / TELEFONO / direccion completa" (como la muestra). */
  private destinationLine(a: DispatchAddress): string {
    return [a.name, a.email, a.phone, this.fullAddress(a)]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(' / ');
  }

  /** Numeros como en la muestra: un decimal siempre (1 -> "1.0"). */
  private n(v: number): string {
    return Number.isFinite(v) ? v.toFixed(1) : '0.0';
  }
}
