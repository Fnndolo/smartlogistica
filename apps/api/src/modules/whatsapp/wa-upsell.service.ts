import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_WA_UPSELL } from '../../infrastructure/queue/queue.module';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { tenantContext } from '../../infrastructure/tenant-context';
import { Dialog360Client } from './dialog360-client.service';
import { WaConnectionService } from './wa-connection.service';
import { WaFlowService } from './wa-flow.service';
import { WaPublisherService } from './wa-publisher.service';
import { normBtn, tenDigits } from './wa-shared';

/**
 * FLUJO DE VENTA del RESPALDO de telefonos (complementa el de confirmacion):
 * 3 toques SOLO para pedidos de CELULARES (categoria VTEX "Smartphones"/
 * "Celulares" o nombre del producto), cada uno con UN boton de interes.
 *
 * 1. +2 min despues del "gracias por confirmar" -> "mientras preparamos su envio"
 * 2. +2 min despues de enviar la GUIA           -> "mientras llega su equipo"
 * 3. Coordinadora reporta ENTREGADO             -> PLANTILLA (sin ventana 24h)
 *
 * Si el cliente toca el boton EN CUALQUIER momento: el flujo se CANCELA, el
 * chat queda etiquetado "Interesado" (naranja) y se le responde al instante.
 * Los toques pendientes re-verifican todo antes de salir (label, duplicado,
 * categoria) — un job encolado nunca dispara de mas.
 */

/** Boton de los toques 1 y 2 (sesion; max 20 caracteres). Primera persona y
 * compromiso: quien lo toca ya DECIDIO comprar (el asesor solo coordina el
 * pago) — nada de "me interesa" tibio. */
export const UPSELL_BUTTON = { id: 'upsell_interes', title: '¡Quiero mi respaldo!' };
/** Boton de las plantillas del toque 3 (los quick reply llegan como texto). */
export const UPSELL_TEMPLATE_BUTTON = 'Quiero mi respaldo';
/** Prioridad FIJA de la plantilla del toque 3 (primera APROBADA gana). */
const UPSELL_TEMPLATE_PRIORITY = [
  ...(process.env.D360_UPSELL_TEMPLATE ? [process.env.D360_UPSELL_TEMPLATE] : []),
  'respaldo_entregado_pro', // copy de VENTA: necesidad + info completa + cierre
  'respaldo_entregado_full',
  'respaldo_entregado_smart',
];
/** Etiqueta (con color) que marca al cliente que toco el boton. */
const INTERESTED_LABEL = 'Interesado';
const INTERESTED_COLOR = '#f59e0b';

const STEP_DELAY_MS = 2 * 60_000;

// COPY DE VENTA: pre-vende completo (necesidad + cobertura + precio + cuotas)
// para que el boton sea la DECISION de compra — el asesor solo coordina las
// cuotas y el medio de pago.
const MSG_STEP1 =
  'Mientras preparamos su envío 📦, piense en esto un segundo:\n\n' +
  'Usted acaba de invertir en un equipo nuevo. Ahora imagine que a los pocos días se lo roban en la calle 🚨 o se le va al piso y la pantalla no sobrevive 📱💥… tocaría empezar de cero, pagando todo otra vez.\n\n' +
  'Para que esa NUNCA sea su historia, existe el RESPALDO de Smart Gadgets 🛡️:\n\n' +
  '✅ Cubre ROBO, caídas y accidentes\n' +
  '✅ Protección por UN AÑO completo\n' +
  '✅ Cuesta solo el 10% del valor de su equipo\n' +
  '✅ Y lo paga en cuotas cómodas con Addi 💙\n\n' +
  'Estrenar tranquilo cuesta poquito — perder el equipo cuesta TODO.\n\n' +
  'Toque el botón y su asesor le confirma de una vez las cuotas y el medio de pago 👇';

const MSG_STEP2 =
  '🚚 ¡Su equipo ya va en camino!\n\n' +
  'Y justo ahora toca decidir algo importante: ¿qué pasa si se lo roban 🚨 o se le cae al tercer día de estreno? 📱💥 Nadie lo planea — por eso es lo que más duele en el bolsillo.\n\n' +
  'Con el RESPALDO de Smart Gadgets eso deja de ser un riesgo:\n\n' +
  '✅ ROBO, caídas y accidentes cubiertos\n' +
  '✅ UN AÑO completo de protección\n' +
  '✅ Solo el 10% del valor de su equipo\n' +
  '✅ En cuotas cómodas con Addi 💙\n\n' +
  'Su equipo llega en cualquier momento — que llegue ya protegido.\n\n' +
  'Toque el botón y su asesor le confirma de una vez las cuotas y el medio de pago 👇';

