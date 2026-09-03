import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '.prisma/tenant-client';

import { Public } from '../../common/decorators/public.decorator';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { WhatsappService } from './whatsapp.service';

/** Meta llega hasta 3 MB con los lotes de historial de coexistencia. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Webhook publico de la API NATIVA de Meta.
 *
 * RUTA APARTE de la de 360dialog a proposito: la vieja
 * (`/v1/webhooks/dialog360/...`) esta registrada en el servidor de 360dialog y
 * volver a tocarla exige una llamada remota que puede fallar y dejar sin
 * recepcion al numero que atiende clientes reales. Esta no la conoce nadie mas.
 *
 * URL: /v1/webhooks/meta/<tenantSlug>?line=<lineId>
 *
 * Meta autentica distinto y por eso no vale el token en la query de la otra:
 *  - GET  = verificacion. Meta llama UNA vez al guardar la URL en el panel de
 *    la App, con hub.mode/hub.verify_token/hub.challenge, y espera el challenge
 *    devuelto en TEXTO PLANO. Si se responde JSON, con sus comillas, rechaza.
 *  - POST = notificaciones, firmadas con X-Hub-Signature-256: HMAC-SHA256 del
 *    cuerpo CRUDO usando el App Secret. Hay que firmar los BYTES: volver a
 *    serializar el objeto ya parseado reordena claves y reescapa unicode, y el
 *    hash no coincide jamas.
 */
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly envelope: EnvelopeService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * Verificacion. Los nombres LLEVAN PUNTO: en Express son
   * `req.query['hub.mode']`, no un objeto anidado.
   */
  @Public()
  @Get(':tenantSlug')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Throttle({ global: { limit: 60, ttl: 60_000 } })
  async verify(
    @Param('tenantSlug') tenantSlug: string,
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Query('line') line: string | undefined,
  ): Promise<string> {
    if (mode !== 'subscribe' || !token || !challenge) {
      throw new ForbiddenException('Petición de verificación incompleta');
    }
    const { tenantId, prisma } = await this.tenantOf(tenantSlug);

    // Se busca la linea del ?line= y, si no viene, cualquier linea de Meta del
    // tenant cuyo token case: con varias lineas sin ?line= no habria forma
    // determinista, pero con una sola es exactamente lo correcto.
    const candidates = await prisma.waLine.findMany({
      where: { provider: 'meta', ...(line?.trim() ? { id: line.trim() } : {}) },
      select: { id: true, verifyToken: true },
    });
    const match = candidates.find((l) => l.verifyToken && equals(l.verifyToken, token));
    if (!match) throw new ForbiddenException('Token de verificación inválido');

    // Pasar la verificacion es lo que saca a la linea del ambar "pendiente".
    await prisma.waLine
      .update({ where: { id: match.id }, data: { status: 'connected', lastError: null } })
      .catch(() => null);
    this.logger.log(`Webhook de Meta verificado (tenant ${tenantId}, línea ${match.id})`);

    // El challenge, crudo. Nada de JSON.
    return String(challenge);
  }

  @Public()
  @Post(':tenantSlug')
  @HttpCode(200)
  @Throttle({ global: { limit: 3000, ttl: 60_000 } })
  async receive(
    @Param('tenantSlug') tenantSlug: string,
    @Query('line') line: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody;
    if (!raw || raw.length === 0) throw new ForbiddenException('Cuerpo vacío');
    if (raw.length > MAX_BODY_BYTES) throw new ForbiddenException('Cuerpo demasiado grande');

    const { tenantId, prisma } = await this.tenantOf(tenantSlug);

    // Se parsea UNA vez. Antes se hacia dos veces (una para saber de que linea
    // era y otra para procesar): trabajo duplicado sobre un cuerpo de hasta
    // 4 MB que todavia no esta autenticado.
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ForbiddenException('Cuerpo mal formado');
    }

    // La linea PRIMERO, la firma despues: cada linea tiene su propio App
    // Secret, asi que no se puede validar sin saber de cual se trata. Lo que se
    // mira del cuerpo sin firmar esta acotado (ver `peekIds`).
    const lineRow = await this.resolveLine(prisma, line, payload);
    if (!lineRow) throw new ForbiddenException('No hay ninguna línea de Meta para este webhook');
    if (!lineRow.encryptedAppSecret) {
      // Sin App Secret no hay forma de saber que el mensaje viene de Meta, y
      // esta ruta es publica. Se rechaza en vez de confiar a ciegas.
      throw new ForbiddenException('Esa línea no tiene App Secret: no se puede verificar la firma');
    }
    const appSecret = await this.envelope.decryptField(tenantId, lineRow.encryptedAppSecret);
    this.assertSignature(req, raw, appSecret);

    // 200 YA y proceso en background: Meta reintenta durante DIAS si tardamos,
    // y la descarga de medios puede tomar segundos.
    void (async () => {
      const { client } = await this.tenants.getForTenant(tenantId);
      await this.whatsapp.inboundCloud(tenantId, client, payload, lineRow.id);
    })().catch((err) => {
      this.logger.error(
        `Webhook de Meta en background falló: ${err instanceof Error ? err.message : err}`,
      );
    });

    return { ok: true };
  }

  private async tenantOf(slug: string): Promise<{ tenantId: string; prisma: PrismaClient }> {
    const tenant = await this.control.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    const { client } = await this.tenants.getForTenant(tenant.id);
    return { tenantId: tenant.id, prisma: client };
  }

  /**
   * Que linea es. Tres vias, de la MAS especifica a la menos, que no es el
   * orden que parece: manda el id del NUMERO que trae el sobre, luego el
   * `?line=` de la URL y por ultimo la WABA, y esa solo si es inequivoca.
   * El porque esta en cada rama.
   */
  private async resolveLine(
    prisma: PrismaClient,
    line: string | undefined,
    payload: unknown,
  ): Promise<{ id: string; encryptedAppSecret: Buffer | null } | null> {
    const select = { id: true, encryptedAppSecret: true };
    const ids = peekIds(payload);

    // 1. El id del NUMERO. Es el unico que distingue de verdad: una App de Meta
    //    tiene UNA sola URL de webhook, asi que el `?line=` que se pega en el
    //    panel es el de la ultima linea dada de alta y llega igual para los
    //    mensajes de la otra. Por eso manda el sobre, no la query.
    if (ids.phone.length > 0) {
      const byPhone = await prisma.waLine.findFirst({
        where: { provider: 'meta', phoneNumberId: { in: ids.phone } },
        select,
      });
      if (byPhone) return byPhone;
    }

    // 2. El `?line=` de la URL, si el numero no identifico nada.
    const wanted = line?.trim();
    if (wanted) {
      const byId = await prisma.waLine.findFirst({
        where: { id: wanted, provider: 'meta' },
        select,
      });
      if (byId) return byId;
    }

    // 3. La WABA, y SOLO si es inequivoca: ese id lo comparten todos los
    //    numeros de la cuenta, asi que con dos lineas elegir una seria echarlo
    //    a suertes.
    if (ids.waba.length > 0) {
      const byWaba = await prisma.waLine.findMany({
        where: { provider: 'meta', wabaId: { in: ids.waba } },
        select,
        take: 2,
      });
      if (byWaba.length === 1) return byWaba[0];
      if (byWaba.length > 1) {
        this.logger.warn('Webhook de Meta sin phone_number_id y con varias líneas en esa WABA');
      }
    }
    return null;
  }

  private assertSignature(req: Request, raw: Buffer, appSecret: string): void {
    const header = String(req.headers['x-hub-signature-256'] ?? '');
    if (!header.startsWith('sha256=')) throw new ForbiddenException('Falta la firma de Meta');
    const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
    if (!equals(header.slice('sha256='.length), expected)) {
      throw new ForbiddenException('Firma inválida');
    }
  }
}

