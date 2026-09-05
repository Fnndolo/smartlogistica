import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type {
  CreateWaTemplateInput,
  WaFlowKind,
  WaTemplateDetail,
  WaTemplateListForLine,
} from '@smartlogistica/shared';

import { isAdmin } from '../../common/rbac';
import { getTenantContext } from '../../infrastructure/tenant-context';
import type { AuthContext } from '../../common/types/authenticated-request';
import type { WaClient } from './wa-client.port';
import { WaConnectionService } from './wa-connection.service';
import { isD360Sandbox, translateWaError } from './wa-shared';
import { recallTemplates, rememberTemplates } from './wa-template-store';

/** Una plantilla sin el cruce con los mensajes automaticos. */
type RawTemplate = Omit<WaTemplateDetail, 'usedBy'>;

/**
 * PLANTILLAS de Meta, por linea.
 *
 * Fuera de la ventana de 24h no se le puede escribir a un cliente con texto
 * libre: solo con una plantilla que Meta haya aprobado. Hasta ahora la unica
 * forma de crear una era correr un script a mano.
 *
 * Lo que NO se puede hacer, y por eso no hay boton de "editar": ni Meta ni
 * 360dialog dejan cambiarle el cuerpo a una plantilla ya creada (el proveedor
 * responde 405 Method Not Allowed). Modificar es borrar y volver a crear, con
 * la aprobacion de Meta empezando de cero — asi que la pantalla lo plantea como
 * lo que es: duplicar y cambiar.
 */
@Injectable()
export class WaTemplateService {
  private readonly logger = new Logger(WaTemplateService.name);

  constructor(private readonly waConn: WaConnectionService) {}

  /** Cache corta por LINEA: listar cuesta ~0.5-1s contra 360dialog. */
  private readonly cache = new Map<
    string,
    { at: number; list: RawTemplate[]; stale: boolean; readAt: string | null }
  >();
  private static readonly TTL_MS = 30_000;

  /** Las plantillas de una linea (la predeterminada si no se dice cual). */
  async list(lineId: string | null, auth: AuthContext): Promise<WaTemplateListForLine> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const conn = await this.waConn.forLine(tenantId, prisma, lineId);
    if (!conn) throw new BadRequestException('No hay ninguna línea de WhatsApp conectada');
    // El sandbox de 360dialog no tiene WABA propia: no hay plantillas que
    // administrar. Una linea de Meta SIEMPRE las tiene.
    if (isD360Sandbox(conn)) {
      return {
        lineId: conn.lineId,
        lineLabel: conn.label,
        templates: [],
        stale: false,
        readAt: null,
      };
    }

