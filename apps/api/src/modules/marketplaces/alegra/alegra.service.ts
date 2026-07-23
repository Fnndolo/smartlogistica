import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { isAxiosError, type AxiosInstance } from 'axios';
import type {
  AlegraConnectionSummary,
  AlegraCredentialsInput,
  AlegraImeiMatch,
  AlegraItem,
  AlegraSeller,
  AlegraSyncResult,
  AlegraTestResult,
  CreateInvoiceLine,
  InvoiceLinePreview,
  InvoiceResult,
} from '@smartlogistica/shared';

import { isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { CatalogService } from '../../../infrastructure/catalog/catalog.service';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import { AiConnectionService } from '../../ai/ai-connection.service';
import { extractValidImeis } from '../../ai/imei.util';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { AlegraClient, type AlegraBankAccount } from './alegra-client.service';

export interface InvoiceClient {
  name: string;
  firstName: string | null;
  lastName: string | null;
  identification: string | null;
  email: string | null;
  phone: string | null;
  address: {
    street: string | null;
    city: string | null;
    department: string | null;
    zipCode: string | null;
  } | null;
}

// Sync inline con tope (para no colgar el request si hay muchas facturas).
const SYNC_PAGE_LIMIT = 30;
const SYNC_MAX_PAGES = 20; // hasta 600 facturas
const DETAIL_CONCURRENCY = 6;
const UPSERT_CONCURRENCY = 10;

interface ImeiRecord {
  imei: string;
  billId: string;
  billNumber: string | null;
  billDate: Date | null;
  providerName: string | null;
  itemName: string | null;
  unitCost: number | null;
  observations: string | null;
}

/** Ejecuta fn sobre items con concurrencia acotada. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Arma el nameObject (Alegra lo exige para personas) desde first/last name de VTEX. */
function buildNameObject(
  firstName: string | null,
  lastName: string | null,
  fullName: string,
): { firstName: string; secondName: string; lastName: string; secondLastName: string } {
  const fn = (firstName ?? '').trim().toUpperCase();
  const ln = (lastName ?? '').trim().toUpperCase();
  if (fn || ln) {
    const fp = fn.split(/\s+/).filter(Boolean);
    const lp = ln.split(/\s+/).filter(Boolean);
    return {
      firstName: fp[0] ?? fullName.toUpperCase(),
      secondName: fp.slice(1).join(' '),
      lastName: lp[0] ?? fp.slice(-1)[0] ?? '.',
      secondLastName: lp.slice(1).join(' '),
    };
  }
  const parts = (fullName ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? (fullName || 'CLIENTE').toUpperCase(),
    secondName: parts.length > 2 ? (parts[1] ?? '') : '',
    lastName: parts.length > 2 ? (parts[2] ?? '') : (parts[1] ?? parts[0] ?? '.'),
    secondLastName: parts.slice(3).join(' '),
  };
}

// Codigos de Alegra -> etiqueta que aparece en la factura (para el Certificado).
const PAYMENT_FORM_LABEL: Record<string, string> = { CASH: 'Contado', CREDIT: 'Credito' };
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  DEBIT_TRANSFER: 'Transferencia débito',
  CREDIT_TRANSFER: 'Transferencia crédito',
  TRANSFER: 'Transferencia',
  DEBIT_CARD: 'Tarjeta débito',
  CREDIT_CARD: 'Tarjeta crédito',
  CHECK: 'Cheque',
  BANK_DEPOSIT: 'Consignación',
  ELECTRONIC_MONEY: 'Dinero electrónico',
  OTHER: 'Otro',
};
/** "DEBIT_TRANSFER" -> "Debit transfer" (fallback si Alegra manda un codigo nuevo). */
function humanizeCode(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function paymentFormLabel(code: string | undefined): string {
  if (!code) return 'Contado';
  return PAYMENT_FORM_LABEL[code] ?? humanizeCode(code);
}
function paymentMethodLabel(code: string | undefined): string {
  if (!code) return 'Transferencia';
  return PAYMENT_METHOD_LABEL[code] ?? humanizeCode(code);
}

/** "VALLE DEL CAUCA" -> "Valle del Cauca" (Alegra prefiere title-case en el depto). */
function titleCase(value: string | null): string | null {
  if (!value) return value;
  const small = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

interface AlegraImeiRow {
  imei: string;
  billId: string;
  billNumber: string | null;
  billDate: Date | null;
  providerName: string | null;
  itemName: string | null;
  unitCost: { toString(): string } | null;
  sourceWarehouseId: string;
  syncedAt: Date;
}

interface AlegraConnectionRow {
  warehouseId: string;
  email: string;
  companyName: string | null;
  status: string;
  lastError: string | null;
  createdAt: Date;
}

@Injectable()
export class AlegraService {
  constructor(
    private readonly client: AlegraClient,
    private readonly envelope: EnvelopeService,
    private readonly warehouses: WarehousesService,
    private readonly catalog: CatalogService,
    private readonly ai: AiConnectionService,
  ) {}

  /** Conexion Alegra de una sede (o null si no esta conectada). */
  async get(warehouseId: string, auth: AuthContext): Promise<AlegraConnectionSummary | null> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    const conn = await prisma.alegraConnection.findUnique({ where: { warehouseId } });
    return conn ? this.toSummary(conn) : null;
  }

  /** Valida credenciales contra Alegra sin persistir nada. Solo admin. */
  async test(
    warehouseId: string,
    input: AlegraCredentialsInput,
    auth: AuthContext,
  ): Promise<AlegraTestResult> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    try {
      const { companyName } = await this.client.testCredentials(input);
      return { ok: true, companyName };
    } catch (err) {
      throw this.translateError(err, 'No se pudo conectar a Alegra');
    }
  }

  /** Conecta (o reconecta) Alegra a la sede. Valida -> cifra token -> upsert. Solo admin. */
  async connect(
    warehouseId: string,
    input: AlegraCredentialsInput,
    auth: AuthContext,
  ): Promise<AlegraConnectionSummary> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId, prisma } = getTenantContext();

    // 1. Validar primero — falla rapido sin guardar nada.
    let companyName: string | null = null;
    try {
      companyName = (await this.client.testCredentials(input)).companyName;
    } catch (err) {
      throw this.translateError(err, 'Las credenciales de Alegra son invalidas');
    }

    // 2. Cifrar el token con la DEK del tenant (blob auto-contenido iv+tag+ct).
    const encryptedToken = await this.envelope.encryptField(tenantId, input.token);

    // 3. Upsert (1:1 con la sede).
    const conn = await prisma.alegraConnection.upsert({
      where: { warehouseId },
      create: {
        warehouseId,
        email: input.email,
        encryptedToken,
        companyName,
        status: 'connected',
        lastError: null,
      },
      update: {
        email: input.email,
        encryptedToken,
        companyName,
        status: 'connected',
        lastError: null,
      },
    });

    return this.toSummary(conn);
  }

  /** Desconecta Alegra de la sede (borra credenciales). Solo admin. */
  async disconnect(warehouseId: string, auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    await prisma.alegraConnection.deleteMany({ where: { warehouseId } });
  }

  // === Indice por IMEI ===

  /**
   * Espeja las facturas de compra de la sede a la tabla AlegraImeiIndex, parseando
   * el/los IMEI de cada linea (observations/description). Solo admin. Inline con
   * tope (SYNC_MAX_PAGES); si se topa, `capped=true`.
   */
  async syncWarehouse(warehouseId: string, auth: AuthContext): Promise<AlegraSyncResult> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId, prisma } = getTenantContext();
    const http = await this.client.forWarehouse(tenantId, warehouseId);

    // 1. Juntar facturas (paginado, mas nuevas primero, con tope).
    const bills = [];
    let capped = false;
    for (let page = 0; page < SYNC_MAX_PAGES; page++) {
      const batch = await this.client.listBills(http, {
        start: page * SYNC_PAGE_LIMIT,
        limit: SYNC_PAGE_LIMIT,
      });
      bills.push(...batch);
      if (batch.length < SYNC_PAGE_LIMIT) break;
      if (page === SYNC_MAX_PAGES - 1) capped = true;
    }

    // 2. Extraer IMEIs de cada linea (detalle si el list no trae items).
    const records = new Map<string, ImeiRecord>();
    await mapLimit(bills, DETAIL_CONCURRENCY, async (bill) => {
      const detail = bill.purchases?.items ? bill : await this.client.getBill(http, String(bill.id));
      const items = detail.purchases?.items ?? detail.items ?? [];
      const billNumber = detail.numberTemplate?.fullNumber ?? detail.billNumber ?? String(detail.id);
      const billDate = detail.date ? new Date(detail.date) : null;
      const providerName = detail.provider?.name ?? null;
      for (const line of items) {
        const text = line.observations ?? line.description ?? '';
        if (!text) continue;
        const unit = line.price != null ? Number(line.price) : NaN;
        for (const imei of extractValidImeis(text)) {
          records.set(imei, {
            imei,
            billId: String(detail.id),
            billNumber,
            billDate,
            providerName,
            itemName: line.name ?? null,
            unitCost: Number.isNaN(unit) ? null : unit,
            observations: text.slice(0, 2000),
          });
        }
      }
    });

    // 3. Upsert al indice (imei unico).
    await mapLimit([...records.values()], UPSERT_CONCURRENCY, async (r) => {
      const data = {
        billId: r.billId,
        billNumber: r.billNumber,
        billDate: r.billDate,
        providerName: r.providerName,
        itemName: r.itemName,
        unitCost: r.unitCost,
        sourceWarehouseId: warehouseId,
        observations: r.observations,
        syncedAt: new Date(),
      };
      await prisma.alegraImeiIndex.upsert({
        where: { imei: r.imei },
        create: { imei: r.imei, ...data },
        update: data,
      });
    });

    return { bills: bills.length, imeisIndexed: records.size, capped };
  }

  /** Busca un IMEI en el indice (con verificacion de acceso a la sede). */
  async lookupImei(
    warehouseId: string,
    imei: string,
    auth: AuthContext,
  ): Promise<AlegraImeiMatch | null> {
    await this.assertWarehouseAccess(warehouseId, auth);
    return this.findByImei(imei);
  }

  /** Busqueda interna por IMEI (sin auth) — la usa el flujo Foto IMEI. */
  async findByImei(imei: string): Promise<AlegraImeiMatch | null> {
    const { prisma } = getTenantContext();
    const row = await prisma.alegraImeiIndex.findUnique({ where: { imei } });
    return row ? this.toImeiMatch(row) : null;
  }

  private toImeiMatch(row: AlegraImeiRow): AlegraImeiMatch {
    return {
      imei: row.imei,
      billId: row.billId,
      billNumber: row.billNumber,
      billDate: row.billDate ? row.billDate.toISOString() : null,
      providerName: row.providerName,
      itemName: row.itemName,
      unitCost: row.unitCost != null ? row.unitCost.toString() : null,
      sourceWarehouseId: row.sourceWarehouseId,
      syncedAt: row.syncedAt.toISOString(),
    };
  }

  // === Facturacion (venta) ===

  private static readonly ADDI_ACCOUNT_MATCH = /marketplace\s*addi|(^|\s)addi(\s|$)/i;

  /** Las cuentas bancarias casi nunca cambian; se cachean para no pedirlas a Alegra en cada factura. */
  private static readonly BANK_ACCOUNTS_TTL_MS = 10 * 60_000;
  private readonly bankAccountsCache = new Map<
    string,
    { at: number; accounts: AlegraBankAccount[] }
  >();

  private async listBankAccountsCached(
    warehouseId: string,
    http: AxiosInstance,
  ): Promise<AlegraBankAccount[]> {
    const hit = this.bankAccountsCache.get(warehouseId);
    if (hit && Date.now() - hit.at < AlegraService.BANK_ACCOUNTS_TTL_MS) return hit.accounts;
    const accounts = await this.client.listBankAccounts(http);
    this.bankAccountsCache.set(warehouseId, { at: Date.now(), accounts });
    return accounts;
  }

  /** Busca items del catalogo de Alegra (selector manual de producto). */
  async searchItems(warehouseId: string, query: string, auth: AuthContext): Promise<AlegraItem[]> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId } = getTenantContext();
    const http = await this.client.forWarehouse(tenantId, warehouseId);
    const items = await this.client.searchItems(http, query);
    return items.map((i) => this.toItem(i));
  }

  /** Vendedores guardados en la cuenta Alegra de la sede (solo activos). */
  async listSellers(warehouseId: string, auth: AuthContext): Promise<AlegraSeller[]> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId } = getTenantContext();
    const http = await this.client.forWarehouse(tenantId, warehouseId);
    try {
      const sellers = await this.client.listSellers(http);
      return sellers
        .filter((s) => (s.status ?? 'active') === 'active' && s.name)
        .map((s) => ({ id: String(s.id), name: String(s.name) }));
    } catch (err) {
      throw this.alegraError(err, 'No se pudieron traer los vendedores de Alegra');
    }
  }

  /** Vendedor elegido por el USUARIO actual para esta sede (null = sin vendedor). */
  async getSellerPref(warehouseId: string, auth: AuthContext): Promise<AlegraSeller | null> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    const pref = await prisma.alegraSellerPref.findUnique({
      where: { warehouseId_userId: { warehouseId, userId: auth.userId } },
    });
    return pref ? { id: pref.sellerId, name: pref.sellerName } : null;
  }

  /** Guarda (o limpia, con null) el vendedor del USUARIO actual en esta sede. */
  async saveSellerPref(
    warehouseId: string,
    seller: AlegraSeller | null,
    auth: AuthContext,
  ): Promise<AlegraSeller | null> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    if (!seller) {
      await prisma.alegraSellerPref
        .delete({ where: { warehouseId_userId: { warehouseId, userId: auth.userId } } })
        .catch(() => null);
      return null;
    }
    await prisma.alegraSellerPref.upsert({
      where: { warehouseId_userId: { warehouseId, userId: auth.userId } },
      create: { warehouseId, userId: auth.userId, sellerId: seller.id, sellerName: seller.name },
      update: { sellerId: seller.id, sellerName: seller.name },
    });
    return seller;
  }

  /**
   * Una linea por GRUPO (= una foto). Los codigos de la misma foto (dual-SIM) van
   * en la misma linea/producto. Resuelve el producto por el primer codigo que
   * matchee (los de una foto son el mismo equipo) + precio de venta sugerido.
   */
  async invoicePreviewLines(
    warehouseId: string,
    groups: string[][],
    auth: AuthContext,
  ): Promise<InvoiceLinePreview[]> {
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId } = getTenantContext();
    const http = await this.client.forWarehouse(tenantId, warehouseId);

    return Promise.all(
      groups.map(async (codes) => {
        let match: Awaited<ReturnType<CatalogService['findByCode']>> = null;
        for (const c of codes) {
          match = await this.catalog.findByCode(c).catch(() => null);
          if (match?.itemId) break;
        }
        let suggestedPrice: string | null = null;
        if (match?.itemId) {
          const item = await this.client.getItem(http, match.itemId);
          suggestedPrice = item ? this.itemSalePrice(item) : null;
        }
        return {
          codes,
          itemId: match?.itemId ?? null,
          productName: match?.productName ?? null,
          suggestedPrice,
          matched: Boolean(match?.itemId),
        };
      }),
    );
  }

  /**
   * Crea la factura de venta en Alegra, PAGADA con la cuenta "MARKETPLACE ADDI"
   * (balance 0 -> queda cerrada/cobrada). Solo admin.
   */
  async createInvoiceForWarehouse(
    warehouseId: string,
    client: InvoiceClient,
    lines: CreateInvoiceLine[],
    auth: AuthContext,
  ): Promise<{
    result: InvoiceResult;
    pdf: Buffer | null;
    /** Forma/medio de pago REALES de la factura (ya traducidos), para el Certificado. */
    payment: { formaPago: string; medioPago: string };
  }> {
    this.assertAdmin(auth);
    await this.assertWarehouseAccess(warehouseId, auth);
    const { tenantId } = getTenantContext();
    const http = await this.client.forWarehouse(tenantId, warehouseId);

    try {
      // 1. Contacto + cuenta "MARKETPLACE ADDI": son independientes -> en paralelo.
      const identification = (client.identification ?? '').trim();
      const [existing, accounts] = await Promise.all([
        identification ? this.client.findContactByIdentification(http, identification) : null,
        this.listBankAccountsCached(warehouseId, http),
      ]);

      const addi = accounts.find((a) => AlegraService.ADDI_ACCOUNT_MATCH.test(a.name ?? ''));
      if (!addi) {
        throw new BadRequestException('No se encontro la cuenta "MARKETPLACE ADDI" en tu Alegra');
      }

      // 2. Contacto: si ya existe (por cedula) se usa tal cual (ya tiene su data);
      //    si no, se crea con todos los datos. Alegra exige nameObject + kindOfPerson.
      let clientId: number | string;
      if (existing?.id != null) {
        clientId = existing.id;
      } else {
        // La direccion en nomenclatura DIAN (llamada a la IA, lenta) SOLO hace
        // falta para crear el contacto: el que ya existe conserva la suya. Por
        // eso va aqui dentro y no en el camino critico de toda factura.
        const dianStreet = client.address?.street
          ? await this.ai.formatAddressDian(client.address.street)
          : null;
        const contactAddress = client.address
          ? {
              address: dianStreet,
              city: client.address.city,
              department: titleCase(client.address.department),
              country: 'Colombia',
              zipCode: client.address.zipCode,
            }
          : null;

        const idNumber = identification || '222222222222';
        clientId = (
          await this.client.createContact(http, {
            name: client.name || 'CONSUMIDOR FINAL',
            nameObject: buildNameObject(client.firstName, client.lastName, client.name),
            identification: idNumber,
            identificationObject: { type: 'CC', number: idNumber },
            kindOfPerson: 'PERSON_ENTITY',
            regime: 'SIMPLIFIED_REGIME',
            type: ['client'],
            email: client.email,
            phonePrimary: client.phone,
            address: contactAddress,
          })
        ).id;
      }

      // 3. Total + fecha + vendedor del usuario (si eligio uno para esta sede).
      const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
      const today = new Date().toISOString().slice(0, 10);
      const sellerPref = await getTenantContext()
        .prisma.alegraSellerPref.findUnique({
          where: { warehouseId_userId: { warehouseId, userId: auth.userId } },
        })
        .catch(() => null);

      // 4. Factura con pago -> cerrada/cobrada.
      const created = await this.client.createInvoice(http, {
        date: today,
        dueDate: today,
        client: { id: clientId },
        anotation: 'ADDI', // en "anotaciones" siempre va "ADDI"
        ...(sellerPref ? { seller: Number(sellerPref.sellerId) || sellerPref.sellerId } : {}),
        items: lines.map((l) => ({
          id: l.itemId,
          price: l.price,
          quantity: l.quantity,
          ...(l.description ? { description: l.description } : {}),
        })),
        payments: [
          { date: today, account: { id: addi.id }, amount: total, paymentMethod: 'transfer' },
        ],
      });

      // PDF de la factura (para adjuntarlo al chat). Best-effort.
      const pdf = await this.client.getInvoicePdf(http, String(created.id)).catch(() => null);

      return {
        result: {
          id: String(created.id),
          number: created.numberTemplate?.fullNumber ?? String(created.id),
          status: created.status ?? 'unknown',
          total: created.total != null ? String(created.total) : String(total),
          balance: created.balance != null ? String(created.balance) : '0',
        },
        pdf,
        payment: {
          formaPago: paymentFormLabel(created.paymentForm),
          medioPago: paymentMethodLabel(created.paymentMethod),
        },
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw this.alegraError(err, 'No se pudo crear la factura en Alegra');
    }
  }

  private toItem(raw: {
    id: number | string;
    name?: string;
    reference?: string | null;
    price?: number | string | Array<{ price?: number | string; idPriceList?: number | string }> | null;
  }): AlegraItem {
    return {
      id: String(raw.id),
      name: raw.name ?? '',
      price: this.itemSalePrice(raw),
      reference: raw.reference ?? null,
    };
  }

  private itemSalePrice(raw: {
    price?: number | string | Array<{ price?: number | string; idPriceList?: number | string }> | null;
  }): string | null {
    const p = raw.price;
    if (p == null) return null;
    if (Array.isArray(p)) {
      const chosen = p.find((x) => String(x.idPriceList) === '1') ?? p[0];
      return chosen?.price != null ? String(chosen.price) : null;
    }
    return String(p);
  }

  private alegraError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const data = err.response?.data as { message?: string } | string | undefined;
      const msg =
        data && typeof data === 'object' && typeof data.message === 'string'
          ? data.message
          : typeof data === 'string'
            ? data
            : null;
      return new BadRequestException(msg ? `Alegra: ${msg}` : `${fallback} (HTTP ${err.response?.status ?? '?'})`);
    }
    return new BadRequestException(fallback);
  }

  // === Helpers ===

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores pueden gestionar la conexion contable');
    }
  }

  /** Verifica que la sede existe y que el usuario tiene acceso a ella. */
  private async assertWarehouseAccess(warehouseId: string, auth: AuthContext): Promise<void> {
    const { prisma } = getTenantContext();
    const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || wh.archived) throw new NotFoundException('Sede no encontrada');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }
  }

  private toSummary(row: AlegraConnectionRow): AlegraConnectionSummary {
    return {
      warehouseId: row.warehouseId,
      email: row.email,
      companyName: row.companyName,
      status: (row.status as AlegraConnectionSummary['status']) ?? 'connected',
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private translateError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return new BadRequestException('Credenciales de Alegra rechazadas (401/403)');
      }
      if (status === 404) {
        return new BadRequestException('Endpoint de Alegra no encontrado (404)');
      }
      return new BadRequestException(`${fallback}: HTTP ${status ?? 'desconocido'}`);
    }
    return new BadRequestException(fallback);
  }
}
