import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ADDI_EDITABLE_STATUS,
  ADDI_PACKAGE_STATUS_LABEL,
  type AddiGuideInfo,
  type AddiLbaConnectionInput,
  type AddiLbaConnectionSummary,
  type AddiLbaSyncResult,
} from '@smartlogistica/shared';
import type { Prisma, PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { canManageOrders, isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { AuditService, type AuditActor } from '../../audit/audit.service';
import { QUEUE_ADDI_LBA } from '../../../infrastructure/queue/queue.module';
import { RealtimeService } from '../../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { getTenantContext, tenantContext } from '../../../infrastructure/tenant-context';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { buildSenderUpdate } from './addi-guide-edit';
import {
  ADDI_PAGE_SIZE,
  AddiAuthError,
  AddiPortalClient,
  type AddiCreds,
  type AddiShipment,
} from './addi-portal-client.service';
import {
  CoordinadoraSuiteClient,
  SuiteHttpError,
  type SuiteCreds,
} from './coordinadora-suite-client.service';

interface Creds {
  portal: AddiCreds;
  suite: SuiteCreds;
  autoSender: boolean;
}

/** Lo que guardamos del portal en Order.addiShipment. */
export interface ShipmentSnapshot {
  carrier: string | null;
  packageStatus: string | null;
  dispatchDeadline: string | null;
  /** Cuando se leyo de Addi (el estado del paquete cambia; el resto no). */
  checkedAt: string;
}

/** Guia lista para guardar junto con el pedido al ingerirlo. */
export interface AddiIngestGuide {
  addiGuide: string;
  addiShipment: Prisma.InputJsonValue;
}

/** Un fallo que no se arregla reintentando (se avisa en el chat y se deja). */
class PermanentFailure extends Error {}

/** Quien firma en el chat lo que hace la automatizacion. */
const BOT = { id: 'system', name: 'SmartLogística' } as const;
/**
 * Paginas de la lista de Addi que se revisan buscando UN pedido. La lista no
 * va por fecha de creacion, pero lo recien creado sale arriba (pagina 0).
 */
const INGEST_PAGES = 4;
const LOOKUP_PAGES = 8;
/** Una pagina leida se reutiliza este tiempo (pedidos que llegan en lote). */
const PAGE_TTL_MS = 30_000;
/** Al llegar el pedido no se le espera a Addi mas que esto. */
const INGEST_TIMEOUT_MS = 8_000;
/** Si al llegar no estaba la guia (Addi caido/lento): reintentos SOLO de ese pedido. */
const LOOKUP_RETRY_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** Cambio de remitente ante fallos pasajeros (red, sesion vencida...). */
const APPLY_RETRY_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
/** Al abrir el Detalle, el estado del paquete se relee si tiene mas de esto. */
const STATUS_STALE_MS = 10 * 60_000;
const DETAIL_TIMEOUT_MS = 4_000;

/**
 * ¿El pedido de VTEX es de Addi Logistics (LBA)? Lo dice el propio pedido:
 * su transportadora es "Transportadora estándar (LBA)". Desde que Addi usa esa
 * marca (2026-11-11) TODOS los LBA tienen guia en Addi y los demas no.
 */
export function isLbaOrder(rawPayload: unknown): boolean {
  const li = (rawPayload as { shippingData?: { logisticsInfo?: unknown[] } } | null)?.shippingData
    ?.logisticsInfo;
  if (!Array.isArray(li)) return false;
  return li.some((l) =>
    ((l as { deliveryIds?: Array<{ courierName?: string }> })?.deliveryIds ?? []).some((d) =>
      /\(LBA\)/i.test(d?.courierName ?? ''),
    ),
  );
}

function snapshot(s: AddiShipment): ShipmentSnapshot {
  return {
    carrier: s.carrier,
    packageStatus: s.packageStatus,
    dispatchDeadline: s.dispatchDeadline,
    checkedAt: new Date().toISOString(),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Addi no respondió a tiempo')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * GUIAS DE ADDI (Addi Logistics). Ver addi-lba.schema.ts en shared.
 *
 *  1. AL LLEGAR un pedido de VTEX (ready-for-handling), ANTES de guardarlo se
 *     busca su guia en el portal de Addi (por MKT) y el pedido entra ya con
 *     ella. VTEX suelta el pedido ~30 min despues de creado (ventana de
 *     cancelacion) y Addi genera la guia en el primer minuto: ya esta. Nada
 *     de consultas periodicas; si Addi no responde, se reintenta SOLO ese pedido.
 *  2. En generales no pasa nada mas.
 *  3. Al ASIGNAR / TRANSFERIR a una sede: se edita la guia en la suite de
 *     Coordinadora con el remitente de esa sede, se verifica y el rotulo cae
 *     a la conversacion del pedido.
 */
@Injectable()
export class AddiLbaService implements OnModuleInit {
  private readonly logger = new Logger(AddiLbaService.name);
  private readonly credsCache = new Map<string, { at: number; value: Creds | null }>();
  /** Paginas de Addi leidas hace poco, por tenant. */
  private readonly pageCache = new Map<string, Map<number, { at: number; rows: AddiShipment[] }>>();
  /** Un cambio de remitente a la vez por pedido (`tenant:order`). */
  private readonly running = new Set<string>();

  constructor(
    private readonly portal: AddiPortalClient,
    private readonly suite: CoordinadoraSuiteClient,
    private readonly envelope: EnvelopeService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly warehouses: WarehousesService,
    @InjectQueue(QUEUE_ADDI_LBA) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  /** La primera version consultaba Addi cada 5 min: se borra ese ciclo si quedo. */
  async onModuleInit(): Promise<void> {
    try {
      const reps = await this.queue.getRepeatableJobs();
      for (const r of reps) await this.queue.removeRepeatableByKey(r.key).catch(() => null);
    } catch {
      // sin Redis al arrancar: nada que limpiar
    }
  }

  // === Conexion ===

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
  }

  async summary(auth: AuthContext): Promise<AddiLbaConnectionSummary | null> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const c = await prisma.addiLbaConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!c) return null;
    return {
      portalEmail: c.portalEmail,
      suiteEmail: c.suiteEmail,
      autoSender: c.autoSender,
      status: c.status === 'error' ? 'error' : 'connected',
      lastError: c.lastError,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSyncCount: c.lastSyncCount,
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  /**
   * Guarda (o actualiza) la conexion. Antes de guardar entra DE VERDAD a los
   * dos portales: unas credenciales malas no se guardan.
   */
  async connect(
    input: AddiLbaConnectionInput,
    auth: AuthContext,
  ): Promise<AddiLbaConnectionSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const prev = await prisma.addiLbaConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    const portalPassword = input.portalPassword?.trim()
      ? input.portalPassword
      : prev && prev.portalEmail === input.portalEmail
        ? await this.envelope.decryptField(tenantId, Buffer.from(prev.encryptedPortalPassword))
        : null;
    const suitePassword = input.suitePassword?.trim()
      ? input.suitePassword
      : prev && prev.suiteEmail === input.suiteEmail
        ? await this.envelope.decryptField(tenantId, Buffer.from(prev.encryptedSuitePassword))
        : null;
    if (!portalPassword) throw new BadRequestException('Falta la contraseña del portal de Addi');
    if (!suitePassword)
      throw new BadRequestException('Falta la contraseña de la suite de Coordinadora');

    const [portalCheck, suiteCheck] = await Promise.allSettled([
      this.portal.validate({ email: input.portalEmail, password: portalPassword }),
      this.suite.validate({ email: input.suiteEmail, password: suitePassword }),
    ]);
    const problems = [portalCheck, suiteCheck]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : 'error desconocido'));
    if (problems.length > 0) throw new BadRequestException(problems.join(' · '));

    const [encryptedPortalPassword, encryptedSuitePassword] = await Promise.all([
      this.envelope.encryptField(tenantId, portalPassword),
      this.envelope.encryptField(tenantId, suitePassword),
    ]);
    const data = {
      portalEmail: input.portalEmail,
      encryptedPortalPassword,
      suiteEmail: input.suiteEmail,
      encryptedSuitePassword,
      autoSender: input.autoSender,
      status: 'connected',
      lastError: null,
    };
    if (prev) {
      await prisma.addiLbaConnection.update({ where: { id: prev.id }, data });
      await prisma.addiLbaConnection.deleteMany({ where: { id: { not: prev.id } } });
    } else {
      await prisma.addiLbaConnection.create({ data });
    }
    this.credsCache.delete(tenantId);
    this.pageCache.delete(tenantId);
    const out = await this.summary(auth);
    return out!;
  }

  async disconnect(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    await prisma.addiLbaConnection.deleteMany({});
    this.credsCache.delete(tenantId);
    this.pageCache.delete(tenantId);
  }

  /** Credenciales descifradas (cache 60 s). null = sin conexion. */
  private async credsOrNull(): Promise<Creds | null> {
    const { tenantId, prisma } = getTenantContext();
    const hit = this.credsCache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const c = await prisma.addiLbaConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    let value: Creds | null = null;
    if (c) {
      const [p, s] = await Promise.all([
        this.envelope.decryptField(tenantId, Buffer.from(c.encryptedPortalPassword)),
        this.envelope.decryptField(tenantId, Buffer.from(c.encryptedSuitePassword)),
      ]);
      value = {
        portal: { email: c.portalEmail, password: p },
        suite: { email: c.suiteEmail, password: s },
        autoSender: c.autoSender,
      };
    }
    this.credsCache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /**
   * Busca UN pedido en la lista de Addi, de la pagina 0 hacia atras. Las
   * paginas leidas en los ultimos segundos se reutilizan; si con ellas no
   * aparece, esa pagina se vuelve a leer (pudo crearse justo despues).
   */
  private async findShipment(
    creds: Creds,
    mkt: string,
    maxPages: number,
  ): Promise<AddiShipment | null> {
    const { tenantId } = getTenantContext();
    let pages = this.pageCache.get(tenantId);
    if (!pages) {
      pages = new Map();
      this.pageCache.set(tenantId, pages);
    }
    const read = async (p: number, fresh: boolean) => {
      const hit = pages!.get(p);
      if (!fresh && hit && Date.now() - hit.at < PAGE_TTL_MS)
        return { rows: hit.rows, cached: true };
      const rows = await this.portal.listPage(creds.portal, p);
      pages!.set(p, { at: Date.now(), rows });
      return { rows, cached: false };
    };
    for (let p = 0; p < maxPages; p++) {
      let { rows, cached } = await read(p, false);
      let found = rows.find((s) => s.orderId === mkt);
      if (!found && cached) {
        ({ rows, cached } = await read(p, true));
        found = rows.find((s) => s.orderId === mkt);
      }
      if (found) return found;
      if (rows.length < ADDI_PAGE_SIZE) break;
    }
    return null;
  }

  /** El estado de la conexion refleja si Addi esta aceptando la cuenta. */
  private async noteHealth(err: unknown | null): Promise<void> {
    const { prisma } = getTenantContext();
    if (err === null) {
      await prisma.addiLbaConnection
        .updateMany({ where: { status: 'error' }, data: { status: 'connected', lastError: null } })
        .catch(() => null);
    } else if (err instanceof AddiAuthError) {
      await prisma.addiLbaConnection
        .updateMany({ data: { status: 'error', lastError: err.message.slice(0, 500) } })
        .catch(() => null);
    }
  }

  // === 1. Al llegar el pedido ===

  /**
   * Guia de Addi para un pedido que esta llegando de VTEX, ANTES de guardarlo
   * (VtexOrderService.upsertFromDetail). Nunca lanza ni tarda mas de
   * INGEST_TIMEOUT_MS: la ingesta no depende de Addi.
   *   - guia     -> se guarda con el pedido
   *   - null     -> no la encontro (o Addi fallo)
   *   - 'off'    -> no hay conexion configurada
   */
  async lookupAtIngest(
    tenantId: string,
    prisma: TenantPrismaClient,
    externalId: string,
  ): Promise<AddiIngestGuide | null | 'off'> {
    return tenantContext.run({ tenantId, tenantSlug: '', prisma }, async () => {
      const creds = await this.credsOrNull().catch(() => null);
      if (!creds) return 'off';
      try {
        const ship = await withTimeout(
          this.findShipment(creds, externalId.replace(/^MKT-/, ''), INGEST_PAGES),
          INGEST_TIMEOUT_MS,
        );
        await this.noteHealth(null);
        if (!ship?.trackingNumber) return null;
        return {
          addiGuide: ship.trackingNumber,
          addiShipment: snapshot(ship) as unknown as Prisma.InputJsonValue,
        };
      } catch (err) {
        await this.noteHealth(err);
        this.logger.warn(
          `Guia de Addi para ${externalId} no disponible al llegar: ${(err as Error).message}`,
        );
        return null;
      }
    });
  }

  /** Reintento de buscar la guia de UN pedido (no hay ciclo general). */
  async scheduleLookup(tenantId: string, orderId: string, attempt: number): Promise<void> {
    const delay = LOOKUP_RETRY_MS[attempt];
    if (delay === undefined) return;
    await this.queue
      .add(
        'lookup',
        { tenantId, orderId, attempt },
        {
          delay,
          jobId: `addi-lookup-${orderId}-${attempt}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err) => this.logger.warn(`No se pudo programar la busqueda de guia: ${err.message}`));
  }

  /** Trabajo 'lookup': si aparecio la guia, se guarda (y si estaba pendiente el remitente, se aplica). */
  async retryLookup(orderId: string, attempt: number): Promise<void> {
    const { tenantId, prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        externalId: true,
        provider: true,
        addiGuide: true,
        addiSenderPendingAt: true,
      },
    });
    if (!order || order.provider !== 'vtex') return;
    if (!order.addiGuide) {
      const creds = await this.credsOrNull();
      if (!creds) return;
      let ship: AddiShipment | null = null;
      try {
        ship = await this.findShipment(creds, order.externalId.replace(/^MKT-/, ''), LOOKUP_PAGES);
        await this.noteHealth(null);
      } catch (err) {
        await this.noteHealth(err);
      }
      if (!ship?.trackingNumber) {
        if (attempt + 1 < LOOKUP_RETRY_MS.length) {
          await this.scheduleLookup(tenantId, orderId, attempt + 1);
        } else if (order.addiSenderPendingAt) {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              addiSenderPendingAt: null,
              addiSenderError: 'Addi no tiene guía para este pedido.',
            },
          });
        }
        return;
      }
      await prisma.order.update({
        where: { id: orderId },
        data: {
          addiGuide: ship.trackingNumber,
          addiShipment: snapshot(ship) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    if (order.addiSenderPendingAt) await this.applySender(orderId).catch(() => false);
  }

  /**
   * "Buscar guías faltantes" (Ajustes): recorre TODA la lista de Addi y llena
   * los pedidos que no tengan guia o cuyo estado cambio. Manual, por si algo
   * entro mientras Addi estaba caido.
   */
  async syncNow(auth: AuthContext): Promise<AddiLbaSyncResult> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const creds = await this.credsOrNull();
    if (!creds) throw new BadRequestException('Configura primero la conexión de guías de Addi');
    let list: AddiShipment[];
    try {
      list = await this.portal.listShipments(creds.portal);
      await this.noteHealth(null);
    } catch (err) {
      await this.noteHealth(err);
      throw new BadRequestException(
        err instanceof Error ? err.message : 'No se pudo consultar Addi',
      );
    }
    const byMkt = new Map(list.filter((s) => s.trackingNumber).map((s) => [`MKT-${s.orderId}`, s]));
    let matched = 0;
    let updated = 0;
    const keys = [...byMkt.keys()];
    for (let i = 0; i < keys.length; i += 500) {
      const orders = await prisma.order.findMany({
        where: { provider: 'vtex', externalId: { in: keys.slice(i, i + 500) } },
        select: { id: true, externalId: true, addiGuide: true, addiShipment: true },
      });
      matched += orders.length;
      for (const o of orders) {
        const s = byMkt.get(o.externalId)!;
        const prev = (o.addiShipment ?? null) as ShipmentSnapshot | null;
        if (o.addiGuide === s.trackingNumber && prev?.packageStatus === s.packageStatus) continue;
        await prisma.order.update({
          where: { id: o.id },
          data: {
            addiGuide: s.trackingNumber,
            addiShipment: snapshot(s) as unknown as Prisma.InputJsonValue,
          },
        });
        updated++;
      }
    }
    await prisma.addiLbaConnection.updateMany({
      data: { lastSyncAt: new Date(), lastSyncCount: matched },
    });
    return { shipments: list.length, matched, updated };
  }

  // === 3. Al pasar a una sede ===

  /**
   * Llamado al ASIGNAR / TRANSFERIR pedidos (OrdersService.assign). Marca
   * pendiente el cambio de remitente y lo dispara ya. Devolver a generales
   * cancela lo pendiente. Nunca lanza: el traslado ya ocurrio.
   */
  async onAssigned(orderIds: string[], warehouseId: string | null): Promise<void> {
    if (orderIds.length === 0) return;
    const { tenantId, prisma } = getTenantContext();
    try {
      if (warehouseId === null) {
        await prisma.order.updateMany({
          where: { id: { in: orderIds }, addiSenderPendingAt: { not: null } },
          data: { addiSenderPendingAt: null },
        });
        return;
      }
      const creds = await this.credsOrNull();
      if (!creds?.autoSender) return;
      // Sedes que no despachan (Novedades, Garantías...) no tienen remitente:
      // ahi no hay nada que cambiar y avisarlo en cada traslado seria ruido.
      const sender = await prisma.coordinadoraConnection.findUnique({
        where: { warehouseId },
        select: { senderAddress: true, senderCityCode: true },
      });
      if (!sender?.senderAddress?.trim() || !sender.senderCityCode) return;
      // Solo pedidos con guia de Addi o marcados LBA (los demas no tienen guia
      // de Addi que editar).
      const candidates = await prisma.order.findMany({
        where: { id: { in: orderIds }, provider: 'vtex' },
        select: { id: true, addiGuide: true, rawPayload: true },
      });
      const ids = candidates
        .filter((o) => o.addiGuide || isLbaOrder(o.rawPayload))
        .map((o) => o.id);
      if (ids.length === 0) return;
      await prisma.order.updateMany({
        where: { id: { in: ids } },
        data: { addiSenderPendingAt: new Date(), addiSenderError: null },
      });
      await this.queue.add(
        'apply',
        { tenantId, orderIds: ids, attempt: 0 },
        { delay: 1_500, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo programar el cambio de remitente de Addi: ${(err as Error).message}`,
      );
    }
  }

  private async scheduleApply(
    tenantId: string,
    orderId: string,
    attempt: number,
  ): Promise<boolean> {
    const delay = APPLY_RETRY_MS[attempt - 1];
    if (delay === undefined) return false;
    await this.queue
      .add(
        'apply',
        { tenantId, orderIds: [orderId], attempt },
        {
          delay,
          jobId: `addi-apply-${orderId}-${attempt}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch(() => null);
    return true;
  }

  /**
   * Cambia el remitente de la guia de Addi del pedido al de SU sede actual y
   * deja el rotulo en la conversacion. `manual` = lo pidio alguien desde el
   * Detalle (los errores le llegan como respuesta). `attempt` = reintento
   * automatico numero N. Devuelve true si se aplico.
   */
  async applySender(orderId: string, manual?: AuthContext, attempt = 0): Promise<boolean> {
    const { tenantId, prisma } = getTenantContext();
    const lock = `${tenantId}:${orderId}`;
    if (this.running.has(lock)) {
      if (manual) throw new BadRequestException('Ya se está cambiando el remitente de esta guía.');
      return false;
    }
    this.running.add(lock);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        externalId: true,
        provider: true,
        customerName: true,
        warehouseId: true,
        addiGuide: true,
        addiSenderPendingAt: true,
      },
    });
    try {
      if (!order) throw new NotFoundException('Pedido no encontrado');
      const creds = await this.credsOrNull();
      if (!creds)
        throw new PermanentFailure(
          'La conexión de guías de Addi no está configurada (Ajustes › Envíos).',
        );
      if (order.provider !== 'vtex')
        throw new PermanentFailure('Solo los pedidos de VTEX traen guía de Addi.');
      if (!order.warehouseId) throw new PermanentFailure('El pedido no está en una sede.');
      const mkt = order.externalId.replace(/^MKT-/, '');

      // 1. La guia y su estado ACTUAL en Addi.
      const ship = await this.findShipment(creds, mkt, LOOKUP_PAGES);
      const guide = ship?.trackingNumber ?? order.addiGuide;
      if (ship?.trackingNumber) {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            addiGuide: ship.trackingNumber,
            addiShipment: snapshot(ship) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      if (!guide) {
        // Aun sin guia: queda pendiente y se busca de nuevo solo para este pedido.
        await prisma.order.update({
          where: { id: orderId },
          data: {
            addiSenderError: 'Esperando a que Addi tenga la guía.',
            addiSenderPendingAt: order.addiSenderPendingAt ?? new Date(),
          },
        });
        await this.scheduleLookup(tenantId, orderId, 0);
        if (manual) {
          throw new BadRequestException(
            'Addi todavía no tiene la guía de este pedido. El remitente se cambiará solo cuando aparezca.',
          );
        }
        return false;
      }
      if (ship?.packageStatus && ship.packageStatus !== ADDI_EDITABLE_STATUS) {
        const label = ADDI_PACKAGE_STATUS_LABEL[ship.packageStatus] ?? ship.packageStatus;
        throw new PermanentFailure(
          `La guía ${guide} ya está «${label}» en Addi: Coordinadora ya la recogió y no se le cambia el remitente.`,
        );
      }

      // 2. Remitente de la sede (el mismo de sus guias de Coordinadora).
      const [sede, conn] = await Promise.all([
        prisma.warehouse.findUnique({ where: { id: order.warehouseId }, select: { name: true } }),
        prisma.coordinadoraConnection.findUnique({ where: { warehouseId: order.warehouseId } }),
      ]);
      const sedeName = sede?.name ?? 'la sede';
      if (
        !conn ||
        !conn.senderAddress?.trim() ||
        !conn.senderCityCode ||
        !conn.senderPhone?.trim()
      ) {
        throw new PermanentFailure(
          `La sede ${sedeName} no tiene remitente configurado (Ajustes de la sede › Coordinadora): no se cambió la guía ${guide}.`,
        );
      }

      // 3. La guia en la suite: que exista, que no este anulada ni recogida y
      //    que SEA de este pedido (esa cuenta ve las guias de todos los
      //    comercios de Addi).
      const row = await this.suite.findGuide(creds.suite, guide);
      if (!row)
        throw new PermanentFailure(
          `La guía ${guide} no aparece en la suite de Coordinadora de Addi.`,
        );
      if (/anulad/i.test(row.estado_guia ?? '')) {
        throw new PermanentFailure(`La guía ${guide} está anulada en Coordinadora.`);
      }
      if (row.estadoTracking && !/posesi[oó]n del remitente/i.test(row.estadoTracking)) {
        throw new PermanentFailure(
          `La guía ${guide} ya está «${row.estadoTracking}» en Coordinadora: no se le cambia el remitente.`,
        );
      }
      const current = await this.suite.getGuide(creds.suite, guide);
      if ((current.referenciaGuia ?? '').trim() !== mkt) {
        throw new PermanentFailure(
          `La guía ${guide} no corresponde a este pedido (su referencia es ${current.referenciaGuia ?? 'vacía'}). No se tocó.`,
        );
      }

      // 4. Editar y comprobar.
      const actor = await this.suite.actor(creds.suite);
      const payload = buildSenderUpdate(
        current,
        {
          name: conn.senderName,
          phone: conn.senderPhone,
          address: conn.senderAddress,
          cityCode: conn.senderCityCode,
          postalCode: conn.senderPostalCode,
        },
        actor,
      );
      await this.suite.updateGuide(creds.suite, payload);
      const after = await this.suite.getGuide(creds.suite, guide);
      // Definitivo a proposito: reintentar seria volver a escribir sobre la
      // guia sin saber por que no tomo el cambio.
      if (after.ciudadRemitente !== conn.senderCityCode) {
        throw new PermanentFailure(
          `La suite de Coordinadora aceptó el cambio, pero la guía ${guide} sigue con otro remitente. Revísala en la suite.`,
        );
      }

      // 5. Rotulo (si falla, el remitente YA quedo cambiado: se avisa aparte).
      let pdf: Buffer | null = null;
      let labelError: string | null = null;
      try {
        pdf = await this.suite.printLabel(creds.suite, guide, conn.rotuloId || 55);
      } catch (err) {
        labelError = err instanceof Error ? err.message : 'error desconocido';
      }

      // 6. Estado. Si lo movieron OTRA vez mientras tanto, sigue pendiente.
      const fresh = await prisma.order.findUnique({
        where: { id: orderId },
        select: { addiSenderPendingAt: true, warehouseId: true },
      });
      const movedAgain =
        fresh?.warehouseId !== order.warehouseId ||
        (fresh?.addiSenderPendingAt != null &&
          order.addiSenderPendingAt != null &&
          fresh.addiSenderPendingAt.getTime() !== order.addiSenderPendingAt.getTime());
      await prisma.order.update({
        where: { id: orderId },
        data: {
          addiSenderWarehouseId: order.warehouseId,
          addiSenderAt: new Date(),
          addiSenderError: labelError
            ? `Remitente cambiado, pero el rótulo no salió: ${labelError}`.slice(0, 500)
            : null,
          ...(movedAgain ? {} : { addiSenderPendingAt: null }),
        },
      });
      // Lo movieron otra vez mientras se editaba: el traslado nuevo choco con
      // este candado, asi que se vuelve a aplicar ya con la sede nueva.
      if (movedAgain && fresh?.warehouseId) {
        await this.queue
          .add(
            'apply',
            { tenantId, orderIds: [orderId], attempt: 0 },
            { delay: 1_500, attempts: 1, removeOnComplete: true, removeOnFail: true },
          )
          .catch(() => null);
      }
      await prisma.orderEvent.create({
        data: {
          orderId,
          type: 'addi_sender_updated',
          actorId: manual?.userId ?? null,
          actorName: manual ? manual.name?.trim() || manual.email : BOT.name,
          data: {
            guide,
            warehouseId: order.warehouseId,
            warehouseName: sedeName,
            senderName: conn.senderName,
            cityCode: conn.senderCityCode,
          } as Prisma.InputJsonValue,
        },
      });
      const city = (conn.senderCityName ?? '').split(/[(—]/)[0].trim();
      await this.postToChat(
        order,
        labelError
          ? `Guía de Addi ${guide}: remitente cambiado a ${conn.senderName}${city ? ` (${city})` : ''}, pero el rótulo no se pudo descargar. Imprímelo desde la suite de Coordinadora.`
          : `Guía de Addi ${guide}: remitente cambiado a ${conn.senderName}${city ? ` (${city})` : ''}. Rótulo actualizado:`,
        pdf,
      );
      return true;
    } catch (err) {
      if (!order) throw err;
      if (err instanceof BadRequestException && manual) throw err;
      const msg = err instanceof Error ? err.message : 'error desconocido';
      let permanent =
        err instanceof PermanentFailure ||
        (err instanceof SuiteHttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          ![401, 403, 408, 429].includes(err.status));
      let finalMsg = msg;
      // Pasajero (red, sesion, Addi/Coordinadora caidos): se reintenta SOLO
      // este pedido, unas cuantas veces. Agotados, se avisa.
      if (!permanent && !manual) {
        const retried = await this.scheduleApply(tenantId, orderId, attempt + 1);
        if (!retried) {
          permanent = true;
          finalMsg = `No se pudo cambiar el remitente de la guía de Addi tras varios intentos: ${msg} Hazlo desde el Detalle del pedido.`;
        } else {
          this.logger.warn(`Remitente de Addi (${order.externalId}) se reintentara: ${msg}`);
        }
      }
      await prisma.order
        .update({
          where: { id: orderId },
          data: {
            addiSenderError: finalMsg.slice(0, 500),
            ...(permanent ? { addiSenderPendingAt: null } : {}),
          },
        })
        .catch(() => null);
      if (permanent) {
        await prisma.orderEvent
          .create({
            data: {
              orderId,
              type: 'addi_sender_failed',
              actorId: manual?.userId ?? null,
              actorName: manual ? manual.name?.trim() || manual.email : BOT.name,
              data: { error: finalMsg.slice(0, 500) } as Prisma.InputJsonValue,
            },
          })
          .catch(() => null);
        // En automatico el equipo se entera por el chat; en manual, por la respuesta.
        if (!manual) await this.postToChat(order, `⚠️ ${finalMsg}`, null).catch(() => null);
      }
      if (manual) throw new BadRequestException(msg);
      return false;
    } finally {
      this.running.delete(lock);
    }
  }

  /**
   * Nota + rotulo en la conversacion, firmados por SmartLogistica. Se anuncian
   * con UN chat.message (sin orders.refresh: no cambia ninguna lista).
   */
  private async postToChat(
    order: { id: string; externalId: string; customerName: string; warehouseId: string | null },
    text: string,
    pdf: Buffer | null,
  ): Promise<void> {
    const { tenantId, prisma } = getTenantContext();
    let last = await prisma.orderMessage.create({
      data: {
        orderId: order.id,
        authorId: BOT.id,
        authorName: BOT.name,
        kind: 'system',
        body: text.slice(0, 500),
        imeis: [],
      },
    });
    if (pdf && this.storage.isConfigured()) {
      try {
        const clientName = (order.customerName ?? '').trim().toUpperCase() || order.externalId;
        // Mismo nombre que los rotulos de las guias propias: "Imprimir todo"
        // lo reconoce como LA guia del pedido.
        const fileName = `GUIA-${clientName}.pdf`;
        const key = `tenants/${tenantId}/orders/${order.id}/${slugForKey(fileName)}-${randomUUID()}.pdf`;
        await this.storage.put(key, pdf, 'application/pdf', contentDisposition(fileName));
        last = await prisma.orderMessage.create({
          data: {
            orderId: order.id,
            authorId: BOT.id,
            authorName: BOT.name,
            kind: 'document',
            body: fileName,
            attachmentKey: key,
            attachmentMime: 'application/pdf',
            imeis: [],
          },
        });
      } catch (err) {
        this.logger.warn(
          `Rotulo de Addi no adjuntado (${order.externalId}): ${(err as Error).message}`,
        );
      }
    }
    let participants: string[] = [];
    let feedUserIds: string[] = [];
    try {
      const thread = await prisma.orderMessage.findMany({
        where: { orderId: order.id },
        select: { authorId: true, kind: true, mentions: true },
      });
      participants = [
        ...new Set(
          thread.filter((m) => m.kind !== 'system' && m.authorId !== BOT.id).map((m) => m.authorId),
        ),
      ];
      feedUserIds = [
        ...new Set(
          thread.flatMap((m) => [m.authorId, ...m.mentions]).filter((id) => id !== BOT.id),
        ),
      ];
    } catch {
      // el aviso en vivo es best-effort: los mensajes ya quedaron guardados
    }
    await this.realtime.publish(tenantId, {
      kind: 'chat.message',
      orderId: order.id,
      externalId: order.externalId,
      customerName: order.customerName,
      warehouseId: order.warehouseId,
      messageId: last.id,
      messageKind: last.kind,
      authorId: BOT.id,
      authorName: BOT.name,
      body: text,
      mentions: [],
      replyToId: null,
      replyToAuthorId: null,
      participantIds: participants,
      feedUserIds,
      superMention: false,
      createdAt: last.createdAt.toISOString(),
    });
  }

  /**
   * Al CAMBIAR de sede, el rotulo de la guia de Addi de la sede anterior se
   * elimina YA del chat (lleva el remitente viejo del MISMO numero de guia).
   * Igual que borrar un mensaje a mano: desaparece para el equipo, pero queda
   * copiado en la bitacora y el PROPIETARIO lo sigue viendo en rojo (y su PDF
   * sigue en storage). Solo los rotulos que publico esta automatizacion.
   * Lo llama OrdersService.assign ANTES de su aviso en vivo, para que el chat
   * abierto se refresque ya sin el. Devuelve cuantos elimino.
   */
  async retireLabels(
    orderIds: string[],
    actor: AuditActor,
    toName: string | null,
  ): Promise<number> {
    if (orderIds.length === 0) return 0;
    const { prisma } = getTenantContext();
    const old = await prisma.orderMessage.findMany({
      where: {
        orderId: { in: orderIds },
        authorId: BOT.id,
        kind: 'document',
        body: { startsWith: 'GUIA-' },
      },
    });
    if (old.length === 0) return 0;
    const orders = new Map(
      (
        await prisma.order.findMany({
          where: { id: { in: [...new Set(old.map((m) => m.orderId))] } },
          select: { id: true, externalId: true, customerName: true },
        })
      ).map((o) => [o.id, o]),
    );
    let n = 0;
    for (const msg of old) {
      const gone = await prisma.orderMessage
        .delete({ where: { id: msg.id } })
        .then(() => true)
        .catch(() => false); // ya no estaba (otro traslado simultaneo)
      if (!gone) continue;
      n++;
      const order = orders.get(msg.orderId);
      await this.audit.log(actor, {
        action: 'chat.message_deleted',
        resource: `order:${msg.orderId}`,
        summary: `Eliminó el rótulo anterior de la guía de Addi al transferir el pedido${toName ? ` a ${toName}` : ''}`,
        detail: `📄 ${msg.body ?? 'Rótulo'}`,
        data: {
          // Misma foja que deja deleteMessage: el propietario lo ve en el chat.
          message: {
            id: msg.id,
            kind: msg.kind,
            authorId: msg.authorId,
            authorName: msg.authorName,
            body: msg.body,
            caption: msg.caption,
            attachmentKey: msg.attachmentKey,
            attachmentMime: msg.attachmentMime,
            imeis: msg.imeis,
            mentions: msg.mentions,
            replyToId: msg.replyToId,
            editedAt: msg.editedAt?.toISOString() ?? null,
            createdAt: msg.createdAt.toISOString(),
          },
          externalId: order?.externalId ?? null,
          customerName: order?.customerName ?? null,
          reason: 'addi_transfer',
        },
      });
    }
    return n;
  }

  // === Detalle del pedido ===

  async guideInfo(orderId: string, auth: AuthContext): Promise<AddiGuideInfo> {
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        externalId: true,
        provider: true,
        warehouseId: true,
        status: true,
        rawPayload: true,
        addiGuide: true,
        addiShipment: true,
        addiSenderPendingAt: true,
        addiSenderWarehouseId: true,
        addiSenderAt: true,
        addiSenderError: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    await this.assertOrderAccess(order.warehouseId, auth);

    const lba = order.provider === 'vtex' && isLbaOrder(order.rawPayload);
    let ship = (order.addiShipment ?? null) as ShipmentSnapshot | null;
    let guide = order.addiGuide;
    // Al abrir el Detalle (no hay consultas periodicas): si el estado del
    // paquete es viejo, o es LBA y aun no tiene guia, se relee de Addi. Con
    // tope de tiempo: si Addi tarda, se muestra lo que hay.
    const stale =
      (guide &&
        ship?.packageStatus !== 'DELIVERED' &&
        (!ship?.checkedAt || Date.now() - Date.parse(ship.checkedAt) > STATUS_STALE_MS)) ||
      (!guide && lba);
    let connected = false;
    const creds = await this.credsOrNull().catch(() => null);
    connected = Boolean(creds);
    if (stale && creds) {
      try {
        const fresh = await withTimeout(
          this.findShipment(creds, order.externalId.replace(/^MKT-/, ''), LOOKUP_PAGES),
          DETAIL_TIMEOUT_MS,
        );
        if (fresh?.trackingNumber) {
          ship = snapshot(fresh);
          guide = fresh.trackingNumber;
          await prisma.order.update({
            where: { id: orderId },
            data: { addiGuide: guide, addiShipment: ship as unknown as Prisma.InputJsonValue },
          });
        }
      } catch {
        // se muestra lo guardado
      }
    }

    const appliedName = order.addiSenderWarehouseId
      ? ((
          await prisma.warehouse.findUnique({
            where: { id: order.addiSenderWarehouseId },
            select: { name: true },
          })
        )?.name ?? null)
      : null;
    // 'applied' = la guia lleva el remitente de la sede ACTUAL (un error que
    // quede ahi es una advertencia, p. ej. que el rotulo no salio). Si lleva el
    // de otra sede (lo movieron con la automatizacion apagada) es 'none' y el
    // panel dice de cual es.
    const matchesSede =
      order.addiSenderAt != null && order.addiSenderWarehouseId === order.warehouseId;
    const state: AddiGuideInfo['sender']['state'] = order.addiSenderPendingAt
      ? 'pending'
      : matchesSede
        ? 'applied'
        : order.addiSenderError
          ? 'error'
          : 'none';
    const editable = !ship?.packageStatus || ship.packageStatus === ADDI_EDITABLE_STATUS;
    return {
      connected,
      lba,
      guide,
      carrier: ship?.carrier ?? null,
      packageStatus: ship?.packageStatus ?? null,
      dispatchDeadline: ship?.dispatchDeadline
        ? new Date(ship.dispatchDeadline).toISOString()
        : null,
      syncedAt: ship?.checkedAt ?? null,
      sender: {
        state,
        warehouseName: appliedName,
        at: order.addiSenderAt?.toISOString() ?? null,
        error: order.addiSenderError,
      },
      canApply:
        connected &&
        canManageOrders(auth) &&
        order.provider === 'vtex' &&
        Boolean(guide) &&
        Boolean(order.warehouseId) &&
        editable,
    };
  }

  /** "Cambiar remitente y enviar rótulo" desde el Detalle del pedido. */
  async applyManual(orderId: string, auth: AuthContext): Promise<AddiGuideInfo> {
    if (!canManageOrders(auth))
      throw new ForbiddenException('No tienes permiso para editar guías.');
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { warehouseId: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    await this.assertOrderAccess(order.warehouseId, auth);
    await this.applySender(orderId, auth);
    return this.guideInfo(orderId, auth);
  }

  private async assertOrderAccess(warehouseId: string | null, auth: AuthContext): Promise<void> {
    if (warehouseId === null) {
      if (!canManageOrders(auth)) throw new ForbiddenException('Sin acceso a este pedido');
      return;
    }
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId))
      throw new ForbiddenException('Sin acceso a este pedido');
  }
}

function slugForKey(fileName: string): string {
  return (
    fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  );
}

function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