interface UpsellJob {
  tenantId: string;
  orderId: string;
  step: 1 | 2;
}

/** ¿El pedido es de CELULARES? Categoria VTEX o, si no viene, el nombre. */
export function isPhoneOrder(rawPayload: unknown): boolean {
  const raw = (rawPayload ?? {}) as { items?: Array<Record<string, unknown>> };
  const items = Array.isArray(raw.items) ? raw.items : [];
  const CAT = /smartphone|celular/i;
  const NAME =
    /\b(celular|smartphone|iphone|galaxy|xiaomi|redmi|poco|motorola|moto\s|honor|infinix|tecno|oppo|realme|vivo|samsung)\b/i;
  for (const it of items) {
    const info = (it.additionalInfo ?? {}) as { categories?: Array<{ name?: unknown }> };
    if ((info.categories ?? []).some((c) => CAT.test(String(c?.name ?? '')))) return true;
    if (NAME.test(String(it.name ?? ''))) return true;
  }
  return false;
}

@Injectable()
export class WaUpsellService {
  private readonly logger = new Logger(WaUpsellService.name);

  constructor(
    @InjectQueue(QUEUE_WA_UPSELL) private readonly queue: Queue,
    private readonly dialog360: Dialog360Client,
    private readonly waConn: WaConnectionService,
    private readonly flows: WaFlowService,
    private readonly publisher: WaPublisherService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Toque 1: tras el "gracias por confirmar" — busca el pedido del telefono. */
  async scheduleAfterConfirmation(
    tenantId: string,
    prisma: PrismaClient,
    rawPhone: string,
  ): Promise<void> {
    try {
      const phone = tenDigits(rawPhone);
      if (phone.length < 7) return;
      const candidates = await prisma.order.findMany({
        where: { customerPhone: { contains: phone } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, customerPhone: true, rawPayload: true },
      });
      const order = candidates.find((o) => tenDigits(o.customerPhone ?? '') === phone);
      if (!order || !isPhoneOrder(order.rawPayload)) return;
      await this.scheduleStep(tenantId, order.id, 1);
    } catch (err) {
      this.logger.warn(
        `Upsell post-confirmacion fallo: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Encola un toque diferido (+2 min). Dedupe por jobId: nunca dos veces. */
  async scheduleStep(tenantId: string, orderId: string, step: 1 | 2): Promise<void> {
    try {
      await this.queue.add('step', { tenantId, orderId, step } satisfies UpsellJob, {
        delay: STEP_DELAY_MS,
        jobId: `upsell:${orderId}:${step}`,
        attempts: 3,
      });
    } catch (err) {
      this.logger.warn(
        `Upsell no encolado (${orderId} paso ${step}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Ejecuta un toque (lo llama el processor con el contexto del tenant ya
   * montado, o directo el paso 3 desde el refresco de envios). Re-verifica
   * TODO: pedido de celular, telefono, no-interesado, no-duplicado.
   */
  async runStep(
    tenantId: string,
    prisma: PrismaClient,
    orderId: string,
    step: 1 | 2 | 3,
  ): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerPhone: true,
        customerName: true,
        rawPayload: true,
        provider: true,
        accountName: true,
      },
    });
    if (!order?.customerPhone) return;
    // ¿Encendido para la tienda de este pedido? Sin filas configuradas
    // devuelve siempre "si" (el comportamiento de antes, intacto).
    if (!(await this.flows.resolve(prisma, 'upsell', order))) return;
    const phone = tenDigits(order.customerPhone);
    if (phone.length < 7) return;
    if (!isPhoneOrder(order.rawPayload)) return;

    // ¿Ya toco el boton alguna vez? El flujo esta CANCELADO para este chat.
    const contact = await prisma.waContact.findUnique({
      where: { phone },
      select: { labels: true },
    });
    const labels = Array.isArray(contact?.labels) ? (contact?.labels as unknown[]).map(String) : [];
    if (labels.includes(INTERESTED_LABEL)) return;

    // ¿Este toque ya salio para este pedido? (dedupe de verdad, contra DB)
    const sent = await prisma.orderEvent.findFirst({
      where: { orderId, type: 'wa_upsell', data: { path: ['step'], equals: step } },
      select: { id: true },
    });
    if (sent) return;

    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    if (!d360 || d360.mode !== 'production') return;

    let wamid: string | null = null;
    let body: string;
    let buttons: string[] = [];
    if (step === 3) {
      // ENTREGADO -> plantilla (no depende de la ventana de 24h).
      const list = await this.dialog360.listTemplates(d360.http).catch(() => []);
      const tpl = UPSELL_TEMPLATE_PRIORITY.map((n) =>
        list.find((x) => x.name === n && x.status === 'approved'),
      ).find(Boolean);
      if (!tpl) {
        this.logger.warn('Upsell paso 3: sin plantilla de respaldo APROBADA en la WABA aun');
        return;
      }
      const nombre = (order.customerName ?? '').trim().split(/\s+/)[0] || 'Hola';
      wamid = await this.dialog360.sendTemplate(
        d360.http,
        d360.mode,
        `57${phone}`,
        tpl.name,
        tpl.language,
        [{ type: 'body', parameters: [{ type: 'text', text: nombre }] }],
      );
      body = tpl.body.replace('{{1}}', nombre);
      buttons = [UPSELL_TEMPLATE_BUTTON];
    } else {
      // Toques 1 y 2: mensaje de SESION con boton (el cliente acaba de
      // interactuar; si la ventana cerro, queda la bolita roja con motivo).
      body = step === 1 ? MSG_STEP1 : MSG_STEP2;
      buttons = [UPSELL_BUTTON.title];
      wamid = await this.dialog360.sendInteractiveButtons(
        d360.http,
        d360.mode,
        `57${phone}`,
        body,
        [UPSELL_BUTTON],
      );
    }

    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        lineId: d360.lineId,
        kind: 'text',
        body,
        buttons: buttons as unknown as Prisma.InputJsonValue,
        authorName: 'SmartLogística',
        externalId: wamid,
        status: wamid ? 'sent' : null,
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    await prisma.orderEvent
      .create({
        data: {
          orderId,
          type: 'wa_upsell',
          actorName: 'SmartLogística',
          data: { step, phone, wamid } as Prisma.InputJsonValue,
        },
      })
      .catch(() => null);
    this.logger.log(`Upsell paso ${step} enviado (pedido ${orderId})`);
  }

  /** Paso 3 directo (transicion a ENTREGADO): sin delay, best-effort. */
  triggerDelivered(tenantId: string, prisma: PrismaClient, orderId: string): void {
    void this.runStep(tenantId, prisma, orderId, 3).catch((err) =>
      this.logger.warn(
        `Upsell entregado fallo (${orderId}): ${err instanceof Error ? err.message : err}`,
      ),
    );
  }

  /** ¿Este boton es el del respaldo? (sesion O plantilla, todas las
   * versiones: 'quiero mi respaldo', 'me interesa'...). btn llega normalizado. */
  isInterestButton(pay: string | null, btn: string | null): boolean {
    return (
      pay === UPSELL_BUTTON.id ||
      (btn != null && (btn.includes('respaldo') || btn === 'me interesa'))
    );
  }

  /**
   * El cliente toco el boton: CANCELA el flujo (los toques pendientes se
   * vuelven no-op por la etiqueta) + etiqueta "Interesado" con color.
   */
  async markInterested(tenantId: string, prisma: PrismaClient, rawPhone: string): Promise<void> {
    const phone = tenDigits(rawPhone);
    await prisma.waLabel
      .upsert({
        where: { name: INTERESTED_LABEL },
        create: { name: INTERESTED_LABEL, color: INTERESTED_COLOR },
        update: {},
      })
      .catch(() => null);
    const contact = await prisma.waContact.findUnique({
      where: { phone },
      select: { labels: true },
    });
    const labels = Array.isArray(contact?.labels) ? (contact?.labels as unknown[]).map(String) : [];
    if (!labels.includes(INTERESTED_LABEL)) {
      const next = [...labels, INTERESTED_LABEL];
      await prisma.waContact.upsert({
        where: { phone },
        create: { phone, contactId: '', labels: next as unknown as Prisma.InputJsonValue },
        update: { labels: next as unknown as Prisma.InputJsonValue },
      });
    }
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone }).catch(() => null);
    this.logger.log(`Cliente ${phone} INTERESADO en el respaldo (flujo cancelado, etiquetado)`);
  }
}

/** Worker de los toques diferidos: monta el contexto del tenant y ejecuta. */
@Processor(QUEUE_WA_UPSELL)
export class WaUpsellProcessor extends WorkerHost {
  private readonly logger = new Logger(WaUpsellProcessor.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly upsell: WaUpsellService,
  ) {
    super();
  }

  async process(job: Job<UpsellJob>): Promise<void> {
    const { tenantId, orderId, step } = job.data;
    const { client: prisma, slug } = await this.tenants.getForTenant(tenantId);
    await tenantContext.run({ tenantId, tenantSlug: slug, prisma }, async () => {
      await this.upsell.runStep(tenantId, prisma, orderId, step);
    });
  }
}
