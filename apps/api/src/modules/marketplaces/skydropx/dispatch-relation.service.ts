import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { code128Widths } from './code128';

/**
 * RELACION DE DESPACHO de Inter Rapidisimo. Es el comprobante que FIRMA el
 * recolector al recibir el paquete: uno por guia, y solo esa transportadora lo
 * exige. Su API no lo expone (probado endpoint por endpoint), asi que se
 * reconstruye igual que el MKT de VTEX.
 *
 * La geometria NO esta a ojo: se extrajeron las coordenadas, tamaños y fuentes
 * del PDF original con pdfjs y se reproducen aqui en puntos absolutos sobre A4
 * horizontal (842x595). Detalle clave del original: en las celdas de la fila
 * del paquete el texto NO va centrado verticalmente — se ancla ABAJO y crece
 * hacia arriba, asi que la ultima linea queda pegada al borde inferior.
 */

export interface DispatchAddress {
  company: string | null;
  name: string | null;
  taxId: string | null;
  street: string | null;
  extra: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
}

export interface DispatchRelationInput {
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

const PAGE_W = 842;
const PAGE_H = 595;
const L = 26; // borde izquierdo de las tablas
const R = 816; // borde derecho

const BAND_BG = '#d9d9d9';
const CELL_BG = '#f2f2f2';
const STROKE = '#808080';
const INK = '#000000';

/** Ascendente de Helvetica: convierte una LINEA BASE del original al eje de
 *  pdfkit, que posiciona por el borde superior del texto. */
const ASC = 0.718;

@Injectable()
export class DispatchRelationService {
  async build(i: DispatchRelationInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // ===== Titulo =====
    this.text(doc, 'Relación de despachos Inter Rapidísimo', 127, 550.3, 10.8, true);

    // ===== Caja del numero de relacion (arriba a la derecha) =====
    const boxLabelX = 463;
    const boxValX = 677.9;
    this.box(doc, boxLabelX, 548.5, boxValX - boxLabelX, 10.2, CELL_BG);
    this.box(doc, boxValX, 548.5, R - boxValX, 10.2, null);
    this.text(doc, 'Relación de despachos núm.', 466.8, 553.3, 5.4, true);
    this.text(doc, i.relationNumber, 681.7, 553.3, 5.4, false);
    this.box(doc, boxLabelX, 538.3, boxValX - boxLabelX, 10.2, CELL_BG);
    this.box(doc, boxValX, 538.3, R - boxValX, 10.2, null);
    this.text(doc, 'Fecha', 466.8, 543.1, 5.4, true);

    // ===== INFORMACION DE ORIGEN =====
    this.band(doc, 523.7, 11.5, 'INFORMACIÓN DE ORIGEN', 527.5);
    const f = i.from;
    // Limites de columna de esta seccion (del original).
    const cA = 128.1; // fin etiqueta izquierda
    const cB = 285.4; // fin valor 1
    const cC = 379.6; // fin etiqueta 2
    const cD = 481.7; // fin valor 2
    const cE = 614.9; // fin etiqueta 3
    const rowH = 16.2;

    // Fila 1: Compañia | Nombre | Num. de identificacion
    let bottom = 507.5;
    this.box(doc, L, bottom, cA - L, rowH, CELL_BG);
    this.box(doc, cA, bottom, cB - cA, rowH, null);
    this.box(doc, cB, bottom, cC - cB, rowH, CELL_BG);
    this.box(doc, cC, bottom, cD - cC, rowH, null);
    this.box(doc, cD, bottom, cE - cD, rowH, CELL_BG);
    this.box(doc, cE, bottom, R - cE, rowH, null);
    this.text(doc, 'Compañía', 32.1, 513.1, 5.4, true);
    this.text(doc, f.company ?? '', 134.2, 513.1, 5.4, false, cB - 134.2 - 3);
    this.text(doc, 'Nombre', 291.5, 513.1, 5.4, true);
    this.text(doc, f.name ?? '', 385.7, 513.1, 5.4, false, cD - 385.7 - 3);
    this.text(doc, 'Num. de identificación', 487.8, 513.1, 5.4, true);
    this.text(doc, f.taxId ?? '', 621.0, 513.1, 5.4, false, R - 621 - 3);

    // Fila 2: Direccion (celda ancha) | Codigo postal
    bottom = 491.3;
    this.box(doc, L, bottom, cA - L, rowH, CELL_BG);
    this.box(doc, cA, bottom, cD - cA, rowH, null);
    this.box(doc, cD, bottom, cE - cD, rowH, CELL_BG);
    this.box(doc, cE, bottom, R - cE, rowH, null);
    this.text(doc, 'Dirección', 32.1, 496.9, 5.4, true);
    this.text(doc, this.fullAddress(f), 134.2, 496.9, 5.4, false, cD - 134.2 - 3);
    this.text(doc, 'Código postal', 487.8, 496.9, 5.4, true);
    this.text(doc, f.postalCode ?? '', 621.0, 496.9, 5.4, false, R - 621 - 3);

    // Fila 3: Correo | Telefono (celda ancha)
    bottom = 475.1;
    this.box(doc, L, bottom, cA - L, rowH, CELL_BG);
    this.box(doc, cA, bottom, cB - cA, rowH, null);
    this.box(doc, cB, bottom, cC - cB, rowH, CELL_BG);
    this.box(doc, cC, bottom, R - cC, rowH, null);
    this.text(doc, 'Correo electrónico', 32.1, 480.7, 5.4, true);
    this.text(doc, f.email ?? '', 134.2, 480.7, 5.4, false, cB - 134.2 - 3);
    this.text(doc, 'Número de teléfono', 291.5, 480.7, 5.4, true);
    this.text(doc, f.phone ?? '', 385.7, 480.7, 5.4, false, R - 385.7 - 3);

    // ===== INFORMACION DE LOS PAQUETES =====
    this.band(doc, 462.3, 11.5, 'INFORMACIÓN DE LOS PAQUETES', 466.2);

    // Columnas del original (limites deducidos de los encabezados centrados).
    const P = [L, 186, 343, 500, 657, 736, R];
    const heads = [
      'Referencia',
      'Destino',
      'Descripción',
      'Peso y dimensiones',
      'Cantidad de paquetes',
      'Marca X si fue recolectado',
    ];
    for (let k = 0; k < heads.length; k++) {
      this.box(doc, P[k], 448.5, P[k + 1] - P[k], 13.8, CELL_BG);
      this.centered(doc, heads[k], P[k], P[k + 1], 454.2, 4.8, true);
    }

    // Fila del paquete: alta, y con el texto ANCLADO ABAJO.
    const rowBottom = 400;
    const rowTop = 448.5;
    for (let k = 0; k < heads.length; k++) {
      this.box(doc, P[k], rowBottom, P[k + 1] - P[k], rowTop - rowBottom, null);
    }
    // Referencia: codigo de barras + numero debajo
    this.barcode(doc, i.trackingNumber, P[0], P[1], 412, 32);
    this.centered(doc, i.trackingNumber, P[0], P[1], 406.2, 4.8, false);
    // Destino: multilinea de ABAJO hacia arriba (ultima linea pegada al borde)
    this.bottomLines(doc, this.destinationLine(i.to), P[1], P[2], 405.0, 6.6, 5.4);
    // Descripcion / peso / cantidad: una linea, tambien abajo
    this.centered(doc, i.content, P[2], P[3], 405.6, 5.4, false);
    const dims = `${this.n(i.weightKg)}kg, ${this.n(i.length)}x${this.n(i.width)}x${this.n(i.height)}`;
    this.centered(doc, dims, P[3], P[4], 405.6, 5.4, false);
    this.centered(doc, String(i.packages), P[4], P[5], 405.6, 5.4, false);
    // Casilla de recolectado, centrada en su columna
    const chkC = (P[5] + P[6]) / 2;
    this.box(doc, chkC - 5.5, (rowBottom + rowTop) / 2 - 5.5, 11, 11, null, '#3f3f3f');

    // ===== DETALLES DE RELACION DE DESPACHOS =====
    this.band(doc, 387.9, 11.5, 'DETALLES DE RELACIÓN DE DESPACHOS', 391.8);
    const D = [L, 220, 419, 620, R];
    const dHeads = ['Descripción de los valores', 'Observaciones', 'Cliente', 'Recolector'];
    for (let k = 0; k < dHeads.length; k++) {
      this.box(doc, D[k], 372.3, D[k + 1] - D[k], 15.6, CELL_BG);
      this.centered(doc, dHeads[k], D[k], D[k + 1], 378.0, 5.4, true);
    }

    // Mini-tabla de totales: 5 filas de 15pt, base 297.3
    const volume = (i.length * i.width * i.height) / 2000;
    const rows: Array<[string, string]> = [
      ['Total en peso', `${this.n(i.weightKg)} kg`],
      ['Total en volumen', this.n(volume)],
      ['Total de paquetes', String(i.packages)],
      ['Creado por', 'Skydropx'],
      ['Número de placa', ''],
    ];
    const miniSplit = 120.3;
    const baselines = [363.0, 348.0, 333.0, 318.0, 302.9];
    for (let k = 0; k < rows.length; k++) {
      const b = baselines[k] - 5.6; // borde inferior de la fila
      this.box(doc, D[0], b, miniSplit - D[0], 15, CELL_BG);
      this.box(doc, miniSplit, b, D[1] - miniSplit, 15, null);
      this.text(doc, rows[k][0], 32.1, baselines[k], 5.4, true);
      this.text(doc, rows[k][1], 126.4, baselines[k], 5.4, false, D[1] - 126.4 - 3);
    }
    // Celdas grandes: Observaciones, Cliente y Recolector (con la linea de firma)
    const blockBottom = 297.3;
    const blockH = 372.3 - blockBottom;
    for (let k = 1; k < D.length - 1; k++) {
      this.box(doc, D[k], blockBottom, D[k + 1] - D[k], blockH, null);
      if (k >= 2) this.centered(doc, 'Nombre / Firma / fecha', D[k], D[k + 1], 300.5, 4.8, false, '#404040');
    }

    doc.end();
    return done;
  }

