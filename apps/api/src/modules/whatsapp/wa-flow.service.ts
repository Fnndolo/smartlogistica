import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  SaveWaFlowInput,
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
import { getTenantContext } from '../../infrastructure/tenant-context';
import { loadPlatforms } from '../orders/platforms.store';

/** Un pedido, en lo minimo que hace falta para saber a que flujo pertenece. */
export interface FlowOrderRef {
  provider: string;
  accountName: string | null;
  /** Plataforma de los pedidos montados a mano (Krediya, Mercado Libre...). */
  platformId?: string | null;
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
  /**
   * Clave canonica de FUENTE de un pedido. La misma en las reglas y en los
   * alcances: un solo formato, un solo bug posible.
   */
  static sourceKeyOf(order: FlowOrderRef): string {
    return order.provider === 'manual'
      ? `manual:${order.platformId ?? 'manual'}`
      : `${order.provider}:${order.accountName ?? ''}`;
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
        data: missing.map((kind) => ({ kind, lineId: line.id, enabled: true })),
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
  createdAt: Date;
}): WaLineSummary {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider === 'meta' ? 'meta' : 'dialog360',
    phone: r.phone,
    mode: r.mode === 'sandbox' ? 'sandbox' : 'production',
    isDefault: r.isDefault,
    status: r.status === 'error' ? 'error' : 'connected',
    lastError: r.lastError,
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
