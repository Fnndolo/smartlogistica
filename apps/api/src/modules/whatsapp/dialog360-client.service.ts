import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { Dialog360Mode } from '@smartlogistica/shared';

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

  buildHttp(apiKey: string, mode: Dialog360Mode): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl(mode),
      timeout: TIMEOUT_MS,
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });
  }

  private messagesPath(mode: Dialog360Mode): string {
    return mode === 'sandbox' ? '/v1/messages' : '/messages';
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

  /** Envia TEXTO (Cloud API). `to` = numero con indicativo, ej. 573001234567. */
  async sendText(http: AxiosInstance, mode: Dialog360Mode, to: string, body: string): Promise<string | null> {
    const res = await http.post(this.messagesPath(mode), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body },
    });
    return res.data?.messages?.[0]?.id ?? null;
  }

  /** Envia un MEDIO por URL (imagen/video/audio/documento). */
  async sendMediaLink(
    http: AxiosInstance,
    mode: Dialog360Mode,
    to: string,
    kind: 'image' | 'video' | 'audio' | 'document',
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

    const paths = mode === 'sandbox' ? [`/v1/media/${mediaId}`, `/${mediaId}`] : [`/${mediaId}`, `/v1/media/${mediaId}`];
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
        this.logger.warn(
          `Media ${mediaId} via ${path} fallo: ${(err as Error).message}`,
        );
        continue;
      }
    }
    this.logger.warn(`No se pudo descargar el medio ${mediaId} (modo ${mode})`);
    return null;
  }
}
