import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { DeliveryItem } from '@smartlogistica/shared';

import { DELIVERY_LOGO_PNG } from './delivery-support.logo';

/**
 * SOPORTE DE ENTREGA (envio a domicilio con transportadora propia).
 *
 * Es el unico documento del domicilio: no hay guia ni rotulo. Se imprime, va
 * con el mensajero y el cliente firma el bloque "DATOS DE QUIEN RECIBE", que
 * por eso sale EN BLANCO.
 *
 * Calcado del PDF de muestra que dejo el propietario ("SOPORTE ENTREGA
 * MUESTRA.pdf"): A4 vertical y las mismas coordenadas, con tres correcciones
 * sobre el original (ver mas abajo). Las medidas van con la Y DESDE ABAJO,
 * como el PDF original y como `dispatch-relation.service.ts`.
 */

/** Lo que hay que saber del pedido para llenar el documento. */
export interface DeliverySupportInput {
  /** "No. Orden" impreso = numero de la factura de ALEGRA. */
  invoiceNumber: string;
  customerName: string;
  customerDocument: string;
  customerPhone: string;
  address: string;
  /** Ya formateada para imprimir (YYYY-MM-DD, como la muestra). */
  deliveryDate: string;
  items: DeliveryItem[];
}

const PAGE_W = 595;
const PAGE_H = 842; // A4 VERTICAL

/** Ascendente de Helvetica: pasa una LINEA BASE del original al eje de pdfkit,
 *  que posiciona por el borde superior del texto. */
const ASC = 0.718;

const INK = '#000000';
const SOFT = '#3f3f46';
const RULE = '#9aa0ab';

/** Columnas del cuerpo: etiqueta/valor a la izquierda y a la derecha. */
const COL_L = 55;
const COL_R = 310;
/** Margen derecho util (el original no pasa de aqui). */
const EDGE = 545;

/** Lo mas abajo que puede caer "DATOS DE QUIEN RECIBE" sin comerse el pie: el
 *  bloque ocupa 103pt hasta la linea de la firma y el pie arranca en 52. */
const RECEIVE_FLOOR = 190;

@Injectable()
export class DeliverySupportService {
  private readonly logger = new Logger(DeliverySupportService.name);

  async build(i: DeliverySupportInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    // ===== Logo (centrado arriba) =====
    // El original lo coloca en una caja de 100x80 con mucho aire; el nuestro ya
    // viene recortado, asi que se dibuja por ancho y se centra. Un logo
    // corrupto NO puede tumbar el soporte -> try/catch.
    try {
      const logoW = 118;
      const logoH = Math.round((logoW * 235) / 420);
      doc.image(DELIVERY_LOGO_PNG, (PAGE_W - logoW) / 2, PAGE_H - 812, {
        width: logoW,
        height: logoH,
      });
    } catch (err) {
      this.logger.warn(`No se pudo dibujar el logo del soporte: ${(err as Error).message}`);
    }

    // ===== Titulo =====
    this.centered(doc, 'SOPORTE DE ENTREGA DE PRODUCTO', 0, PAGE_W, 682, 18, true);

    // ===== DATOS DEL CLIENTE =====
    this.section(doc, 'DATOS DEL CLIENTE', 645);

    this.label(doc, 'Nombre:', COL_L, 622);
    this.label(doc, 'Dirección:', COL_R, 622);
    this.value(doc, this.clean(i.customerName), COL_L, 608, COL_R - COL_L - 12);
    // La direccion es el unico campo que de verdad desborda: se parte en dos
    // lineas hacia ABAJO en vez de cortarse con puntos suspensivos.
    this.wrapped(doc, this.clean(i.address), COL_R, 608, EDGE - COL_R, 2);

    this.label(doc, 'Cédula/NIT:', COL_L, 587);
    this.label(doc, 'No. Orden:', COL_R, 587);
    this.value(doc, this.clean(i.customerDocument), COL_L, 573, COL_R - COL_L - 12);
    // El "No. Orden" es el numero de la factura de Alegra: va un punto mayor
    // porque es el dato con el que se cruza el soporte con la venta.
    this.value(doc, this.clean(i.invoiceNumber), COL_R, 573, EDGE - COL_R, 11.5, true);

    this.label(doc, 'Teléfono:', COL_L, 552);
    this.label(doc, 'Fecha:', COL_R, 552);
    this.value(doc, this.clean(i.customerPhone), COL_L, 538, COL_R - COL_L - 12);
    this.value(doc, this.clean(i.deliveryDate), COL_R, 538, EDGE - COL_R);

    // ===== PRODUCTO(S) ENTREGADO(S) =====
    // El bloque de abajo CEDE espacio: en la muestra los productos caben en
    // cinco lineas y despues se pisarian las firmas, pero entre las firmas y el
    // pie sobran ~200pt. Asi que la lista se dibuja entera y lo que empuja es
    // "DATOS DE QUIEN RECIBE", que baja hasta RECEIVE_FLOOR. Solo si ni con eso
    // cabe se corta con "… y N más": un soporte que oculta lo entregado no
    // sirve para lo unico que existe, que es firmarlo.
    this.section(doc, 'PRODUCTO(S) ENTREGADO(S)', 480);
    const lastItem = this.bullets(doc, i.items, COL_L, 457, EDGE - COL_L, RECEIVE_FLOOR + 20);

    // ===== DATOS DE QUIEN RECIBE (en blanco: se llena a mano) =====
    const receive = Math.max(RECEIVE_FLOOR, Math.min(370, lastItem - 18));
    this.section(doc, 'DATOS DE QUIEN RECIBE', receive);
    // El original deja los campos al aire y la gente firma torcido: van con su
    // renglon de 0.5pt.
    this.blank(doc, 'Nombre:', COL_L, receive - 28, EDGE);
    this.blank(doc, 'Cédula:', COL_L, receive - 63, COL_R - 12);
    this.blank(doc, 'Fecha:', COL_R, receive - 63, EDGE);
    this.blank(doc, 'Firma:', COL_L, receive - 103, EDGE);

    // ===== Pie =====
    // La muestra deja la ultima linea a 4pt del borde, fuera del area
    // imprimible de casi cualquier impresora: aqui sube a 22.
    this.centered(doc, 'www.smartgadgets.com.co', 0, PAGE_W, 52, 9, false);
    this.centered(
      doc,
      'Este documento certifica la entrega de los productos mencionados',
      0,
      PAGE_W,
      36,
      8,
      false,
      SOFT,
    );
    this.centered(
      doc,
      'SMART GADGETS - Tecnología al alcance de todos',
      0,
      PAGE_W,
      22,
      8,
      false,
      SOFT,
    );

    doc.end();
    return done;
  }

