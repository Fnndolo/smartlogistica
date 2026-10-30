import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { AuditCategory, AuditEntry, AuditPage, AuditQuery } from '@smartlogistica/shared';
import { Prisma } from '.prisma/tenant-client';
import type { PrismaClient } from '.prisma/tenant-client';

import { canSeeAudit } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { getTenantContext } from '../../infrastructure/tenant-context';

/**
 * BITACORA del workspace (Registros). Solo el PROPIETARIO (OWNER) la lee.
 *
 * Tres fuentes, unidas por fecha:
 *  1. Lo que YA se registraba en la base del tenant: la actividad de cada
 *     pedido (OrderEvent: asignar, transferir, facturar, guia...) y las
 *     ediciones del chat (OrderMessageEdit). Por eso la bitacora nace con
 *     historia en vez de vacia.
 *  2. Lo que antes NO dejaba rastro (mensajes borrados, equipo, sedes,
 *     pedidos eliminados): va a AuditLog del tenant con `log()`.
 *  3. Los ingresos, que viven en el control-plane (SystemAuditLog).
 *
 * Escribir es SIEMPRE best-effort: dejar rastro nunca puede tumbar la accion
 * que se esta registrando.
 */

/** Quien hizo algo, como se guarda en la bitacora. */
export interface AuditActor {
  id: string | null;
  name: string | null;
}

export function actorOf(auth: AuthContext): AuditActor {
  return { id: auth.userId, name: auth.name?.trim() || auth.email };
}

export interface AuditLogInput {
  action: string;
  /** 'order:<id>' | 'wa:<telefono>' | 'user:<id>' | 'warehouse:<id>'. */
  resource?: string | null;
  /** La frase de la fila, ya redactada ("Eliminó un mensaje del chat"). */
  summary: string;
  detail?: string | null;
  /** Datos estructurados (el mensaje borrado completo, el antes/despues...). */
  data?: Record<string, unknown>;
}

/** Tipos de la actividad del pedido que SI van a la bitacora (no el ruido automatico). */
const EVENT_ACTIONS = [
  'assigned',
  'transferred',
  'returned',
  'created',
  'invoiced',
  'guide_generated',
  'vtex_invoiced',
  'vtex_invoiced_external',
  'manual_completed',
  'packed',
  'unpacked',
] as const;

const CATEGORY_OF: Record<string, AuditCategory> = {
  'user.login': 'acceso',
  'user.login.failed': 'acceso',
  assigned: 'pedidos',
  transferred: 'pedidos',
  returned: 'pedidos',
  created: 'pedidos',
  packed: 'pedidos',
  unpacked: 'pedidos',
  manual_completed: 'pedidos',
  'order.deleted': 'pedidos',
  invoiced: 'facturas',
  vtex_invoiced: 'facturas',
  vtex_invoiced_external: 'facturas',
  guide_generated: 'guias',
  'chat.message_deleted': 'mensajes',
  'chat.message_edited': 'mensajes',
  'wa.message_deleted': 'mensajes',
  'wa.message_edited': 'mensajes',
  'wa.chat_cleared': 'mensajes',
  'wa.chat_deleted': 'mensajes',
  'member.created': 'equipo',
  'member.updated': 'equipo',
  'member.removed': 'equipo',
  'warehouse.created': 'sedes',
  'warehouse.updated': 'sedes',
  'warehouse.archived': 'sedes',
};

const LOGIN_ACTIONS = ['user.login', 'user.login.failed'];

/** Acciones de cada categoria (para filtrar en SQL). */
function actionsOf(category: AuditCategory): string[] {
  return Object.entries(CATEGORY_OF)
    .filter(([, c]) => c === category)
    .map(([a]) => a);
}

interface TenantRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
  orderId: string | null;
  externalId: string | null;
  customerName: string | null;
  warehouseId: string | null;
}

