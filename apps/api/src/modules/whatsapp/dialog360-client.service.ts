import { Agent as HttpsAgent } from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type {
  CreateWaTemplateInput,
  Dialog360Mode,
  WaTemplateDetail,
} from '@smartlogistica/shared';

const TIMEOUT_MS = 30_000;

// Headers de axios (acceso laxo).
type Any = Record<string, any>;

/**
 * Cliente de 360dialog (BSP api-first): expone la Cloud API de Meta CRUDA.
 * Auth = header D360-API-KEY.
 *
 * Endpoints (validados contra docs.360dialog.com):
 * - sandbox:    https://waba-sandbox.360dialog.io  -> POST /v1/messages
 * - produccion: https://waba-v2.360dialog.io       -> POST /messages
 * - webhook:    POST {base}/v1/configs/webhook {url} (ambos modos)
 * - media:      GET {base}/{media_id} -> { url } (valida 5 min) -> GET binario
 * Los cuerpos de mensaje son formato Cloud API (messaging_product: whatsapp).
 */
@Injectable()
export class Dialog360Client {
  private readonly logger = new Logger(Dialog360Client.name);

  baseUrl(mode: Dialog360Mode): string {
    return mode === 'sandbox'
      ? 'https://waba-sandbox.360dialog.io'
      : 'https://waba-v2.360dialog.io';
  }

  /**
   * Conexiones REUTILIZADAS (keep-alive): sin esto, cada envio pagaba
   * DNS + TCP + TLS nuevos hacia 360dialog (~300-600ms regalados por mensaje).
   * La instancia se cachea por apiKey+modo y comparte el agente.
   */
  private readonly keepAlive = new HttpsAgent({ keepAlive: true, maxSockets: 20 });
  private readonly httpCache = new Map<string, AxiosInstance>();

  buildHttp(apiKey: string, mode: Dialog360Mode): AxiosInstance {
    const cacheKey = `${mode}:${apiKey}`;
    const hit = this.httpCache.get(cacheKey);
    if (hit) return hit;
    const instance = axios.create({
      baseURL: this.baseUrl(mode),
      timeout: TIMEOUT_MS,
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
      httpsAgent: this.keepAlive,
    });
    if (this.httpCache.size > 100) this.httpCache.clear(); // tope defensivo
    this.httpCache.set(cacheKey, instance);
    return instance;
  }

  private messagesPath(mode: Dialog360Mode): string {
    return mode === 'sandbox' ? '/v1/messages' : '/messages';
  }