  // ===== primitivas (Y desde abajo, como el PDF original) =====

  /** Titulo de seccion con su regla fina debajo. */
  private section(doc: PDFKit.PDFDocument, title: string, baseline: number): void {
    this.text(doc, title, 50, baseline, 13, true);
    const y = PAGE_H - baseline + 6;
    doc.moveTo(50, y).lineTo(EDGE, y).lineWidth(0.7).strokeColor(RULE).stroke();
  }

  /** Etiqueta gris de un dato ("Nombre:"). */
  private label(doc: PDFKit.PDFDocument, value: string, x: number, baseline: number): void {
    this.text(doc, value, x, baseline, 9.5, true, undefined, SOFT);
  }

  /** Valor de un dato, recortado al ancho de su columna. */
  private value(
    doc: PDFKit.PDFDocument,
    value: string,
    x: number,
    baseline: number,
    maxW: number,
    size = 10.5,
    bold = false,
  ): void {
    this.text(doc, value || '—', x, baseline, size, bold, maxW);
  }

  /** Campo EN BLANCO para llenar a mano: etiqueta + renglon hasta `endX`. */
  private blank(
    doc: PDFKit.PDFDocument,
    labelText: string,
    x: number,
    baseline: number,
    endX: number,
  ): void {
    this.label(doc, labelText, x, baseline);
    doc.font('Helvetica-Bold').fontSize(9.5);
    const from = x + doc.widthOfString(labelText) + 8;
    const y = PAGE_H - baseline + 3;
    doc.moveTo(from, y).lineTo(endX, y).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  /**
   * Lista de productos. La muestra repite la viñeta en la segunda linea de un
   * nombre largo; aqui la continuacion va con SANGRIA FRANCESA y sin viñeta.
   *
   * Devuelve la linea base de la ULTIMA linea escrita, que es lo que usa el
   * bloque de firmas para saber hasta donde tiene que bajar.
   */
  private bullets(
    doc: PDFKit.PDFDocument,
    items: DeliveryItem[],
    x: number,
    top: number,
    maxW: number,
    floor: number,
  ): number {
    const LH = 15;
    const HANG = 12;
    let baseline = top;
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      const name = this.clean(it.name);
      const label = it.quantity > 1 ? `${it.quantity} x ${name}` : name;
      const lines = this.split(doc, label, maxW - HANG, 10);
      for (let k = 0; k < lines.length; k++) {
        // No pisar "DATOS DE QUIEN RECIBE": se avisa de lo que falta y se corta.
        if (baseline < floor) {
          this.text(doc, `… y ${items.length - n} producto(s) más`, x + HANG, baseline, 10, false);
          return baseline;
        }
        if (k === 0) this.text(doc, '•', x, baseline, 10, false);
        // `fit` garantiza que la linea no se parta sola: un SKU sin espacios mas
        // ancho que la columna arrastraria el resto de la lista hacia abajo.
        this.text(doc, this.fit(doc, lines[k], maxW - HANG, 10), x + HANG, baseline, 10, false);
        baseline -= LH;
      }
    }
    // +LH: `baseline` quedo una linea POR DEBAJO de la ultima escrita.
    return baseline + LH;
  }