/** Comparacion en tiempo constante que no filtra la longitud del secreto. */
function equals(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Ids que Meta pone en el sobre, para poder saber de que linea es.
 *
 * ACOTADO a proposito: esto lee un cuerpo que TODAVIA no esta firmado y lo que
 * saque va a parar a un `IN` de una consulta. Un sobre real trae una WABA y un
 * numero; sin tope, un cuerpo de 4 MB lleno de ids se convertiria en una
 * consulta con cientos de miles de parametros que tumba la peticion — y para
 * mandarlo basta con conocer el slug del tenant.
 */
const MAX_PEEK_IDS = 8;
const MAX_ID_LEN = 64;

function peekIds(payload: unknown): { waba: string[]; phone: string[] } {
  const root = payload as { entry?: Array<{ id?: unknown; changes?: Array<{ value?: unknown }> }> };
  const waba = new Set<string>();
  const phone = new Set<string>();
  const usable = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN;

  for (const entry of Array.isArray(root?.entry) ? root.entry : []) {
    if (waba.size >= MAX_PEEK_IDS && phone.size >= MAX_PEEK_IDS) break;
    if (usable(entry?.id) && waba.size < MAX_PEEK_IDS) waba.add(entry.id);
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (phone.size >= MAX_PEEK_IDS) break;
      const meta = (change?.value as { metadata?: { phone_number_id?: unknown } } | undefined)
        ?.metadata;
      if (usable(meta?.phone_number_id)) phone.add(meta.phone_number_id);
    }
  }
  return { waba: [...waba], phone: [...phone] };
}
