import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { certificateTemplateSchema, type CertificateTemplate } from '@smartlogistica/shared';

import { isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { AlegraClient } from './alegra-client.service';

/**
 * Certificado de Garantia: aplica un OVERLAY (plantilla por sede) sobre la
 * factura de Alegra con pdf-lib -> tapa zonas (QR, "Factura de venta", texto
 * legal) y escribe texto (titulo, terminos, datos de pago). Reemplaza a la
 * extension de navegador (coordenadas fijas) por una plantilla editable por sede.
 */
@Injectable()
export class WarrantyService {
  private readonly logger = new Logger(WarrantyService.name);

  constructor(
    private readonly client: AlegraClient,
    private readonly warehouses: WarehousesService,
  ) {}

  /** Plantilla de la sede (o null si no tiene). */
  async getTemplate(warehouseId: string, auth: AuthContext): Promise<CertificateTemplate | null> {
    await this.assertAccess(warehouseId, auth);
    return this.loadTemplate(warehouseId);
  }

  /** Guarda la plantilla de la sede. Solo admin. */
  async saveTemplate(
    warehouseId: string,
    template: CertificateTemplate,
    auth: AuthContext,
  ): Promise<CertificateTemplate> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden editar la plantilla');
    await this.assertAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    const parsed = certificateTemplateSchema.parse(template);
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { certificateTemplate: parsed as unknown as object },
    });
    return parsed;
  }

  /** PDF de la ULTIMA factura de venta de la sede — fondo del editor. */
  async getEditorInvoicePdf(warehouseId: string, auth: AuthContext): Promise<Buffer> {
    await this.assertAccess(warehouseId, auth);
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.alegraConnection.findUnique({ where: { warehouseId } });
    if (!conn) throw new NotFoundException('Esta sede no tiene Alegra conectado.');
    const http = await this.client.forWarehouse(tenantId, warehouseId);
    const list = await this.client.listInvoices(http, { limit: 1 });
    const last = list[0];
    if (!last) throw new NotFoundException('La sede no tiene facturas en Alegra todavia.');
    const pdf = await this.client.getInvoicePdf(http, String(last.id));
    if (!pdf) throw new NotFoundException('No se pudo obtener el PDF de la ultima factura.');
    return pdf;
  }

  /**
   * Transforma la factura en Certificado de Garantia aplicando la plantilla de la
   * sede. Devuelve null si la sede no tiene plantilla (el caller usa la factura cruda).
   */
  async certificateFor(
    warehouseId: string,
    invoicePdf: Buffer,
    data: Record<string, string>,
  ): Promise<Buffer | null> {
    const template = await this.loadTemplate(warehouseId);
    if (!template || template.elements.length === 0) return null;
    try {
      return await this.applyTemplate(invoicePdf, template, data);
    } catch (err) {
      this.logger.warn(`No se pudo aplicar la plantilla del certificado: ${(err as Error).message}`);
      return null;
    }
  }

  // === Interno ===

  private async loadTemplate(warehouseId: string): Promise<CertificateTemplate | null> {
    const { prisma } = getTenantContext();
    const wh = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { certificateTemplate: true },
    });
    if (!wh) throw new NotFoundException('Sede no encontrada');
    if (!wh.certificateTemplate) return null;
    const parsed = certificateTemplateSchema.safeParse(wh.certificateTemplate);
    return parsed.success ? parsed.data : null;
  }

  private async applyTemplate(
    pdfBytes: Buffer,
    template: CertificateTemplate,
    data: Record<string, string>,
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBytes);
    const pages = doc.getPages();
    const page = pages[template.page] ?? pages[0];
    if (!page) return pdfBytes;

    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvB = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const el of template.elements) {
      if (el.type === 'cover') {
        const c = hexToRgb(el.color);
        page.drawRectangle({
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          color: rgb(c.r, c.g, c.b),
          opacity: 1,
          borderWidth: 0,
        });
      } else {
        const c = hexToRgb(el.color);
        const font = el.bold ? helvB : helv;
        const filled = fillPlaceholders(el.text, data);
        let yy = el.y;
        for (const line of filled.split('\n')) {
          const safe = sanitize(line);
          if (safe) {
            try {
              page.drawText(safe, { x: el.x, y: yy, size: el.size, color: rgb(c.r, c.g, c.b), font });
            } catch {
              /* char no soportado por WinAnsi -> se omite la linea */
            }
          }
          yy -= el.size * 1.35;
        }
      }
    }
    const out = await doc.save();
    return Buffer.from(out);
  }

  private async assertAccess(warehouseId: string, auth: AuthContext): Promise<void> {
    const { prisma } = getTenantContext();
    const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || wh.archived) throw new NotFoundException('Sede no encontrada');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }
  }
}

/** '#rrggbb' -> {r,g,b} en 0..1. Default blanco. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Reemplaza {placeholders} con los datos de la factura. */
function fillPlaceholders(text: string, data: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => data[k] ?? '');
}

/** Quita caracteres de control / reemplazo que romperian pdf-lib (WinAnsi). */
function sanitize(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd) continue; // caracter de reemplazo Unicode
    if (code < 0x20 || code === 0x7f) continue; // caracteres de control
    out += ch;
  }
  return out.trim();
}