  /**
   * Texto de varias lineas hacia ABAJO con un tope DURO de lineas (debajo esta
   * la siguiente fila de etiquetas y no se puede invadir).
   *
   * Es la direccion de entrega: lo ultimo que puede pasar es que se recorte en
   * silencio y el mensajero salga con media direccion. Asi que primero se
   * intenta encoger la letra hasta 8pt; solo si ni asi cabe se recorta, y
   * entonces con puntos suspensivos para que se VEA que falta algo.
   */
  private wrapped(
    doc: PDFKit.PDFDocument,
    value: string,
    x: number,
    top: number,
    maxW: number,
    maxLines: number,
  ): void {
    const text = value || '—';
    let size = 10.5;
    let lines = this.split(doc, text, maxW, size);
    for (const smaller of [9.5, 8.5, 8]) {
      if (lines.length <= maxLines) break;
      size = smaller;
      lines = this.split(doc, text, maxW, size);
    }
    const clipped = lines.length > maxLines;
    lines = lines.slice(0, maxLines);
    // El recorte se hace AQUI, midiendo: no se delega en el `ellipsis` de
    // pdfkit, que con una linea al limite la parte en dos y esa tercera linea
    // se montaria sobre la fila de etiquetas de abajo.
    if (clipped && lines.length > 0) {
      lines[lines.length - 1] = this.fit(doc, `${lines[lines.length - 1]}…`, maxW, size);
    }
    for (let k = 0; k < lines.length; k++) {
      this.text(doc, lines[k], x, top - k * (size + 1.5), size, false, maxW);
    }
  }

  /** Recorta un texto hasta que de verdad quepa en `maxW` (con puntos suspensivos). */
  private fit(
    doc: PDFKit.PDFDocument,
    value: string,
    maxW: number,
    size: number,
    font = 'Helvetica',
  ): string {
    doc.font(font).fontSize(size);
    if (doc.widthOfString(value) <= maxW) return value;
    let body = value.replace(/…$/, '');
    while (body.length > 1 && doc.widthOfString(`${body}…`) > maxW) body = body.slice(0, -1);
    return `${body.trimEnd()}…`;
  }

  /**
   * Deja solo lo que las fuentes estandar (WinAnsi) saben dibujar. Sin esto un
   * emoji o un caracter chino en el nombre de un producto NO revienta: sale
   * como bytes basura ("Ø<ß") en un documento que el cliente firma.
   */
  private clean(value: string): string {
    return (value ?? '')
      .normalize('NFC')
      .replace(/[^ -~ -ÿ‘’“”–—•…]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Parte un texto al ancho dado (mismo criterio que la relacion de despacho). */
  private split(doc: PDFKit.PDFDocument, value: string, maxW: number, size: number): string[] {
    doc.font('Helvetica').fontSize(size);
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
    return lines;
  }

  /**
   * Texto por LINEA BASE (como venia en el original), SIEMPRE en una sola linea.
   *
   * OJO con pdfkit (probado en 0.19.1): `lineBreak: false` NO desactiva el
   * salto — en cuanto se pasa `width`, `_text()` monta el LineWrapper igual — y
   * `ellipsis: true` solo actua si ademas se pasa `height`, cosa que aqui no
   * pasa. Es decir: las dos opciones que parecian recortar no hacian NADA, y un
   * nombre de cliente largo se derramaba hacia abajo hasta pisar la fila de la
   * cedula. Por eso el recorte se hace ANTES, midiendo con `fit`, y a pdfkit ya
   * no se le pasa `width`: no le queda por donde partir la linea.
   */
  private text(
    doc: PDFKit.PDFDocument,
    value: string,
    x: number,
    baseline: number,
    size: number,
    bold: boolean,
    maxW?: number,
    color = INK,
  ): void {
    if (!value) return;
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(size);
    const shown = maxW ? this.fit(doc, value, maxW, size, font) : value;
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(shown, x, PAGE_H - baseline - size * ASC, { lineBreak: false });
  }

  /** Texto centrado entre dos limites. */
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
}
