import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { CatalogMatch } from '@smartlogistica/shared';

/**
 * Lookup de un codigo (IMEI o serial) contra el catalogo de compras del tenant:
 * su DB externa (puente Kupo), mantenida fresca por webhook. SOLO LECTURA.
 *
 * La factura de compra vive en `bills.data` (jsonb, con el mismo shape que una
 * factura de Alegra): provider.name + purchases.items[].{name, price, observations}
 * donde el/los IMEI o serial estan en texto libre. Buscamos por substring.
 *
 * Nota multi-tenant: hoy es una unica DB (uso propio del tenant) via CATALOG_DB_URL.
 * Para varios clientes habria que hacerla una conexion por tenant.
 */
@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogService.name);
  private pool: Pool | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('CATALOG_DB_URL');
    if (!url) {
      this.logger.warn('CATALOG_DB_URL no configurado — lookup de compras deshabilitado.');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
      // Esta DB es de solo lectura para nosotros; nunca ejecutamos writes.
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => null);
  }

  isConfigured(): boolean {
    return Boolean(this.pool);
  }

  /** Busca un codigo (IMEI/serial) y devuelve la factura de compra que lo contiene. */
  async findByCode(code: string): Promise<CatalogMatch | null> {
    const trimmed = code.trim();
    if (!this.pool || trimmed.length < 4) return null;

    const res = await this.pool.query(
      `SELECT id, store, date, data
         FROM bills
        WHERE data::text ILIKE '%' || $1 || '%'
        ORDER BY date DESC NULLS LAST
        LIMIT 5`,
      [trimmed],
    );

    for (const row of res.rows) {
      const data = row.data ?? {};
      const items = data?.purchases?.items ?? data?.items ?? [];
      for (const item of items) {
        const text = `${item?.observations ?? ''}\n${item?.description ?? ''}`;
        if (text.includes(trimmed)) {
          return {
            code: trimmed,
            itemId: item?.id != null ? String(item.id) : null,
            productName: item?.name ?? null,
            unitCost: item?.price != null ? String(item.price) : null,
            providerName: data?.provider?.name ?? null,
            billNumber: data?.numberTemplate?.fullNumber ?? String(data?.id ?? row.id),
            billDate: toIso(data?.date ?? row.date),
            store: row.store ?? null,
          };
        }
      }
    }
    return null;
  }

  /** Lookup batch: devuelve los matches encontrados (los no encontrados se omiten). */
  async findByCodes(codes: string[]): Promise<CatalogMatch[]> {
    const results = await Promise.all(codes.map((c) => this.findByCode(c)));
    return results.filter((m): m is CatalogMatch => m !== null);
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