    const { list: raw, stale, readAt } = await this.cached(tenantId, conn.lineId, conn.client);
    const usage = await this.usage(conn.lineId);
    return {
      lineId: conn.lineId,
      lineLabel: conn.label,
      stale,
      readAt,
      templates: raw
        .map((t) => ({ ...t, usedBy: usage.get(t.name) ?? [] }))
        // Primero las que fallan (rechazadas y pendientes): son las que piden
        // atencion. Dentro de cada grupo, alfabetico.
        .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)),
    };
  }

  /** Manda una plantilla nueva a aprobacion de Meta. */
  async create(input: CreateWaTemplateInput, auth: AuthContext): Promise<WaTemplateDetail> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const conn = await this.waConn.forLine(tenantId, prisma, input.lineId);
    if (!conn) throw new BadRequestException('Esa línea de WhatsApp ya no existe');
    if (isD360Sandbox(conn)) {
      throw new BadRequestException('El sandbox de 360dialog no tiene plantillas propias');
    }

    // Se comprueba ANTES de llamar a Meta: su error por nombre repetido es
    // ilegible, y el nombre es lo unico que ya no se puede cambiar despues.
    const { list: existing } = await this.cached(tenantId, conn.lineId, conn.client);
    if (existing.some((t) => t.name === input.name && t.language === input.language)) {
      throw new BadRequestException(
        `Ya existe una plantilla llamada "${input.name}" en ese idioma`,
      );
    }

    try {
      await conn.client.createTemplate(input);
    } catch (err) {
      throw translateWaError(err, 'Meta no aceptó la plantilla', this.logger);
    }
    this.invalidate(tenantId, conn.lineId);

    // Se relee para devolver lo que quedo DE VERDAD en la WABA: Meta
    // recategoriza por su cuenta (una de servicio le puede volver publicidad).
    const after = await this.cached(tenantId, conn.lineId, conn.client).catch(() => null);
    const saved = after?.list.find((t) => t.name === input.name);
    if (saved) return { ...saved, usedBy: [] };
    return {
      id: input.name,
      name: input.name,
      language: input.language,
      category: input.category,
      status: 'pending',
      rejectedReason: null,
      header: input.header ? { format: 'TEXT', text: input.header } : null,
      body: input.body,
      footer: input.footer ?? null,
      buttons: input.buttons,
      variables: input.examples.length,
      examples: input.examples,
      createdAt: null,
      templateId: null,
      usedBy: [],
    };
  }

  /** Borra la plantilla de la WABA. Irreversible: hay que volver a crearla. */
  async remove(lineId: string | null, name: string, auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const conn = await this.waConn.forLine(tenantId, prisma, lineId);
    if (!conn) throw new BadRequestException('Esa línea de WhatsApp ya no existe');

    // Si un mensaje automatico la nombra, borrarla lo deja mudo justo cuando
    // toque mandarlo. Mejor negarse aqui que fallar en produccion.
    const used = (await this.usage(conn.lineId)).get(name) ?? [];
    if (used.length > 0) {
      throw new BadRequestException(
        used.length === 1
          ? 'No se puede borrar: la usa un mensaje automático de esta línea. Quítala de ahí primero.'
          : 'No se puede borrar: la usan varios mensajes automáticos de esta línea. Quítala de ahí primero.',
      );
    }

    try {
      await conn.client.deleteTemplate(name);
    } catch (err) {
      throw translateWaError(err, 'No se pudo borrar la plantilla', this.logger);
    }
    this.invalidate(tenantId, conn.lineId);
  }

  /** Nombre de plantilla -> tipos de mensaje automatico que la nombran. */
  private async usage(lineId: string): Promise<Map<string, WaFlowKind[]>> {
    const { prisma } = getTenantContext();
    const flows = await prisma.waFlow.findMany({
      where: { lineId },
      select: { kind: true, config: true },
    });
    const out = new Map<string, WaFlowKind[]>();
    for (const flow of flows) {
      const names = (flow.config as { templateNames?: unknown } | null)?.templateNames;
      if (!Array.isArray(names)) continue;
      const kind = flow.kind as WaFlowKind;
      for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const list = out.get(raw) ?? [];
        if (!list.includes(kind)) list.push(kind);
        out.set(raw, list);
      }
    }
    return out;
  }

  /**
   * Las plantillas de una linea, y si vienen del proveedor o de respaldo.
   *
   * Cuando el proveedor responde bien se GUARDA la lista; cuando devuelve
   * vacio o falla se devuelve la ultima guardada, marcada como vieja. Perder
   * el permiso de LEER las plantillas no puede dejar al equipo sin poder
   * mandarlas: para enviarlas basta el nombre, y el nombre esta en la lista
   * guardada.
   */
  private async cached(
    tenantId: string,
    lineId: string,
    client: WaClient,
  ): Promise<{ list: RawTemplate[]; stale: boolean; readAt: string | null }> {
    const { prisma } = getTenantContext();
    const key = `${tenantId}:${lineId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < WaTemplateService.TTL_MS) {
      return { list: hit.list, stale: hit.stale, readAt: hit.readAt };
    }

    let fresh: RawTemplate[] | null = null;
    let failure: unknown = null;
    try {
      fresh = await client.listTemplatesDetailed();
    } catch (err) {
      failure = err;
    }

    if (fresh && fresh.length > 0) {
      await rememberTemplates(prisma, lineId, fresh);
      const value = { list: fresh, stale: false, readAt: new Date().toISOString() };
      this.cache.set(key, { at: Date.now(), ...value });
      return value;
    }

    const saved = await recallTemplates(prisma, lineId);
    if (saved) {
      this.logger.warn(
        `Plantillas de ${lineId}: el proveedor ${fresh ? 'devolvio vacio' : 'fallo'}; se usan las guardadas (${saved.list.length})`,
      );
      const value = { list: saved.list, stale: true, readAt: saved.at || null };
      this.cache.set(key, { at: Date.now(), ...value });
      return value;
    }

    // Sin respaldo: si ademas fallo la lectura, el error del proveedor es mas
    // util que un "no hay plantillas" que seria mentira.
    if (failure)
      throw translateWaError(failure, 'No se pudieron cargar las plantillas', this.logger);
    return { list: [], stale: false, readAt: new Date().toISOString() };
  }

  private invalidate(tenantId: string, lineId: string): void {
    this.cache.delete(`${tenantId}:${lineId}`);
  }

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores administran las plantillas');
    }
  }
}

/** Rechazadas y pendientes arriba: son las que hay que mirar. */
function rank(status: string): number {
  if (status === 'rejected') return 0;
  if (status === 'pending' || status === 'submitted') return 1;
  if (status === 'approved') return 2;
  return 3;
}
