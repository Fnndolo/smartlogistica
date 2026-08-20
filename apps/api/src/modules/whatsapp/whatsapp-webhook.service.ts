import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WaMessage as WaMessageDto } from '@smartlogistica/shared';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { Dialog360Client } from './dialog360-client.service';
import { WaConnectionService } from './wa-connection.service';
import { WaPublisherService } from './wa-publisher.service';
import { WaUpsellService } from './wa-upsell.service';
import { normBtn, tenDigits } from './wa-shared';

const MSG_CONFIRMED =
  '¡Muchas gracias por confirmar 🙌 Su pedido ya quedó en alistamiento. Puede seguir el ' +
  'estado de su pedido desde la app de ADDI. Si hay alguna novedad con su pedido, le ' +
  'avisamos enseguida. 😊';
const MSG_ASK_ADDRESS =
  '¡Claro! 😊 Para modificar tu dirección de entrega, escríbela completa en un solo mensaje ' +
  'y sin agregar palabras adicionales.\n\nEjemplo:\nCalle 123 # 1-2, barrio San José, Medellín, ' +
  'Antioquia\n\nPor favor, envía únicamente la dirección con ese formato para poder actualizarla ' +
  'correctamente';
const MSG_RETRY_ADDRESS = 'Por favor vuelve a enviar tu dirección, en un ÚNICO mensaje.';
const msgConfirmDraft = (direccion: string): string =>
  `Le confirmo, su nueva dirección es:\n${direccion}\n\n¿Es correcto?`;

/** Estados del flujo por telefono (WaContact.flowState). */
type FlowState = 'awaiting_address' | 'awaiting_address_retry' | 'confirming' | 'confirming_retry';

// Acceso laxo a los payloads de la Cloud API (forma variable segun el tipo).
type Any = Record<string, any>;

