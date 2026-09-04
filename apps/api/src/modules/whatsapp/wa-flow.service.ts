import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  CreateWaLineInput,
  SaveWaFlowInput,
  UpdateWaLineInput,
  WaConfigOverview,
  WaFlow,
  WaFlowConfig,
  WaFlowKind,
  WaLineSummary,
  WaSource,
} from '@smartlogistica/shared';
import { waFlowConfigSchema, waFlowKindSchema } from '@smartlogistica/shared';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import { canUseWhatsapp, isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { Dialog360Client } from './dialog360-client.service';
import { WaClientFactory } from './wa-client.factory';
import { WaConnectionService } from './wa-connection.service';
import {
  DEFAULT_CONFIRMATION_MAX_AGE_HOURS,
  DEFAULT_UPSELL_STEP_DELAY_MINUTES,
  MSG_ASK_ADDRESS,
  MSG_CONFIRMED,
  MSG_RETRY_ADDRESS,
  MSG_STEP1,
  MSG_STEP2,
} from './wa-shared';
import { loadPlatforms } from '../orders/platforms.store';

/** Un pedido, en lo minimo que hace falta para saber a que flujo pertenece. */
export interface FlowOrderRef {
  provider: string;
  accountName: string | null;
  /** Los montados a mano guardan su plataforma aqui: `platform: {id, name}`. */
  rawPayload?: unknown;
}

/**
 * MENSAJES AUTOMATICOS DE WHATSAPP: que flujo aplica a que pedido y por que
 * linea sale.
 *
 * REGLA QUE GOBIERNA TODO — y de la que depende que esto se pueda soltar sin
 * cambiarle el comportamiento a nadie:
 *
 *   Si NO existe ninguna fila de un `kind`, ese flujo se comporta EXACTAMENTE
 *   como estaba cableado en codigo (encendido, por la linea predeterminada,
 *   para todos los pedidos).
 *
 *   En cuanto existe al menos una fila de ese `kind`, manda la tabla: un pedido
 *   que no encaje con ninguna regla NO recibe el mensaje. Es predecible y es lo
 *   que espera quien escribe reglas — pero la pantalla tiene que decirlo en voz
 *   alta, y por eso `overview()` devuelve `unconfigured`.
 */
@Injectable()
export class WaFlowService {
  constructor(
    private readonly control: ControlPlaneService,
    private readonly envelope: EnvelopeService,
    private readonly dialog360: Dialog360Client,
    private readonly waConn: WaConnectionService,
    private readonly clients: WaClientFactory,
  ) {}

  /**
   * Clave canonica de FUENTE de un pedido. La misma en las reglas y en los
   * alcances: un solo formato, un solo bug posible.
   */
  static sourceKeyOf(order: FlowOrderRef): string {
    if (order.provider !== 'manual') return `${order.provider}:${order.accountName ?? ''}`;
    // Los pedidos montados a mano no tienen columna de plataforma: viaja
    // dentro del rawPayload, que es donde la escribe quien monta el pedido.
    const raw = order.rawPayload as { platform?: { id?: unknown } } | null | undefined;
    const id = typeof raw?.platform?.id === 'string' ? raw.platform.id : null;
    return `manual:${id ?? 'manual'}`;
  }

  /**
   * ¿Sale este mensaje automatico para este pedido? Devuelve la linea por la
   * que debe salir, o null si NO debe enviarse.
   *
   * `undefined` en `lineId` significa "la de siempre" (la predeterminada), que
   * es lo que hace el codigo cuando aun no hay ninguna fila configurada.
   */
  async resolve(
    prisma: PrismaClient,
    kind: WaFlowKind,
    order: FlowOrderRef,
  ): Promise<{ lineId: string | null; config: WaFlowConfig } | null> {
    const rows = await prisma.waFlow.findMany({ where: { kind } });

    // Sin filas de este tipo: comportamiento de siempre, intacto.
    if (rows.length === 0) return { lineId: null, config: {} };

    const src = WaFlowService.sourceKeyOf(order);
    const matching = rows
      .filter((r) => r.enabled)
      .map((r) => ({ row: r, scope: toScope(r.scope) }))
      .filter((r) => r.scope.includes(src) || r.scope.includes('*'));

    if (matching.length === 0) return null;

    // El alcance EXACTO gana sobre '*' pase lo que pase con la prioridad; luego
    // prioridad mayor; luego el mas antiguo (determinista siempre).
    matching.sort((a, b) => {
      const ax = a.scope.includes(src) ? 0 : 1;
      const bx = b.scope.includes(src) ? 0 : 1;
      if (ax !== bx) return ax - bx;
      if (a.row.priority !== b.row.priority) return b.row.priority - a.row.priority;
      return a.row.createdAt.getTime() - b.row.createdAt.getTime();
    });

    const win = matching[0]!;
    const parsed = waFlowConfigSchema.safeParse(win.row.config);
    return { lineId: win.row.lineId, config: parsed.success ? parsed.data : {} };
  }

  // === Pantalla de configuracion ===

  async overview(auth: AuthContext): Promise<WaConfigOverview> {
    if (!canUseWhatsapp(auth)) throw new ForbiddenException('Sin acceso a WhatsApp');
    const { prisma } = getTenantContext();

    const [lineRows, flowRows, conns] = await Promise.all([
      prisma.waLine.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
      prisma.waFlow.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.marketplaceConnection.findMany({
        where: { provider: 'vtex' },
        select: { accountName: true, label: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const lines: WaLineSummary[] = lineRows.map(toLineSummary);
    const byId = new Map(lines.map((l) => [l.id, l.label]));
    const flows: WaFlow[] = flowRows.map((r) => toFlow(r, byId.get(r.lineId) ?? '—'));

    // Fuentes a las que se puede apuntar un flujo: las tiendas conectadas mas
    // las plataformas de los pedidos montados a mano.
    const platforms = await loadPlatforms().catch(() => []);
    const sources: WaSource[] = [
      ...conns.map((c) => ({
        key: `vtex:${c.accountName}`,
        label: c.label?.trim() || c.accountName,
      })),
      ...platforms
        .filter((p) => p.id !== 'vtex')
        .map((p) => ({ key: `manual:${p.id}`, label: p.name })),
    ];

    const kinds = waFlowKindSchema.options;
    const configured = new Set(flowRows.map((r) => r.kind));

    return {
      lines,
      flows,
      sources,
      // Con una sola linea y una sola fuente, elegir alcance no informa de nada.
      showScope: lines.length > 1 || sources.length > 1,
      unconfigured: kinds.filter((k) => !configured.has(k)),
    };
  }

  // === LINEAS ===

  /**
   * Da de alta una linea nueva. NO toca las que ya existen: es lo que separa
   * esto de la vieja tarjeta de Conexiones, que solo sabia pisar la unica.
   *
   * En 360dialog el webhook se configura solo (su API lo permite). En Meta hay
   * que pegarlo a mano en el panel de la App, asi que el alta devuelve la URL y
   * el token de verificacion para que el usuario los copie.
   */
  async createLine(
    input: CreateWaLineInput,
    auth: AuthContext,
    publicBaseUrl: string,
  ): Promise<WaLineSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const secret = process.env.CONFIRMATION_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException('Falta CONFIRMATION_WEBHOOK_SECRET en el servidor');
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant no encontrado');

    // La linea se crea PRIMERO para tener su id: el webhook lleva ?line=<id>,
    // que es lo que hace que se le conteste al cliente por SU numero y no por
    // otro. Si la validacion falla despues, se borra.
    const encryptedApiKey = await this.envelope.encryptField(tenantId, input.apiKey);
    const encryptedAppSecret = input.appSecret
      ? await this.envelope.encryptField(tenantId, input.appSecret)
      : null;
    const isMeta = input.provider === 'meta';
    const verifyToken = isMeta ? randomBytes(16).toString('hex') : null;

    const line = await prisma.waLine.create({
      data: {
        label: input.label,
        provider: input.provider,
        encryptedApiKey,
        encryptedAppSecret,
        phoneNumberId: input.phoneNumberId ?? null,
        wabaId: input.wabaId ?? null,
        verifyToken,
        countryCode: input.countryCode,
        // `mode` es de 360dialog: Meta no tiene un host de pruebas aparte.
        mode: isMeta ? 'production' : input.mode,
        // Meta no queda lista hasta que llame al GET de verificacion, y eso
        // depende de que alguien pegue la URL en el panel de la App.
        status: isMeta ? 'pending' : 'connected',
      },
    });

    // Cada proveedor entra por SU ruta. La de 360dialog no se toca: esta
    // registrada en su servidor y es por donde recibe el numero que ya atiende.
    const base = `${publicBaseUrl.replace(/\/$/, '')}/v1/webhooks`;
    const slug = encodeURIComponent(tenant.slug);
    const webhookUrl = isMeta
      ? `${base}/meta/${slug}?line=${encodeURIComponent(line.id)}`
      : `${base}/dialog360/${slug}?token=${encodeURIComponent(secret)}&line=${encodeURIComponent(line.id)}`;

    // Se valida la credencial de VERDAD, con los dos proveedores. Antes solo se
    // comprobaba 360dialog: una linea de Meta con un token malo se guardaba
    // igual y fallaba mucho despues, al intentar enviar.
    let phone: string | null = null;
    try {
      const client = this.clients.create(line, input.apiKey);
      phone = (await client.verifyCredentials()).phone;
      await client.registerWebhook(webhookUrl);
    } catch (err) {
      // Credencial mala: no se deja una linea muerta en la lista.
      await prisma.waLine.delete({ where: { id: line.id } }).catch(() => null);
      throw new BadRequestException(
        `No se pudo conectar con ${isMeta ? 'Meta' : '360dialog'}: ${(err as Error).message}`.slice(
          0,
          300,
        ),
      );
    }

    const saved = await prisma.waLine.update({
      where: { id: line.id },
      data: { webhookUrl, ...(phone ? { phone } : {}) },
    });

    // Predeterminada: si es la PRIMERA linea del tenant, siempre; si no, solo
    // si lo pidieron explicitamente. Es importante que sea explicito: la
    // predeterminada es por donde sale todo lo que no dice por donde ir, asi
    // que una linea nueva que se auto-nombrase predeterminada le robaria el
    // trafico al numero que ya atiende clientes.
    const count = await prisma.waLine.count();
    if (count === 1 || input.isDefault) await this.makeDefault(saved.id);

    this.waConn.invalidate(tenantId);
    const fresh = await prisma.waLine.findUnique({ where: { id: saved.id } });
    return toLineSummary(fresh!);
  }

  /** Renombrar o convertir en predeterminada. No toca credenciales. */
  async updateLine(
    id: string,
    input: UpdateWaLineInput,
    auth: AuthContext,
  ): Promise<WaLineSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const exists = await prisma.waLine.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Esa línea no existe');

    if (input.label) await prisma.waLine.update({ where: { id }, data: { label: input.label } });
    if (input.isDefault) await this.makeDefault(id);

    if (input.apiKey) {
      // Se PRUEBA antes de guardar: si la credencial nueva no sirve, la linea
      // se queda con la vieja. Guardar primero y validar despues dejaria el
      // numero mudo por una clave mal pegada.
      const client = this.clients.create(exists, input.apiKey);
      let phone: string | null = null;
      try {
        phone = (await client.verifyCredentials()).phone;
      } catch (err) {
        throw new BadRequestException(
          `Esa credencial no sirve: ${(err as Error).message}`.slice(0, 300),
        );
      }
      // El webhook se registra CON la clave nueva: al rotar el canal, el
      // proveedor suele perder la URL, y es justo lo que hay que restaurar.
      if (exists.webhookUrl) {
        await client.registerWebhook(exists.webhookUrl).catch(() => null);
      }
      await prisma.waLine.update({
        where: { id },
        data: {
          encryptedApiKey: await this.envelope.encryptField(tenantId, input.apiKey),
          ...(input.appSecret
            ? { encryptedAppSecret: await this.envelope.encryptField(tenantId, input.appSecret) }
            : {}),
          ...(phone ? { phone } : {}),
          status: 'connected',
          lastError: null,
        },
      });
    } else if (input.appSecret) {
      await prisma.waLine.update({
        where: { id },
        data: { encryptedAppSecret: await this.envelope.encryptField(tenantId, input.appSecret) },
      });
    }

    this.waConn.invalidate(tenantId);
    const fresh = await prisma.waLine.findUnique({ where: { id } });
    return toLineSummary(fresh!);
  }

  /**
   * Desconecta una linea. Los mensajes NO se borran: quedan con su lineId para
   * que el historial siga contando de donde salio cada uno.
   */
  async removeLine(id: string, auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const line = await prisma.waLine.findUnique({ where: { id } });
    if (!line) return;

    const flows = await prisma.waFlow.count({ where: { lineId: id } });
    if (flows > 0) {
      throw new BadRequestException(
        `Esa línea todavía tiene ${flows} mensaje(s) automático(s) apuntando a ella. Muévelos a otra línea o elimínalos antes.`,
      );
    }

    await prisma.waLine.delete({ where: { id } });
    // Sin predeterminada, los envios que no traen linea se quedarian sin saber
    // por donde salir: la mas antigua toma el relevo.
    if (line.isDefault) {
      const next = await prisma.waLine.findFirst({ orderBy: { createdAt: 'asc' } });
      if (next) await this.makeDefault(next.id);
    }
    this.waConn.invalidate(tenantId);
  }

  /** Una sola predeterminada: se la quita a las demas en la misma transaccion. */
  private async makeDefault(id: string): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.$transaction([
      prisma.waLine.updateMany({ where: { id: { not: id } }, data: { isDefault: false } }),
      prisma.waLine.update({ where: { id }, data: { isDefault: true } }),
    ]);
  }

  /**
   * Crea las filas de los flujos que aun no la tienen, con lo que hoy hace el
   * codigo: encendidos, por la linea predeterminada y para todos los pedidos.
   * No cambia comportamiento — solo lo hace visible y editable.
   */
  async materialize(auth: AuthContext): Promise<WaConfigOverview> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();

    const line = await prisma.waLine.findFirst({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!line) {
      throw new BadRequestException('Conecta primero una línea de WhatsApp.');
    }

    const existing = new Set(
      (await prisma.waFlow.findMany({ select: { kind: true } })).map((r) => r.kind),
    );
    const missing = waFlowKindSchema.options.filter((k) => !existing.has(k));
    if (missing.length > 0) {
      await prisma.waFlow.createMany({
        data: missing.map((kind) => ({
          kind,
          lineId: line.id,
          enabled: true,
          // Se guardan los textos y tiempos QUE HOY SE ESTAN USANDO, no
          // campos en blanco: el sentido de "tomar el control" es poder leer
          // lo que sale y retocarlo, no adivinarlo.
          config: CURRENT_BEHAVIOUR[kind] as Prisma.InputJsonValue,
        })),
      });
    }
    return this.overview(auth);
  }

  async save(input: SaveWaFlowInput, auth: AuthContext, id?: string): Promise<WaFlow> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();

    const line = await prisma.waLine.findUnique({ where: { id: input.lineId } });
    if (!line) throw new NotFoundException('Esa línea de WhatsApp no existe');

    // Dos flujos ENCENDIDOS del mismo tipo para la MISMA fuente mandarian el
    // mensaje dos veces. Se rechaza antes de escribir.
    if (input.enabled) {
      const others = await prisma.waFlow.findMany({
        where: { kind: input.kind, enabled: true, ...(id ? { id: { not: id } } : {}) },
      });
      const clash = others.find((o) => toScope(o.scope).some((s) => input.scope.includes(s)));
      if (clash) {
        throw new BadRequestException(
          'Ya hay otro flujo activo de este tipo para esa tienda: apágalo o cámbiale el alcance.',
        );
      }
    }

    const data = {
      kind: input.kind,
      lineId: input.lineId,
      enabled: input.enabled,
      scope: input.scope as unknown as Prisma.InputJsonValue,
      config: input.config as unknown as Prisma.InputJsonValue,
      priority: input.priority,
    };
    const row = id
      ? await prisma.waFlow.update({ where: { id }, data })
      : await prisma.waFlow.create({ data });
    return toFlow(row, line.label);
  }

  async remove(id: string, auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    await prisma.waFlow.delete({ where: { id } }).catch(() => null);
  }

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores configuran los mensajes automáticos');
    }
  }
}