  /**
   * "Escribiendo..." EN EL CELULAR del cliente (indicador nativo de la Cloud
   * API): va junto con el read del ultimo mensaje entrante; Meta lo muestra
   * ~25s o hasta que salga el mensaje. OJO: marca ese entrante como LEIDO
   * en el celular del cliente (sus chulitos se ponen azules).
   */
  async sendTypingIndicator(
    http: AxiosInstance,
    mode: Dialog360Mode,
    messageId: string,
  ): Promise<void> {
    await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' },
    });
  }

  /** Configura el webhook (a donde 360dialog manda TODO lo que pasa por el numero). */
  async setWebhook(http: AxiosInstance, url: string): Promise<void> {
    await http.post('/v1/configs/webhook', { url });
  }

  /** Lee la config del webhook — sirve tambien para VALIDAR el API key. */
  async getWebhook(http: AxiosInstance): Promise<{ url: string | null }> {
    const res = await http.get('/v1/configs/webhook');
    return { url: res.data?.url ?? null };
  }

  /**
   * Envia TEXTO (Cloud API). `to` = numero con indicativo, ej. 573001234567.
   * `contextWamid` = responder CITANDO ese mensaje (context.message_id).
   */
  async sendText(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    body: string,
    contextWamid?: string | null,
  ): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body },
      ...(contextWamid ? { context: { message_id: contextWamid } } : {}),
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /** REACCION a un mensaje (emoji vacio = quitarla). */
  async sendReaction(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    targetWamid: string,
    emoji: string,
  ): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetWamid, emoji },
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /** Tarjeta de CONTACTO. */
  async sendContact(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    name: string,
    phone: string,
  ): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: name, first_name: name },
          phones: [{ phone, type: 'CELL', wa_id: phone.replace(/\D/g, '') }],
        },
      ],
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /**
   * SUBE un medio a Meta (multipart) y devuelve su media id. Mas confiable que
   * el envio por link para STICKERS (Meta valida el webp al descargarlo y con
   * URLs firmadas a veces falla con 131053 Media upload error).
   */
  async uploadMedia(
    apiKey: string,
    mode: Dialog360Mode,
    buffer: Buffer,
    mime: string,
    filename: string,
  ): Promise<string | null> {
    // fetch NATIVO (no axios): el multipart con boundary correcto garantizado.
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    const res = await fetch(`${this.baseUrl(mode)}${mode === 'sandbox' ? '/v1/media' : '/media'}`, {
      method: 'POST',
      headers: { 'D360-API-KEY': apiKey },
      body: fd,
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      media?: Array<{ id?: string }>;
      error?: unknown;
    } | null;
    if (!res.ok) {
      throw new Error(
        `Media upload HTTP ${res.status}: ${JSON.stringify(body ?? '').slice(0, 300)}`,
      );
    }
    return body?.media?.[0]?.id ?? body?.id ?? null;
  }

  /** Envia un MEDIO por media id (previamente subido con uploadMedia). */
  async sendMediaId(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    mediaId: string,
    filename?: string,
  ): Promise<string | null> {
    const media: Record<string, unknown> = { id: mediaId };
    if (kind === 'document' && filename) media.filename = filename;
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: kind,
      [kind]: media,
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /** Envia un MEDIO por URL (imagen/video/audio/documento/sticker). */
  async sendMediaLink(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    link: string,
    filename?: string,
  ): Promise<string | null> {
    const media: Record<string, unknown> = { link };
    if (kind === 'document' && filename) media.filename = filename;
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: kind,
      [kind]: media,
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /**
   * Envia un mensaje de SESION con botones de respuesta rapida (dentro de la
   * ventana de 24h). OJO: titulos max 20 caracteres (limite de Meta).
   */
  async sendInteractiveButtons(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /**
   * Lista las PLANTILLAS de la WABA (GET /v1/configs/templates). Solo tiene
   * sentido en produccion (el sandbox no tiene WABA propia con plantillas).
   */
  async listTemplates(http: AxiosInstance): Promise<
    Array<{
      name: string;
      language: string;
      category: string;
      status: string;
      body: string;
      buttons: string[];
    }>
  > {
    const res = await http.get('/v1/configs/templates', { params: { limit: 100 } });
    const list: Any[] = res.data?.waba_templates ?? res.data?.templates ?? [];
    return list.map((tpl) => {
      const comps: Any[] = Array.isArray(tpl.components) ? tpl.components : [];
      const bodyComp = comps.find((c) => c?.type === 'BODY');
      const btnComp = comps.find((c) => c?.type === 'BUTTONS');
      return {
        name: String(tpl.name ?? ''),
        language: String(tpl.language ?? 'es'),
        category: String(tpl.category ?? ''),
        status: String(tpl.status ?? '').toLowerCase(),
        body: String(bodyComp?.text ?? ''),
        buttons: ((btnComp?.buttons ?? []) as Any[])
          .map((b) => String(b?.text ?? ''))
          .filter(Boolean),
      };
    });
  }

  /**
   * Lista las plantillas CON TODO: encabezado, pie, botones, ejemplos y el
   * motivo del rechazo. Es lo que necesita la pantalla de configuracion; el
   * `listTemplates` de arriba se queda corto a proposito (el picker de "/"
   * solo pinta el cuerpo).
   */
  async listTemplatesDetailed(
    http: AxiosInstance,
  ): Promise<Array<Omit<WaTemplateDetail, 'usedBy'>>> {
    const res = await http.get('/v1/configs/templates', { params: { limit: 200 } });
    const list: Any[] = res.data?.waba_templates ?? res.data?.templates ?? [];
    return list.map((tpl) => {
      const comps: Any[] = Array.isArray(tpl.components) ? tpl.components : [];
      const head = comps.find((c) => c?.type === 'HEADER');
      const body = comps.find((c) => c?.type === 'BODY');
      const foot = comps.find((c) => c?.type === 'FOOTER');
      const btns = comps.find((c) => c?.type === 'BUTTONS');
      const bodyText = String(body?.text ?? '');
      const rejected = String(tpl.rejected_reason ?? '');
      return {
        id: String(tpl.id ?? tpl.external_id ?? tpl.name ?? ''),
        name: String(tpl.name ?? ''),
        language: String(tpl.language ?? 'es'),
        category: String(tpl.category ?? ''),
        status: String(tpl.status ?? '').toLowerCase(),
        rejectedReason: rejected && rejected !== 'NONE' ? rejected : null,
        header: head
          ? { format: String(head.format ?? 'TEXT'), text: String(head.text ?? '') }
          : null,
        body: bodyText,
        footer: foot ? String(foot.text ?? '') : null,
        buttons: ((btns?.buttons ?? []) as Any[])
          .map((b) => ({
            type: String(b?.type) === 'URL' ? ('URL' as const) : ('QUICK_REPLY' as const),
            text: String(b?.text ?? ''),
            ...(b?.url ? { url: String(b.url) } : {}),
          }))
          .filter((b) => b.text.length > 0),
        variables: new Set([...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size,
        // Meta anida los ejemplos: [[ "valor1", "valor2" ]].
        examples: ((body?.example?.body_text?.[0] ?? []) as Any[]).map((v) => String(v)),
        createdAt: tpl.created_at ? String(tpl.created_at) : null,
      };
    });
  }

  /**
   * Manda una plantilla NUEVA a aprobacion de Meta. Nace en `pending`: puede
   * tardar minutos u horas, y hasta que no este `approved` no se puede enviar.
   */
  async createTemplate(
    http: AxiosInstance,
    input: CreateWaTemplateInput,
  ): Promise<{ status: string }> {
    const components: Any[] = [];
    if (input.header) components.push({ type: 'HEADER', format: 'TEXT', text: input.header });
    components.push({
      type: 'BODY',
      text: input.body,
      // Sin `example` Meta rechaza cualquier plantilla con variables.
      ...(input.examples.length > 0 ? { example: { body_text: [input.examples] } } : {}),
    });
    if (input.footer) components.push({ type: 'FOOTER', text: input.footer });
    if (input.buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: input.buttons.map((b) =>
          b.type === 'URL'
            ? { type: 'URL', text: b.text, url: b.url }
            : { type: 'QUICK_REPLY', text: b.text },
        ),
      });
    }
    const res = await http.post('/v1/configs/templates', {
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    });
    return { status: String(res.data?.status ?? 'pending').toLowerCase() };
  }

  /**
   * Borra la plantilla POR NOMBRE (DELETE /v1/configs/templates/{nombre},
   * verificado). Ojo: Meta borra TODOS los idiomas que compartan ese nombre.
   */
  async deleteTemplate(http: AxiosInstance, name: string): Promise<void> {
    await http.delete(`/v1/configs/templates/${encodeURIComponent(name)}`);
  }

  /** Envia una PLANTILLA aprobada (la confirmacion del pedido, en produccion). */
  async sendTemplate(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    name: string,
    language: string,
    components: unknown[],
  ): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name, language: { code: language }, components },
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /**
   * Descarga un medio ENTRANTE por su media id. El descriptor vive en
   * `/v1/media/{id}` (sandbox, validado con probe) o `/{id}` (produccion) y
   * puede ser el BINARIO directo o un JSON {url} de lookaside.fbsbx.com; esa
   * URL se descarga probando: host reescrito al de 360dialog (regla oficial de
   * produccion), la URL directa sin headers (esta firmada), y directa con key.
   * Devuelve null si todo falla (el mensaje se guarda igual, sin archivo).
   */
  async downloadMedia(
    http: AxiosInstance,
    mode: Dialog360Mode,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mime: string } | null> {
    const isBinary = (contentType: string): boolean =>
      Boolean(contentType) && !contentType.includes('json') && !contentType.includes('html');

    const paths =
      mode === 'sandbox'
        ? [`/v1/media/${mediaId}`, `/${mediaId}`]
        : [`/${mediaId}`, `/v1/media/${mediaId}`];
    for (const path of paths) {
      try {
        const res = await http.get(path, { responseType: 'arraybuffer' });
        const contentType = String(res.headers?.['content-type'] ?? '');
        if (isBinary(contentType)) {
          return { buffer: Buffer.from(res.data as ArrayBuffer), mime: contentType };
        }
        if (!contentType.includes('json')) continue;

        const meta = JSON.parse(Buffer.from(res.data as ArrayBuffer).toString('utf8')) as {
          url?: string;
          mime_type?: string;
        };
        if (!meta.url) continue;

        const u = new URL(meta.url);
        // Estrategias para bajar el binario de la URL (expira en 5 min).
        const attempts: Array<() => Promise<{ data: ArrayBuffer; headers: Any }>> = [
          // 1) Host reescrito al de 360dialog, con el API key (regla oficial).
          () => http.get(u.pathname + u.search, { responseType: 'arraybuffer' }),
          // 2) URL directa SIN headers (viene firmada por Meta).
          () => axios.get(meta.url!, { responseType: 'arraybuffer', timeout: TIMEOUT_MS }),
          // 3) URL directa con el API key.
          () => http.get(meta.url!, { responseType: 'arraybuffer' }),
        ];
        for (const attempt of attempts) {
          try {
            const bin = await attempt();
            const binType = String(bin.headers?.['content-type'] ?? '');
            if (!isBinary(binType) && !meta.mime_type) continue;
            return {
              buffer: Buffer.from(bin.data),
              mime: meta.mime_type ?? binType ?? 'application/octet-stream',
            };
          } catch {
            continue;
          }
        }
      } catch (err) {
        this.logger.warn(`Media ${mediaId} via ${path} fallo: ${(err as Error).message}`);
        continue;
      }
    }
    this.logger.warn(`No se pudo descargar el medio ${mediaId} (modo ${mode})`);
    return null;
  }
}
