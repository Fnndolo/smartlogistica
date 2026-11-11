import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ADDI_EDITABLE_STATUS,
  ADDI_PACKAGE_STATUS_LABEL,
  type AddiGuideInfo,
  type AddiLbaConnectionInput,
  type AddiLbaConnectionSummary,
  type AddiLbaSyncResult,
} from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { canManageOrders, isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { QUEUE_ADDI_LBA } from '../../../infrastructure/queue/queue.module';
import { RealtimeService } from '../../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { buildSenderUpdate } from './addi-guide-edit';
import { AddiPortalClient, type AddiCreds, type AddiShipment } from './addi-portal-client.service';
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
interface ShipmentSnapshot {
  carrier: string | null;
  packageStatus: string | null;
  dispatchDeadline: string | null;
}

/** Un fallo que no se arregla reintentando (se avisa en el chat y se deja). */
class PermanentFailure extends Error {}

/** Quien firma en el chat lo que hace la automatizacion. */
const BOT = { id: 'system', name: 'SmartLogística' } as const;
/** Pedidos "recientes" que aun pueden recibir guia de Addi aunque no la tengamos. */
const RECENT_MS = 3 * 24 * 60 * 60_000;
/** Si en 48 h no se pudo, se deja de intentar (queda el error a la vista). */
const GIVE_UP_MS = 48 * 60 * 60_000;
/** La lista de Addi se reutiliza este tiempo entre pedidos de un mismo lote. */
const SHIPMENTS_TTL_MS = 60_000;
const BATCH = 25;

/**
 * GUIAS DE ADDI (Addi Logistics). Ver addi-lba.schema.ts en shared.
 *
 *  - Sincroniza el numero de guia de cada pedido VTEX desde el portal de
 *    aliados de Addi (cruce por MKT), cada pocos minutos.
 *  - Al pasar un pedido a una sede (asignar / transferir) marca "pendiente"
 *    el cambio de remitente. Se aplica en cuanto haya guia: edita la guia en
 *    la suite de Coordinadora con el remitente de ESA sede, verifica y deja el
 *    rotulo en la conversacion del pedido.
 *
 * Solo se marcan pendientes los traslados que ocurren con la automatizacion
 * encendida: activarla NO reescribe en masa las guias de pedidos que ya
 * estaban en sedes (esos tienen el boton manual en el Detalle).
 */
@Injectable()
export class AddiLbaService {
  private readonly logger = new Logger(AddiLbaService.name);
  private readonly credsCache = new Map<string, { at: number; value: Creds | null }>();
  private readonly shipmentsCache = new Map<string, { at: number; list: AddiShipment[] }>();
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
  ) {}

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
    this.shipmentsCache.delete(tenantId);
    const out = await this.summary(auth);
    return out!;
  }

  async disconnect(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    await prisma.addiLbaConnection.deleteMany({});
    this.credsCache.delete(tenantId);
    this.shipmentsCache.delete(tenantId);
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

  private async shipments(creds: Creds, fresh: boolean): Promise<AddiShipment[]> {
    const { tenantId } = getTenantContext();
    const hit = this.shipmentsCache.get(tenantId);
    if (!fresh && hit && Date.now() - hit.at < SHIPMENTS_TTL_MS) return hit.list;
    const list = await this.portal.listShipments(creds.portal);
    this.shipmentsCache.set(tenantId, { at: Date.now(), list });
    return list;
  }

  // === Sincronizacion de guias ===

  async syncNow(auth: AuthContext): Promise<AddiLbaSyncResult> {
    this.assertAdmin(auth);
    const creds = await this.credsOrNull();
    if (!creds) throw new BadRequestException('Configura primero la conexión de guías de Addi');
    try {
      return await this.syncTenant();
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'No se pudo sincronizar');
    }
  }

  /**
   * Trae TODOS los envios LBA de Addi y actualiza la guia de los pedidos que
   * cruzan por MKT. Solo escribe los que cambiaron.
   */
  async syncTenant(): Promise<AddiLbaSyncResult> {
    const { prisma } = getTenantContext();
    const creds = await this.credsOrNull();
    if (!creds) return { shipments: 0, matched: 0, updated: 0 };
    let list: AddiShipment[];
    try {
      list = await this.shipments(creds, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error desconocido';
      await prisma.addiLbaConnection.updateMany({
        data: { status: 'error', lastError: msg.slice(0, 500) },
      });
      throw err;
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
        const next: ShipmentSnapshot = {
          carrier: s.carrier,
          packageStatus: s.packageStatus,
          dispatchDeadline: s.dispatchDeadline,
        };
        const prev = (o.addiShipment ?? null) as ShipmentSnapshot | null;
        const same =
          o.addiGuide === s.trackingNumber &&
          prev?.carrier === next.carrier &&
          prev?.packageStatus === next.packageStatus &&
          prev?.dispatchDeadline === next.dispatchDeadline;
        if (same) continue;
        await prisma.order.update({
          where: { id: o.id },
          data: {
            addiGuide: s.trackingNumber,
            addiShipment: next as unknown as Prisma.InputJsonValue,
          },
        });
        updated++;
      }
    }
    await prisma.addiLbaConnection.updateMany({
      data: {
        status: 'connected',
        lastError: null,
        lastSyncAt: new Date(),
        lastSyncCount: matched,
      },
    });
    return { shipments: list.length, matched, updated };
  }

  // === Cambio de remitente ===

  /**
   * Llamado al ASIGNAR / TRANSFERIR pedidos (OrdersService.assign). Marca
   * pendiente el cambio de remitente y lo dispara ya; si Addi aun no genero la
   * guia, el ciclo periodico lo aplica cuando aparezca. Devolver a generales
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
      const res = await prisma.order.updateMany({
        where: {
          id: { in: orderIds },
          provider: 'vtex',
          OR: [
            { addiGuide: { not: null } },
            { marketplaceCreatedAt: { gte: new Date(Date.now() - RECENT_MS) } },
          ],
        },
        data: { addiSenderPendingAt: new Date(), addiSenderError: null },
      });
      if (res.count === 0) return;
      await this.queue.add(
        'apply',
        { tenantId, orderIds },
        { delay: 1_500, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo programar el cambio de remitente de Addi: ${(err as Error).message}`,
      );
    }
  }

  /** Aplica los pendientes del tenant (ciclo periodico, tras sincronizar). */
  async processPending(): Promise<{ applied: number }> {
    const { prisma } = getTenantContext();
    const creds = await this.credsOrNull();
    if (!creds) return { applied: 0 };
    const rows = await prisma.order.findMany({
      where: { addiSenderPendingAt: { not: null } },
      select: { id: true, addiGuide: true, addiSenderPendingAt: true, addiSenderError: true },
      orderBy: { addiSenderPendingAt: 'asc' },
      take: BATCH,
    });
    let applied = 0;
    for (const r of rows) {
      const age = Date.now() - r.addiSenderPendingAt!.getTime();
      if (age > GIVE_UP_MS) {
        await prisma.order.updateMany({
          where: { id: r.id, addiSenderPendingAt: r.addiSenderPendingAt },
          data: {
            addiSenderPendingAt: null,
            addiSenderError: r.addiGuide
              ? `No se pudo cambiar el remitente en 48 h. Último error: ${r.addiSenderError ?? 'desconocido'}`.slice(
                  0,
                  500,
                )
              : 'Addi no generó guía para este pedido.',
          },
        });
        continue;
      }
      if (!r.addiGuide) continue; // la sincronizacion la traera
      if ((await this.applySender(r.id).catch(() => false)) === true) applied++;
    }
    return { applied };
  }

  /**
   * Cambia el remitente de la guia de Addi del pedido al de SU sede actual y
   * deja el rotulo en la conversacion. `manual` = lo pidio alguien desde el
   * Detalle (los errores le llegan como respuesta en vez de quedar en cola).
   * Devuelve true si se aplico.
   */
  async applySender(orderId: string, manual?: AuthContext): Promise<boolean> {
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

      // 1. La guia y su estado en Addi (lista cacheada 60 s: un lote de
      //    traslados no la pide una vez por pedido).
      const ship = (await this.shipments(creds, false)).find((s) => s.orderId === mkt) ?? null;
      const guide = ship?.trackingNumber ?? order.addiGuide;
      if (ship?.trackingNumber && ship.trackingNumber !== order.addiGuide) {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            addiGuide: ship.trackingNumber,
            addiShipment: {
              carrier: ship.carrier,
              packageStatus: ship.packageStatus,
              dispatchDeadline: ship.dispatchDeadline,
            } as Prisma.InputJsonValue,
          },
        });
      }
      if (!guide) {
        // No es un error: Addi genera la guia unos minutos despues del pedido.
        // Queda pendiente y el ciclo periodico lo aplica cuando aparezca.
        await prisma.order.update({
          where: { id: orderId },
          data: {
            addiSenderError: 'Esperando a que Addi genere la guía.',
            addiSenderPendingAt: order.addiSenderPendingAt ?? new Date(),
          },
        });
        if (manual) {
          throw new BadRequestException(
            'Addi todavía no ha generado la guía de este pedido. El remitente se cambiará solo cuando aparezca.',
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

      // 3. La guia en la suite: que exista, que no este anulada y que SEA de
      //    este pedido (esa cuenta ve las guias de todos los comercios de Addi).
      const row = await this.suite.findGuide(creds.suite, guide);
      if (!row)
        throw new PermanentFailure(
          `La guía ${guide} no aparece en la suite de Coordinadora de Addi.`,
        );
      if (/anulad/i.test(row.estado_guia ?? '')) {
        throw new PermanentFailure(`La guía ${guide} está anulada en Coordinadora.`);
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
      // Definitivo a proposito: reintentar cada pocos minutos seria volver a
      // escribir sobre la guia sin saber por que no tomo el cambio.
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
      const msg = err instanceof Error ? err.message : 'error desconocido';
      const permanent =
        err instanceof PermanentFailure ||
        (err instanceof SuiteHttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          ![401, 403, 408, 429].includes(err.status));
      if (err instanceof BadRequestException && manual) throw err;
      await prisma.order
        .update({
          where: { id: orderId },
          data: {
            addiSenderError: msg.slice(0, 500),
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
              data: { error: msg.slice(0, 500) } as Prisma.InputJsonValue,
            },
          })
          .catch(() => null);
        // En automatico el equipo se entera por el chat; en manual, por la respuesta.
        if (!manual) await this.postToChat(order, `⚠️ ${msg}`, null).catch(() => null);
      } else {
        this.logger.warn(`Remitente de Addi (pedido ${order.externalId}) se reintentara: ${msg}`);
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

  // === Detalle del pedido ===

  async guideInfo(orderId: string, auth: AuthContext): Promise<AddiGuideInfo> {
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        provider: true,
        warehouseId: true,
        status: true,
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

    const conn = await prisma.addiLbaConnection.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { lastSyncAt: true },
    });
    const ship = (order.addiShipment ?? null) as ShipmentSnapshot | null;
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
      connected: Boolean(conn),
      guide: order.addiGuide,
      carrier: ship?.carrier ?? null,
      packageStatus: ship?.packageStatus ?? null,
      dispatchDeadline: ship?.dispatchDeadline
        ? new Date(ship.dispatchDeadline).toISOString()
        : null,
      syncedAt: conn?.lastSyncAt?.toISOString() ?? null,
      sender: {
        state,
        warehouseName: appliedName,
        at: order.addiSenderAt?.toISOString() ?? null,
        error: order.addiSenderError,
      },
      canApply:
        Boolean(conn) &&
        canManageOrders(auth) &&
        order.provider === 'vtex' &&
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