/**
 * Lo que el codigo hace HOY, por tipo de mensaje. Es lo que se guarda al
 * "tomar el control": las filas nacen describiendo el comportamiento actual,
 * de forma que materializar no cambie absolutamente nada — solo lo vuelva
 * visible y editable.
 */
const CURRENT_BEHAVIOUR: Record<WaFlowKind, WaFlowConfig> = {
  confirmation: { maxAgeHours: DEFAULT_CONFIRMATION_MAX_AGE_HOURS },
  guide: {},
  upsell: {
    step1Text: MSG_STEP1,
    step2Text: MSG_STEP2,
    stepDelayMinutes: DEFAULT_UPSELL_STEP_DELAY_MINUTES,
  },
  autoreply: {
    confirmedReply: MSG_CONFIRMED,
    askAddress: MSG_ASK_ADDRESS,
    retryAddress: MSG_RETRY_ADDRESS,
  },
};

/** El alcance guardado como JSON, de vuelta a lista de claves. */
function toScope(value: unknown): string[] {
  if (!Array.isArray(value)) return ['*'];
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return out.length > 0 ? out : ['*'];
}

function toLineSummary(r: {
  id: string;
  label: string;
  provider: string;
  phone: string | null;
  mode: string;
  isDefault: boolean;
  status: string;
  lastError: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
  createdAt: Date;
}): WaLineSummary {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider === 'meta' ? 'meta' : 'dialog360',
    phone: r.phone,
    mode: r.mode === 'sandbox' ? 'sandbox' : 'production',
    isDefault: r.isDefault,
    // 'pending' es real y hay que dejarlo pasar: es una linea de Meta a la que
    // aun no le han pegado el webhook en su panel, y la UI lo pinta en ambar.
    status: r.status === 'error' ? 'error' : r.status === 'pending' ? 'pending' : 'connected',
    lastError: r.lastError,
    webhookUrl: r.webhookUrl,
    verifyToken: r.verifyToken,
    createdAt: r.createdAt.toISOString(),
  };
}

function toFlow(
  r: {
    id: string;
    kind: string;
    lineId: string;
    enabled: boolean;
    scope: unknown;
    config: unknown;
    priority: number;
    createdAt: Date;
  },
  lineLabel: string,
): WaFlow {
  const kind = waFlowKindSchema.safeParse(r.kind);
  const config = waFlowConfigSchema.safeParse(r.config);
  return {
    id: r.id,
    kind: kind.success ? kind.data : 'confirmation',
    lineId: r.lineId,
    lineLabel,
    enabled: r.enabled,
    scope: toScope(r.scope),
    config: config.success ? config.data : {},
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
  };
}