/**
 * Lado de RECEPCION del WhatsApp (webhook de la Cloud API via 360dialog):
 * mensajes entrantes, medios, echoes de coexistencia, historial importado,
 * contactos (state_sync), estados de entrega y el flujo de confirmacion.
 * WhatsappService (la fachada) delega aqui su inboundCloud.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly dialog360: Dialog360Client,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly waConn: WaConnectionService,
    private readonly publisher: WaPublisherService,
    private readonly upsell: WaUpsellService,
  ) {}

  /**
   * Webhook de la CLOUD API (360dialog): mensajes entrantes, medios y — con
   * coexistencia — los ECHOES de lo enviado desde el celular/WhatsApp Web.
   * Corre FUERA del contexto tenant (recibe prisma). Best-effort por mensaje.
   */
  async inboundCloud(tenantId: string, prisma: PrismaClient, payload: unknown): Promise<void> {
    const root = payload as { entry?: Array<{ changes?: Array<{ value?: Any }> }> };
    const touched = new Set<string>();

    for (const entry of root.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        if (!v || typeof v !== 'object') continue;
        // Nombre del contacto segun WhatsApp (viene junto a los mensajes).
        const names = new Map<string, string>();
        for (const c of v.contacts ?? []) {
          if (c?.wa_id && c?.profile?.name) names.set(String(c.wa_id), String(c.profile.name));
        }
        for (const m of v.messages ?? []) {
          const phone = await this.storeCloudMessage(tenantId, prisma, m, 'in', names);
          if (phone) {
            touched.add(phone);
            // El "cerebro" del flujo de confirmacion: botones y captura de la
            // direccion nueva. Best-effort — jamas tumba la recepcion.
            await this.handleFlowReply(tenantId, prisma, phone, m).catch((err) =>
              this.logger.warn(`Flujo de confirmacion fallo (${phone}): ${err instanceof Error ? err.message : err}`),
            );
          }
        }
        // Coexistencia: lo que el negocio envia desde la APP se espeja aqui.
        for (const m of v.message_echoes ?? v.smb_message_echoes ?? []) {
          const phone = await this.storeCloudMessage(tenantId, prisma, m, 'out', names);
          if (phone) touched.add(phone);
        }
        // Ediciones que lleguen en campo propio (formas nuevas de Meta).
        for (const m of v.message_edits ?? []) {
          const phone = await this.storeCloudMessage(tenantId, prisma, m, 'in', names);
          if (phone) touched.add(phone);
        }
        // Diagnostico: campos del webhook que AUN no procesamos — al log.
        const known = [
          'messaging_product', 'metadata', 'contacts', 'messages', 'message_echoes',
          'smb_message_echoes', 'message_edits', 'statuses', 'history', 'state_sync', 'errors',
        ];
        const extra = Object.keys(v).filter((k) => !known.includes(k));
        if (extra.length > 0) {
          this.logger.warn(
            `Webhook Cloud con campos NO procesados [${extra.join(', ')}]: ${JSON.stringify(v).slice(0, 900)}`,
          );
          await prisma.webhookEvent
            .create({
              data: {
                provider: 'wa-debug',
                eventId: `extra-${randomUUID()}`,
                payload: v as Prisma.InputJsonValue,
                status: 'captured',
              },
            })
            .catch(() => null);
        }
        // HISTORIAL de coexistencia (hasta 6 meses del celular, en fases y
        // chunks): se importa TODO con su fecha/estado originales (dedup por
        // wamid). Sin SSE por mensaje (pueden ser miles) — refetch al final.
        const bizPhone = tenDigits(String(v.metadata?.display_phone_number ?? ''));
        for (const h of v.history ?? []) {
          let imported = 0;
          for (const th of h.threads ?? []) {
            for (const hm of th.messages ?? []) {
              const dir =
                bizPhone && tenDigits(String(hm?.from ?? '')) === bizPhone ? 'out' : 'in';
              const phone = await this.storeCloudMessage(tenantId, prisma, hm, dir, names, {
                instant: false,
              });
              if (phone) {
                touched.add(phone);
                imported++;
              }
            }
          }
          this.logger.log(
            `Historial coexistencia: fase ${h?.metadata?.phase ?? '?'} chunk ${h?.metadata?.chunk_order ?? '?'} ` +
              `progreso ${h?.metadata?.progress ?? '?'} -> ${imported} mensajes importados`,
          );
        }
        // Contactos del celular (smb_app_state_sync): nombres para los hilos.
        for (const s of v.state_sync ?? []) {
          if (s?.type !== 'contact' || !s.contact?.phone_number) continue;
          const p = tenDigits(String(s.contact.phone_number));
          const name = String(s.contact.full_name ?? s.contact.first_name ?? '').trim();
          if (p.length < 7 || !name || s.action === 'remove') continue;
          await prisma.waContact
            .upsert({ where: { phone: p }, create: { phone: p, contactId: '', name }, update: { name } })
            .catch(() => null);
        }
        // Estados: 'failed' = Meta NO entrego (ej. 131049) -> el hilo lo anota
        // y, si era una confirmacion, el pedido VUELVE a "Sin enviar".
        // sent/delivered/read -> chulitos del mensaje (como WhatsApp).
        for (const s of v.statuses ?? []) {
          if (!s?.id) continue;
          if (s.status === 'failed') {
            const phone = await this.handleFailedStatus(tenantId, prisma, s).catch((err) => {
              this.logger.warn(`Status failed no procesado: ${err instanceof Error ? err.message : err}`);
              return null;
            });
            if (phone) touched.add(phone);
          } else if (['sent', 'delivered', 'read'].includes(String(s.status))) {
            const phone = await this.applyDeliveryStatus(tenantId, prisma, s).catch(() => null);
            if (phone) touched.add(phone);
          }
        }
      }
    }

    for (const phone of touched) {
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    }

    // El nombre del contacto se refresca con lo que diga WhatsApp.
    // (Se hace al final para no bloquear los mensajes.)
  }

  /**
   * MOTOR del flujo de confirmacion: interpreta los
   * botones y la direccion que escribe el cliente, responde las ramas y
   * actualiza la columna Direccion. Estado por telefono en WaContact.flowState.
   */
  private async handleFlowReply(
    tenantId: string,
    prisma: PrismaClient,
    phone: string,
    m: Any,
  ): Promise<void> {
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    if (!d360) return; // sin conexion no hay como responder

    const contact = await prisma.waContact.findUnique({ where: { phone } });
    const state = (contact?.flowState ?? null) as FlowState | null;

    // Boton tocado (plantilla => type 'button'; sesion => interactive.button_reply).
    const btnTitle = m.interactive?.button_reply?.title ?? m.button?.text ?? null;
    const payload = m.interactive?.button_reply?.id ?? m.button?.payload ?? null;
    const btn = btnTitle ? normBtn(String(btnTitle)) : null;
    const pay = payload ? String(payload) : null;
    const text = m.type === 'text' ? String(m.text?.body ?? '').trim() : '';

    const to = `57${phone}`;
    const say = async (body: string): Promise<void> => {
      const wamid = await this.dialog360.sendText(d360.http, d360.mode, to, body);
      const row = await prisma.waMessage.create({
        data: { phone, direction: 'out', kind: 'text', body, authorName: 'SmartLogística', externalId: wamid, status: wamid ? 'sent' : null },
      });
      await this.publisher.publishWaMessage(tenantId, prisma, row);
    };
    const sayButtons = async (body: string, buttons: Array<{ id: string; title: string }>): Promise<void> => {
      const wamid = await this.dialog360.sendInteractiveButtons(d360.http, d360.mode, to, body, buttons);
      const row = await prisma.waMessage.create({
        data: {
          phone,
          direction: 'out',
          kind: 'text',
          body,
          authorName: 'SmartLogística',
          externalId: wamid,
          status: wamid ? 'sent' : null,
          buttons: buttons.map((b) => b.title) as Prisma.InputJsonValue,
        },
      });
      await this.publisher.publishWaMessage(tenantId, prisma, row);
    };
    const setState = async (flowState: FlowState | null, draftAddress: string | null): Promise<void> => {
      await prisma.waContact.upsert({
        where: { phone },
        create: { phone, contactId: '', flowState, draftAddress },
        update: { flowState, draftAddress },
      });
    };

    if (btn || pay) {
      // ¿El boton de INTERES del respaldo (flujo de venta)? Cancela el flujo,
      // etiqueta "Interesado" y responde al instante.
      if (this.upsell.isInterestButton(pay, btn)) {
        await this.upsell.markInterested(tenantId, prisma, phone);
        await say(this.upsell.interestedReply());
        return;
      }
      // ¿Confirmando el BORRADOR de la direccion nueva?
      if (state === 'confirming' || state === 'confirming_retry') {
        if (pay === 'DRAFT_OK' || btn?.includes('si es correcto')) {
          const addr = contact?.draftAddress?.trim() ?? '';
          await setState(null, null);
          if (addr) await this.applyAddressNative(tenantId, prisma, phone, 'modified', addr);
          await say(MSG_CONFIRMED);
          // Flujo de venta del RESPALDO: toque 1 en 2 minutos (solo celulares).
          await this.upsell.scheduleAfterConfirmation(tenantId, prisma, phone);
          return;
        }
        if (pay === 'DRAFT_NO' || btn?.includes('no es correcto')) {
          await setState('awaiting_address_retry', null);
          await say(MSG_RETRY_ADDRESS);
          return;
        }
      }
      // Botones de la PLANTILLA inicial.
      if (pay === 'CONFIRMED' || btn?.includes('mis datos son correctos') || btn?.includes('datos correctos')) {
        await setState(null, null);
        await this.applyAddressNative(tenantId, prisma, phone, 'confirmed');
        await say(MSG_CONFIRMED);
        // Flujo de venta del RESPALDO: toque 1 en 2 minutos (solo celulares).
        await this.upsell.scheduleAfterConfirmation(tenantId, prisma, phone);
        return;
      }
      if (pay === 'MODIFY' || btn?.includes('modificar')) {
        await setState('awaiting_address', null);
        await say(MSG_ASK_ADDRESS);
        return;
      }
      return;
    }

    // Texto libre mientras esperamos la direccion nueva.
    if (text && (state === 'awaiting_address' || state === 'awaiting_address_retry')) {
      const retry = state === 'awaiting_address_retry';
      await setState(retry ? 'confirming_retry' : 'confirming', text);
      await sayButtons(
        msgConfirmDraft(text),
        retry
          ? [{ id: 'DRAFT_OK', title: 'Sí es correcto.' }]
          : [
              { id: 'DRAFT_OK', title: 'Sí es correcto.' },
              { id: 'DRAFT_NO', title: 'No es correcto.' },
            ],
      );
    }
  }

  /**
   * Aplica la confirmacion/modificacion de direccion a los pedidos PENDIENTES
   * del telefono (nativo, por la Cloud API). Los mensajes ya
   * quedaron en el hilo via el webhook Cloud — aqui solo columna + log.
   */
  private async applyAddressNative(
    tenantId: string,
    prisma: PrismaClient,
    phone: string,
    action: 'confirmed' | 'modified',
    address?: string,
  ): Promise<void> {
    const candidates = await prisma.order.findMany({
      where: {
        customerPhone: { contains: phone },
        provider: { not: 'manual' },
        events: { none: { type: { in: ['vtex_invoiced', 'manual_completed'] } } },
      },
      select: { id: true, customerPhone: true },
    });
    const ids = candidates
      .filter((o) => o.customerPhone && tenDigits(o.customerPhone) === phone)
      .map((o) => o.id);
    if (ids.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: ids } },
        data: {
          addressStatus: action,
          confirmedAddress: action === 'modified' ? (address?.trim() ?? null) : null,
          addressConfirmedAt: new Date(),
        },
      });
    }
    await prisma.confirmationLog
      .create({
        data: {
          phone,
          action,
          address: address?.trim() || null,
          matched: ids.length,
          note: ids.length > 0 ? 'Cloud API (flujo nativo)' : 'Cloud API: sin pedido pendiente con ese telefono',
        },
      })
      .catch(() => null);
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    this.logger.log(`Direccion ${action} via Cloud API: ...${phone} (${ids.length} pedido(s))`);
  }

  /**
   * Meta reporto que un mensaje NO se entrego (status 'failed', ej. 131049
   * "healthy ecosystem"): nota en el hilo y, si era la CONFIRMACION del pedido,
   * se revierte el evento para que el pedido VUELVA a "Sin enviar" (la verdad
   * ante todo — jamas un "Sin responder" de un mensaje que no llego).
   */
  private async handleFailedStatus(
    tenantId: string,
    prisma: PrismaClient,
    s: Any,
  ): Promise<string | null> {
    const wamid = String(s.id);
    const err = Array.isArray(s.errors) ? s.errors[0] : null;
    const detail = err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() : 'motivo desconocido';

    const msg = await prisma.waMessage.findUnique({ where: { externalId: wamid } });
    if (!msg) {
      // Fallo que llego ANTES que el wamid quede escrito: al buzon.
      this.stashStatus(wamid, 'failed', `Meta: ${detail}`);
      return null;
    }
    if (msg.status === 'failed') return null; // ya procesado (reintentos del webhook)
    // Bolita roja + detalle del error EN el mensaje (nada de notas al hilo:
    // el detalle se ve al tocar la bolita). DTO completo: sin refetch.
    await prisma.waMessage
      .update({ where: { id: msg.id }, data: { status: 'failed', error: `Meta: ${detail}` } })
      .catch(() => null);
    await this.publishRow(tenantId, prisma, msg.id);

    // ¿Era una confirmacion? Revertir el evento -> badge "Sin enviar" de nuevo.
    const events = await prisma.orderEvent.findMany({
      where: { type: 'wa_confirmation', data: { path: ['wamid'], equals: wamid } },
      select: { id: true, orderId: true },
    });
    for (const ev of events) {
      await prisma.orderEvent.delete({ where: { id: ev.id } }).catch(() => null);
      await prisma.orderEvent.create({
        data: {
          orderId: ev.orderId,
          type: 'wa_confirmation_failed',
          actorName: 'Meta',
          data: { wamid, error: detail } as Prisma.InputJsonValue,
        },
      });
    }
    if (events.length > 0) {
      await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
      this.logger.warn(`Confirmacion NO entregada (${detail}): ${events.length} pedido(s) vuelven a "Sin enviar"`);
    }

    // ¿Era la GUIA del pedido (marcador guide:<orderId>)? Avisar en el CHAT
    // INTERNO — el negocio debe reenviarla a mano.
    if (msg.contactId?.startsWith('guide:')) {
      const orderId = msg.contactId.slice('guide:'.length);
      await prisma.orderMessage
        .create({
          data: {
            orderId,
            authorId: 'system',
            authorName: 'SmartLogística',
            kind: 'system',
            body: `⚠️ La guía NO se entregó por WhatsApp (${detail}). Reenvíala manualmente al cliente.`,
            imeis: [],
          },
        })
        .catch(() => null);
      await prisma.orderEvent
        .create({
          data: {
            orderId,
            type: 'wa_guide_failed',
            actorName: 'Meta',
            data: { wamid, error: detail } as Prisma.InputJsonValue,
          },
        })
        .catch(() => null);
      await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
      this.logger.warn(`Guia NO entregada por WhatsApp (${detail}): pedido ${orderId}`);
    }
    return null;
  }

  /**
   * Publica el DTO COMPLETO de un mensaje ya actualizado: el panel lo funde en
   * su cache y PINTA AL INSTANTE (cero refetch). El generico {phone} — que
   * obliga a refetchear el hilo entero (~0.5-1s) — queda solo de respaldo.
   */
  private async publishRow(tenantId: string, prisma: PrismaClient, rowId: string): Promise<void> {
    const row = await prisma.waMessage.findUnique({ where: { id: rowId } });
    if (row) await this.publisher.publishWaMessage(tenantId, prisma, row);
  }

  /**
   * BUZON de estados ADELANTADOS: Meta a veces entrega el mensaje y avisa
   * 'delivered' ANTES de que nuestra respuesta HTTP con el wamid termine de
   * volver (el mensaje aun no tiene externalId y el estado se perderia — el
   * ✓✓ quedaba pegado hasta un reintento). Se guarda aqui y se aplica apenas
   * el wamid quede escrito (dispatchWaSend / eco de coexistencia).
   */
  private readonly statusStash = new Map<string, { status: string; error: string | null; at: number }>();

  private stashStatus(wamid: string, status: string, error: string | null): void {
    const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
    const prev = this.statusStash.get(wamid);
    if (!prev || (rank[status] ?? 0) > (rank[prev.status] ?? 0)) {
      this.statusStash.set(wamid, { status, error, at: Date.now() });
    }
    if (this.statusStash.size > 500) {
      const cutoff = Date.now() - 600_000;
      for (const [k, v] of this.statusStash) if (v.at < cutoff) this.statusStash.delete(k);
    }
  }

  /** Aplica (SIN publicar) el estado guardado de un wamid recien escrito.
   * Devuelve true si actualizo la fila (el caller re-lee y publica). */
  async applyStashedStatus(prisma: PrismaClient, wamid: string | null): Promise<boolean> {
    if (!wamid) return false;
    const hit = this.statusStash.get(wamid);
    if (!hit) return false;
    this.statusStash.delete(wamid);
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    const row = await prisma.waMessage.findUnique({
      where: { externalId: wamid },
      select: { id: true, status: true },
    });
    if (!row) return false;
    if ((rank[row.status ?? ''] ?? 0) >= (rank[hit.status] ?? 0)) return false;
    await prisma.waMessage.update({
      where: { id: row.id },
      data: { status: hit.status, ...(hit.error ? { error: hit.error } : {}) },
    });
    return true;
  }

  private async applyDeliveryStatus(
    tenantId: string,
    prisma: PrismaClient,
    s: Any,
  ): Promise<string | null> {
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    const next = String(s.status);
    const row = await prisma.waMessage.findUnique({
      where: { externalId: String(s.id) },
      select: { id: true, phone: true, status: true },
    });
    if (!row) {
      // Llego ANTES que el mensaje (carrera con el wamid): al buzon.
      this.stashStatus(String(s.id), next, null);
      return null;
    }
    if ((rank[row.status ?? ''] ?? 0) >= (rank[next] ?? 0)) return null;
    await prisma.waMessage.update({ where: { id: row.id }, data: { status: next } });
    // Chulito INSTANTANEO: DTO completo, sin refetch.
    await this.publishRow(tenantId, prisma, row.id);
    return null;
  }

  /**
   * Guarda UN mensaje del payload Cloud (con dedup por wamid). Devuelve el
   * telefono. `instant:false` (import de historial) no publica SSE por mensaje.
   */
  private async storeCloudMessage(
    tenantId: string,
    prisma: PrismaClient,
    m: Any,
    direction: 'in' | 'out',
    names: Map<string, string>,
    opts: { instant?: boolean } = {},
  ): Promise<string | null> {
    try {
      const rawPhone = direction === 'in' ? m.from : (m.to ?? m.recipient_id ?? m.from);
      if (!rawPhone) return null;
      const phone = tenDigits(String(rawPhone));
      if (phone.length < 7) return null;
      const externalId = typeof m.id === 'string' ? m.id : null;
      const type = String(m.type ?? 'text');

      // Mensaje EDITADO — se maneja ANTES del dedup: la edicion puede llegar
      // reutilizando el wamid ORIGINAL (y el dedup la descartaba en silencio).
      // Se actualiza el original y se marca "Editado"; JAMAS burbuja nueva.
      if (type === 'edit' || m.edit) {
        // Forma REAL capturada en produccion (wa-debug):
        // { type:'edit', edit:{ original_message_id, message:{ text:{ body } } } }
        const candidates = [
          m.edit?.original_message_id,
          m.edit?.message_id,
          m.edit?.context?.id,
          m.edit?.id,
          m.context?.id,
          m.message?.context?.id,
          m.id,
        ].filter((v): v is string => typeof v === 'string' && v.length > 0);
        const newBody =
          m.edit?.body ??
          m.edit?.text?.body ??
          m.edit?.message?.text?.body ??
          m.message?.text?.body ??
          m.text?.body ??
          null;
        if (newBody != null) {
          for (const wid of [...new Set(candidates)]) {
            const target = await prisma.waMessage.findUnique({
              where: { externalId: wid },
              select: { id: true },
            });
            if (target) {
              await prisma.waMessage.update({
                where: { id: target.id },
                data: { body: String(newBody), edited: true },
              });
              // Edicion INSTANTANEA en el panel: DTO completo, sin refetch.
              if (opts.instant !== false) {
                await this.publishRow(tenantId, prisma, target.id);
                return null;
              }
              return phone;
            }
          }
        }
        // CAPTURA para diagnostico: el payload queda en la DB (WebhookEvent
        // provider 'wa-debug') para implementar la forma exacta con datos.
        this.logger.warn(`Edicion no aplicada (forma desconocida): ${JSON.stringify(m).slice(0, 800)}`);
        await prisma.webhookEvent
          .create({
            data: {
              provider: 'wa-debug',
              eventId: `edit-${randomUUID()}`,
              payload: m as Prisma.InputJsonValue,
              status: 'captured',
            },
          })
          .catch(() => null);
        return phone;
      }

      // Dedup: la Cloud API reintenta entregas del webhook. PERO una EDICION
      // puede llegar como texto normal con el MISMO wamid y el cuerpo nuevo:
      // si el cuerpo CAMBIO, es la edicion -> actualizar y marcar "Editado".
      if (externalId) {
        const dup = await prisma.waMessage.findUnique({
          where: { externalId },
          select: { id: true, body: true },
        });
        if (dup) {
          const newBody = typeof m.text?.body === 'string' ? m.text.body : null;
          if (type === 'text' && newBody != null && newBody !== dup.body) {
            await prisma.waMessage.update({
              where: { id: dup.id },
              data: { body: newBody, edited: true },
            });
            if (opts.instant !== false) {
              await this.publishRow(tenantId, prisma, dup.id);
              return null;
            }
            return phone; // repintar el hilo
          }
          return null;
        }
      }

      // REACCION: no es una burbuja — se pega al mensaje reaccionado (como en
      // WhatsApp). emoji vacio = quitar la reaccion. mine = reaccion del negocio.
      if (type === 'reaction') {
        const targetWamid = typeof m.reaction?.message_id === 'string' ? m.reaction.message_id : null;
        if (!targetWamid) return null;
        const target = await prisma.waMessage.findUnique({
          where: { externalId: targetWamid },
          select: { id: true, reactions: true },
        });
        if (!target) return null;
        const emoji = typeof m.reaction?.emoji === 'string' ? m.reaction.emoji : '';
        const mine = direction === 'out';
        const prev = (Array.isArray(target.reactions) ? target.reactions : []) as Array<{
          emoji: string;
          mine: boolean;
        }>;
        // Una reaccion por lado (cliente/negocio): se reemplaza o se quita.
        const rest = prev.filter((r) => r.mine !== mine);
        const next = emoji ? [...rest, { emoji, mine }] : rest;
        await prisma.waMessage.update({
          where: { id: target.id },
          data: { reactions: next as unknown as Prisma.InputJsonValue },
        });
        // Reaccion INSTANTANEA en el panel: DTO completo, sin refetch.
        if (opts.instant !== false) {
          await this.publishRow(tenantId, prisma, target.id);
          return null;
        }
        return phone;
      }

      let kind: WaMessageDto['kind'] = 'text';
      let body: string | null = null;
      let attachmentKey: string | null = null;
      let mediaUrl: string | null = null;

      if (type === 'text') {
        body = m.text?.body ?? null;
      } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
        const media = m[type] ?? {};
        kind = type === 'document' ? 'file' : (type as WaMessageDto['kind']);
        body = media.caption ?? media.filename ?? null;
        // Bajar el medio YA (la URL de Meta expira en 5 min) y guardarlo nuestro.
        if (media.id) {
          const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
          if (d360 && this.storage.isConfigured()) {
            const bin = await this.dialog360.downloadMedia(d360.http, d360.mode, String(media.id));
            if (bin) {
              const ext = (bin.mime.split('/')[1] ?? 'bin').split(';')[0].trim();
              const key = `tenants/${tenantId}/whatsapp/${phone}/${randomUUID()}.${ext}`;
              await this.storage.put(key, bin.buffer, bin.mime);
              attachmentKey = key;
            } else {
              this.logger.warn(
                `Medio ${type} ${media.id} no se pudo descargar (modo ${d360.mode}); se guarda sin archivo`,
              );
            }
          }
        }
        // Algunos payloads (sandbox) traen la URL directa del medio.
        if (!attachmentKey && typeof media.link === 'string' && /^https?:/.test(media.link)) {
          mediaUrl = media.link;
        }
        if (!attachmentKey && !mediaUrl) body = body ?? `[${type} recibido]`;
        // Diagnostico: si no se pudo bajar, conservar el media id (columna
        // contactId, que los mensajes Cloud no usan) para sondearlo despues.
        if (!attachmentKey && !mediaUrl && media.id) {
          (m as Any).__failedMediaId = String(media.id);
        }
      } else if (type === 'interactive') {
        body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interacción]';
      } else if (type === 'button') {
        body = m.button?.text ?? '[botón]';
      } else if (type === 'location') {
        body = `📍 Ubicación: ${m.location?.latitude ?? '?'}, ${m.location?.longitude ?? '?'}`;
      } else {
        body = `[${type}]`;
      }

      // CITA (responder deslizando): context.id = wamid del mensaje citado.
      let replyToId: string | null = null;
      const quotedWamid = typeof m.context?.id === 'string' ? m.context.id : null;
      if (quotedWamid) {
        const quoted = await prisma.waMessage.findUnique({
          where: { externalId: quotedWamid },
          select: { id: true },
        });
        replyToId = quoted?.id ?? null;
      }

      // Fecha original del mensaje (clave para el HISTORIAL importado) y
      // estado real si viene del historial (history_context).
      const ts = Number(m.timestamp);
      const createdAt = Number.isFinite(ts) && ts > 1_000_000_000 ? new Date(ts * 1000) : null;
      const hStatus =
        typeof m.history_context?.status === 'string'
          ? String(m.history_context.status).toLowerCase()
          : null;
      const outStatus = hStatus
        ? hStatus === 'read' || hStatus === 'played'
          ? 'read'
          : hStatus === 'delivered'
            ? 'delivered'
            : hStatus === 'error'
              ? 'failed'
              : 'sent'
        : 'sent';

      const row = await prisma.waMessage.create({
        data: {
          phone,
          direction,
          kind,
          body,
          attachmentKey,
          mediaUrl,
          replyToId,
          ...(createdAt ? { createdAt } : {}),
          status: direction === 'out' ? outStatus : null,
          // contactId reutilizado como stash de diagnostico del media id fallido.
          contactId: (m as Any).__failedMediaId ? `media:${(m as Any).__failedMediaId}` : null,
          authorName:
            direction === 'out'
              ? 'WhatsApp (celular)'
              : (names.get(String(rawPhone)) ?? null),
          externalId,
        },
      });
      // ¿Un estado llego ANTES que este mensaje (eco de coexistencia)? Aplicarlo ya.
      let fresh = row;
      if (externalId && (await this.applyStashedStatus(prisma, externalId))) {
        fresh = (await prisma.waMessage.findUnique({ where: { id: row.id } })) ?? row;
      }
      // Pintado INSTANTANEO en los paneles abiertos (el mensaje va en el
      // evento). En import de historial NO (pueden ser miles).
      if (opts.instant !== false) await this.publisher.publishWaMessage(tenantId, prisma, fresh);

      // "Visto" INFERIDO: si el cliente CONTESTA, leyo lo anterior. Los
      // recibos de los mensajes enviados desde el CELULAR (coexistencia)
      // jamas llegan por la Cloud API — la respuesta es la mejor señal real:
      // todo lo saliente anterior en sent/delivered pasa a azul. (Los 'read'
      // reales que lleguen despues quedan igual: mismo rango, sin degradar.)
      if (direction === 'in' && opts.instant !== false) {
        const seen = await prisma.waMessage.findMany({
          where: {
            phone,
            direction: 'out',
            status: { in: ['sent', 'delivered'] },
            createdAt: { lte: row.createdAt },
          },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        if (seen.length > 0) {
          await prisma.waMessage.updateMany({
            where: { id: { in: seen.map((u) => u.id) } },
            data: { status: 'read' },
          });
          for (const u of seen) await this.publishRow(tenantId, prisma, u.id);
        }
      }

      // Refrescar el nombre del contacto si WhatsApp lo trae.
      const name = names.get(String(rawPhone));
      if (direction === 'in' && name) {
        await prisma.waContact
          .upsert({
            where: { phone },
            create: { phone, contactId: '', name },
            update: { name },
          })
          .catch(() => null);
      }
      return phone;
    } catch (err) {
      // P2002 = duplicado que se colo en paralelo — ignorar en silencio.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
        return null;
      }
      this.logger.warn(`Mensaje Cloud no guardado: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