  // ===== primitivas (todo en coordenadas del PDF original: y desde abajo) =====

  /** Rectangulo con relleno opcional; `stroke` permite un borde distinto. */
  private box(
    doc: PDFKit.PDFDocument,
    x: number,
    yBottom: number,
    w: number,
    h: number,
    bg: string | null,
    stroke = STROKE,
  ): void {
    const y = PAGE_H - yBottom - h;
    if (bg) doc.rect(x, y, w, h).fill(bg);
    doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(stroke).stroke();
  }

  /** Banda gris de seccion con su titulo centrado. */
  private band(doc: PDFKit.PDFDocument, yBottom: number, h: number, title: string, baseline: number): void {
    this.box(doc, L, yBottom, R - L, h, BAND_BG);
    this.centered(doc, title, L, R, baseline, 5.4, true);
  }

  /** Texto por LINEA BASE (como venia en el original). */
  private text(
    doc: PDFKit.PDFDocument,
    value: string,
    x: number,
    baseline: number,
    size: number,
    bold: boolean,
    maxW?: number,
  ): void {
    if (!value) return;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(INK)
      .text(value, x, PAGE_H - baseline - size * ASC, {
        width: maxW,
        lineBreak: false,
        ellipsis: maxW ? true : false,
      });
  }

  /** Texto centrado entre dos limites de columna. */
  private centered(
    doc: PDFKit.PDFDocument,
    value: string,
    x0: number,
    x1: number,
    baseline: number,
    size: number,
    bold: boolean,
    color = INK,
  ): void {
    if (!value) return;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(color)
      .text(value, x0, PAGE_H - baseline - size * ASC, {
        width: x1 - x0,
        align: 'center',
        lineBreak: false,
      });
  }