interface Cursor {
  /** Fecha (ISO) de la ultima fila mostrada. */
  t: string;
  /** Ids ya mostrados CON esa misma fecha (una asignacion masiva comparte el instante). */
  ids: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly control: ControlPlaneService) {}

  /**
   * Deja una fila en la bitacora. NUNCA lanza: si falla, se loguea y la accion
   * sigue su curso. `prisma` va explicito porque hay llamadores fuera de una
   * peticion (el webhook de WhatsApp procesa en segundo plano).
   */
  async log(
    actor: AuditActor | null,
    input: AuditLogInput,
    prisma: PrismaClient = getTenantContext().prisma,
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorId: actor?.id ?? null,
          action: input.action,
          resource: input.resource ?? null,
          metadata: {
            actorName: actor?.name ?? null,
            summary: input.summary,
            detail: input.detail ?? null,
            ...(input.data ?? {}),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`No se pudo registrar ${input.action}: ${(err as Error).message}`);
    }
  }

  /**
   * Filas de AuditLog de un recurso (p. ej. los mensajes borrados de un
   * pedido, para pintarlos en rojo al propietario). Vacio si algo falla.
   */
  async forResource(
    actions: string[],
    resource: string,
    prisma: PrismaClient = getTenantContext().prisma,
  ): Promise<Array<{ actorName: string | null; createdAt: Date; meta: Record<string, unknown> }>> {
    try {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: actions }, resource },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      return rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return { actorName: str(meta.actorName), createdAt: r.createdAt, meta };
      });
    } catch {
      return [];
    }
  }

  async list(query: AuditQuery, auth: AuthContext): Promise<AuditPage> {
    if (!canSeeAudit(auth)) {
      throw new ForbiddenException('Solo el propietario ve los registros');
    }
    const { tenantId, prisma } = getTenantContext();
    const cursor = decodeCursor(query.cursor);
    const now = new Date().toISOString();
    const until = cursor?.t ?? (query.to && query.to < now ? query.to : now);
    const skipIds = cursor?.ids ?? [];
    const limit = query.limit;

    const actions = query.category ? actionsOf(query.category) : null;
    const wantsLogins = !actions || actions.some((a) => LOGIN_ACTIONS.includes(a));
    const tenantActions = actions?.filter((a) => !LOGIN_ACTIONS.includes(a)) ?? null;

    const [tenantRows, loginRows] = await Promise.all([
      tenantActions && tenantActions.length === 0
        ? Promise.resolve([] as TenantRow[])
        : this.tenantRows(prisma, { until, skipIds, limit, actions: tenantActions, query }),
      wantsLogins
        ? this.loginRows(tenantId, { until, skipIds, limit, query })
        : Promise.resolve([] as AuditEntry[]),
    ]);

    const merged = [...tenantRows.map((r) => toEntry(r)), ...loginRows].sort((a, b) =>
      a.createdAt === b.createdAt
        ? b.id.localeCompare(a.id)
        : b.createdAt.localeCompare(a.createdAt),
    );
    const page = merged.slice(0, limit);
    const hasMore =
      merged.length > limit || tenantRows.length >= limit || loginRows.length >= limit;
    const last = page[page.length - 1];
    if (!last || !hasMore) return { items: page, nextCursor: null };

    const sameInstant = page.filter((e) => e.createdAt === last.createdAt).map((e) => e.id);
    const ids =
      cursor && cursor.t === last.createdAt ? [...cursor.ids, ...sameInstant] : sameInstant;
    return { items: page, nextCursor: encodeCursor({ t: last.createdAt, ids }) };
  }

  /** Actividad de pedidos + ediciones del chat + AuditLog, en UNA consulta. */
  private async tenantRows(
    prisma: PrismaClient,
    opts: {
      until: string;
      skipIds: string[];
      limit: number;
      actions: string[] | null;
      query: AuditQuery;
    },
  ): Promise<TenantRow[]> {
    const { until, skipIds, limit, actions, query } = opts;
    const conds: Prisma.Sql[] = [
      Prisma.sql`u."createdAt" <= (${until}::timestamptz AT TIME ZONE 'UTC')`,
    ];
    if (skipIds.length > 0) conds.push(Prisma.sql`NOT (u.id = ANY(${skipIds}))`);
    if (actions) conds.push(Prisma.sql`u.action = ANY(${actions})`);
    if (query.actor) conds.push(Prisma.sql`u."actorId" = ${query.actor}`);
    if (query.from) {
      conds.push(Prisma.sql`u."createdAt" >= (${query.from}::timestamptz AT TIME ZONE 'UTC')`);
    }
    if (query.q) {
      const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conds.push(Prisma.sql`(
        u."actorName" ILIKE ${like} OR u."externalId" ILIKE ${like}
        OR u."customerName" ILIKE ${like} OR u.meta::text ILIKE ${like}
      )`);
    }

    try {
      return await prisma.$queryRaw<TenantRow[]>`
        SELECT * FROM (
          SELECT 'ev:' || e.id AS id, e.type AS action, e."actorId", e."actorName",
                 e.data AS meta, e."createdAt",
                 o.id AS "orderId", o."externalId", o."customerName", o."warehouseId"
          FROM "OrderEvent" e
          JOIN "Order" o ON o.id = e."orderId"
          WHERE e.type IN (${Prisma.join([...EVENT_ACTIONS])})
          UNION ALL
          SELECT 'ed:' || x.id, 'chat.message_edited', x."editedById", x."editedByName",
                 jsonb_build_object(
                   'before', x."previousBody",
                   'after', COALESCE(
                     (SELECT x2."previousBody" FROM "OrderMessageEdit" x2
                      WHERE x2."messageId" = x."messageId" AND x2."createdAt" > x."createdAt"
                      ORDER BY x2."createdAt" ASC LIMIT 1),
                     m.body
                   )
                 ),
                 x."createdAt",
                 o.id, o."externalId", o."customerName", o."warehouseId"
          FROM "OrderMessageEdit" x
          JOIN "OrderMessage" m ON m.id = x."messageId"
          JOIN "Order" o ON o.id = m."orderId"
          UNION ALL
          SELECT 'au:' || a.id::text, a.action, a."actorId", a.metadata->>'actorName',
                 a.metadata, a."createdAt",
                 o.id, COALESCE(o."externalId", a.metadata->>'externalId'),
                 COALESCE(o."customerName", a.metadata->>'customerName'), o."warehouseId"
          FROM "AuditLog" a
          LEFT JOIN "Order" o ON a.resource = 'order:' || o.id
        ) u
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY u."createdAt" DESC, u.id DESC
        LIMIT ${limit}`;
    } catch (err) {
      this.logger.warn(`Bitacora: fallo la consulta del tenant: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Ingresos (y los intentos fallidos) de los miembros de ESTE workspace. El
   * intento fallido no trae tenant (aun no se sabe a cual entraba), asi que se
   * amarra por la persona.
   */
  private async loginRows(
    tenantId: string,
    opts: { until: string; skipIds: string[]; limit: number; query: AuditQuery },
  ): Promise<AuditEntry[]> {
    const { until, skipIds, limit, query } = opts;
    try {
      const members = await this.control.membership.findMany({
        where: { tenantId },
        select: { userId: true, user: { select: { name: true, email: true } } },
      });
      const nameOf = new Map(members.map((m) => [m.userId, m.user.name?.trim() || m.user.email]));
      let ids = members.map((m) => m.userId);
      if (query.actor) ids = ids.filter((id) => id === query.actor);
      if (query.q) {
        const q = query.q.toLowerCase();
        ids = ids.filter((id) => (nameOf.get(id) ?? '').toLowerCase().includes(q));
      }
      if (ids.length === 0) return [];

      const skip = skipIds.filter((s) => s.startsWith('sy:')).map((s) => BigInt(s.slice(3)));
      const rows = await this.control.systemAuditLog.findMany({
        where: {
          actorUserId: { in: ids },
          createdAt: { lte: new Date(until), ...(query.from ? { gte: new Date(query.from) } : {}) },
          ...(skip.length > 0 ? { id: { notIn: skip } } : {}),
          OR: [{ action: 'user.login', tenantId }, { action: 'user.login.failed' }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map((r) => ({
        id: `sy:${r.id.toString()}`,
        action: r.action,
        category: 'acceso' as const,
        actorId: r.actorUserId,
        actorName: r.actorUserId ? (nameOf.get(r.actorUserId) ?? null) : null,
        summary:
          r.action === 'user.login'
            ? 'Ingresó a la plataforma'
            : 'Intentó ingresar con una clave equivocada',
        detail: null,
        order: null,
        phone: null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`Bitacora: fallo la consulta de ingresos: ${(err as Error).message}`);
      return [];
    }
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.t !== 'string' || Number.isNaN(Date.parse(c.t))) return null;
    const ids = Array.isArray(c.ids) ? c.ids.filter((x): x is string => typeof x === 'string') : [];
    return { t: c.t, ids: ids.slice(0, 500) };
  } catch {
    return null;
  }
}

/** Fila cruda -> entrada de la bitacora, con su frase ya redactada. */
function toEntry(r: TenantRow): AuditEntry {
  const meta = r.meta ?? {};
  const order =
    r.orderId && r.externalId
      ? {
          id: r.orderId,
          externalId: r.externalId,
          customerName: r.customerName ?? '',
          warehouseId: r.warehouseId,
        }
      : null;
  const described = r.id.startsWith('au:')
    ? { summary: str(meta.summary) ?? r.action, detail: str(meta.detail) }
    : describe(r.action, meta);
  const summary = described.summary;
  // Pedido que ya no existe (se elimino): no hay a donde enlazar, pero que se
  // sepa cual era.
  const gone =
    !order && r.externalId
      ? `Pedido ${r.externalId}${r.customerName ? ` · ${r.customerName}` : ''}`
      : null;
  const detail = [gone, described.detail].filter(Boolean).join('\n') || null;
  const phone = str(meta.phone);
  return {
    id: r.id,
    action: r.action,
    category: CATEGORY_OF[r.action] ?? 'pedidos',
    actorId: r.actorId,
    actorName: r.actorName,
    summary,
    detail,
    order,
    phone,
    ip: null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Frase de cada tipo de actividad (mismo vocabulario que la pestaña Actividad). */
function describe(
  action: string,
  d: Record<string, unknown>,
): { summary: string; detail: string | null } {
  const toName = str(d.toName);
  const fromName = str(d.fromName);
  switch (action) {
    case 'assigned':
      return {
        summary: toName ? `Asignó el pedido a ${toName}` : 'Asignó el pedido a una sede',
        detail: null,
      };
    case 'transferred':
      return {
        summary: toName
          ? `Transfirió el pedido ${fromName ? `de ${fromName} ` : ''}a ${toName}`
          : 'Transfirió el pedido a otra sede',
        detail: null,
      };
    case 'returned':
      return {
        summary: `Devolvió el pedido a generales${fromName ? ` (estaba en ${fromName})` : ''}`,
        detail: null,
      };
    case 'created':
      return {
        summary:
          d.manual === true
            ? `Montó un pedido a mano${str(d.warehouseName) ? ` en ${str(d.warehouseName)}` : ''}${str(d.platform) ? ` (${str(d.platform)})` : ''}`
            : 'Pedido recibido',
        detail: null,
      };
    case 'invoiced':
      return {
        summary: str(d.number)
          ? `Emitió la factura ${str(d.number)} en Alegra`
          : 'Emitió la factura en Alegra',
        detail: null,
      };
    case 'guide_generated': {
      const number = str(d.number) ?? '';
      if (d.via === 'domicilio') {
        return {
          summary: `Emitió el soporte de entrega ${number} (domicilio propio)`,
          detail: null,
        };
      }
      const carrier = d.via === 'skydropx' ? (str(d.carrier) ?? 'Skydropx') : 'Coordinadora';
      const cod = typeof d.cod === 'number' && d.cod > 0 ? ' · con recaudo contraentrega' : '';
      return { summary: `Generó la guía ${number} en ${carrier}${cod}`, detail: null };
    }
    case 'vtex_invoiced':
      return {
        summary: `Cerró el pedido en VTEX${str(d.invoiceNumber) ? ` · factura ${str(d.invoiceNumber)}` : ''}`,
        detail: null,
      };
    case 'vtex_invoiced_external':
      return {
        summary: 'Se facturó por fuera de SmartLogística (cerrado directo en VTEX)',
        detail: null,
      };
    case 'manual_completed':
      return {
        summary: `Completó el pedido manual${str(d.invoiceNumber) ? ` · factura ${str(d.invoiceNumber)}` : ''}${str(d.tracking) ? ` + guía ${str(d.tracking)}` : ''}`,
        detail: null,
      };
    case 'packed':
      return { summary: 'Empacó el pedido', detail: null };
    case 'unpacked':
      return { summary: 'Le quitó la marca de empacado al pedido', detail: null };
    case 'chat.message_edited':
      return {
        summary: 'Editó un mensaje del chat',
        detail: `Antes: ${str(d.before) ?? '(vacío)'}\nAhora: ${str(d.after) ?? '(vacío)'}`,
      };
    default:
      return { summary: action, detail: null };
  }
}