  /**
   * Multilinea ANCLADA ABAJO: se parte el texto al ancho de la columna y se
   * dibuja de la ultima linea hacia arriba, que es como lo hace el original.
   */
  private bottomLines(
    doc: PDFKit.PDFDocument,
    value: string,
    x0: number,
    x1: number,
    lastBaseline: number,
    lineGap: number,
    size: number,
  ): void {
    if (!value) return;
    doc.font('Helvetica').fontSize(size);
    const maxW = x1 - x0 - 8;
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (doc.widthOfString(next) <= maxW || !cur) cur = next;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    // La ULTIMA linea va en lastBaseline; las anteriores suben lineGap cada una.
    for (let k = 0; k < lines.length; k++) {
      const baseline = lastBaseline + (lines.length - 1 - k) * lineGap;
      this.centered(doc, lines[k], x0, x1, baseline, size, false);
    }
  }

  /** Code 128 dibujado con barras, centrado en su columna. */
  private barcode(
    doc: PDFKit.PDFDocument,
    value: string,
    x0: number,
    x1: number,
    yBottom: number,
    h: number,
  ): void {
    const widths = code128Widths(value);
    const modules = widths.reduce((s, n) => s + n, 0);
    const drawW = Math.min((x1 - x0) * 0.78, 130);
    const unit = drawW / modules;
    let cx = x0 + (x1 - x0 - drawW) / 2;
    const y = PAGE_H - yBottom - h;
    let isBar = true;
    doc.fillColor(INK);
    for (const w of widths) {
      if (isBar) doc.rect(cx, y, unit * w, h).fill(INK);
      cx += unit * w;
      isBar = !isBar;
    }
  }

  private fullAddress(a: DispatchAddress): string {
    return [a.street, a.extra, a.city, a.state, a.postalCode, 'Colombia']
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }

  private destinationLine(a: DispatchAddress): string {
    return [a.name, a.email, a.phone, this.fullAddress(a)]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(' / ');
  }

  private n(v: number): string {
    return Number.isFinite(v) ? v.toFixed(1) : '0.0';
  }
}
