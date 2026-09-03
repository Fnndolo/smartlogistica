import { Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import type { CreateWaTemplateInput, WaProvider } from '@smartlogistica/shared';

import type { MetaClient } from './meta-client.service';
import type { WaClient, WaMediaKind, WaTemplateLite, WaTemplateRaw } from './wa-client.port';
import { buildTemplateComponents, mapTemplateRow, toTemplateLite } from './wa-template-mapper';

// Respuestas de terceros: acceso laxo a proposito.
type Any = Record<string, any>;

/** Tope de paginas al listar plantillas. Meta pagina por cursor, no por limite. */
const MAX_TEMPLATE_PAGES = 10;

/**
 * El puerto, implementado sobre la Cloud API NATIVA de Meta.
 *
 * Tres cosas separan esto de 360dialog, y las tres estan aqui dentro:
 *  1. El numero emisor NO va en el cuerpo: va en la RUTA, como phoneNumberId.
 *     De ahi que el cliente nazca ligado a una linea.
 *  2. Las plantillas cuelgan de la WABA (otro id distinto) y se paginan por
 *     cursor: pedir limit=200 no basta, hay que seguir `paging.cursors.after`.
 *  3. Bajar un medio son dos saltos, y el segundo va a otro host que aun asi
 *     exige la cabecera de autorizacion.
 *
 * El CUERPO de los mensajes es identico al de 360dialog: los dos hablan Cloud
 * API. Por eso esta clase se parece tanto a la otra — y por eso el mapeo de
 * plantillas es literalmente el mismo modulo.
 */
export class MetaWaClient implements WaClient {
  private readonly logger = new Logger(MetaWaClient.name);
  readonly provider: WaProvider = 'meta';
  private readonly http: AxiosInstance;

  constructor(
    private readonly api: MetaClient,
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly wabaId: string,
    readonly lineId: string,
  ) {
    this.http = api.buildHttp(accessToken, phoneNumberId);
  }

  private get messagesPath(): string {
    return `/${this.phoneNumberId}/messages`;
  }

  /** Todos los envios devuelven el wamid en el mismo sitio. */
  private async post(body: Any): Promise<string | null> {
    const res = await this.http.post(this.messagesPath, body);
    return (res.data?.messages?.[0]?.id as string | undefined) ?? null;
  }

  // === Envio ===

  sendText(to: string, body: string, contextWamid?: string | null): Promise<string | null> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body },
      ...(contextWamid ? { context: { message_id: contextWamid } } : {}),
    });
  }

  sendReaction(to: string, targetWamid: string, emoji: string): Promise<string | null> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetWamid, emoji },
    });
  }

  sendContact(to: string, name: string, phone: string): Promise<string | null> {
    return this.post({
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
  }

  sendMediaId(
    to: string,
    kind: WaMediaKind,
    mediaId: string,
    filename?: string,
  ): Promise<string | null> {
    const media: Any = { id: mediaId };
    if (kind === 'document' && filename) media.filename = filename;
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: kind,
      [kind]: media,
    });
  }

  sendMediaLink(
    to: string,
    kind: WaMediaKind,
    link: string,
    filename?: string,
  ): Promise<string | null> {
    const media: Any = { link };
    if (kind === 'document' && filename) media.filename = filename;
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: kind,
      [kind]: media,
    });
  }

  sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<string | null> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  sendTemplate(
    to: string,
    name: string,
    language: string,
    components: unknown[],
  ): Promise<string | null> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name, language: { code: language }, components },
    });
  }

  /**
   * "Escribiendo..." nativo. En Meta NO existe llamada independiente: es el
   * mismo endpoint que marcar-como-leido, asi que esto marca leido tambien.
   * Es cosmetico: si falla, no debe tumbar el envio que venga detras.
   */
  async sendTypingIndicator(messageId: string): Promise<void> {
    await this.http.post(this.messagesPath, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' },
    });
  }

  // === Medios ===

  async uploadMedia(buffer: Buffer, mime: string, filename: string): Promise<string | null> {
    // fetch NATIVO (no axios): garantiza el boundary correcto del multipart y
    // que nadie fuerce un Content-Type de JSON encima.
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', mime);
    fd.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    const res = await fetch(`${this.api.baseUrl()}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: fd,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Media upload HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    const body = (await res.json().catch(() => null)) as Any | null;
    return (body?.id as string | undefined) ?? null;
  }

  /**
   * Dos saltos. La URL del primero CADUCA A LOS 5 MINUTOS, asi que se resuelve
   * justo antes de bajar y jamas se guarda.
   */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string } | null> {
    // NULL, nunca una excepcion: quien llama guarda el mensaje sin archivo si
    // esto devuelve null, pero si LANZA se pierde el mensaje entero. El cliente
    // de 360dialog tiene el mismo contrato y hay que respetarlo — una foto que
    // no baja no puede costar el texto que venia con ella.
    try {
      const meta = await this.http.get(`/${mediaId}`, {
        params: { phone_number_id: this.phoneNumberId },
      });
      const url = meta.data?.url as string | undefined;
      if (!url) return null;
      const buffer = await this.api.fetchMediaBytes(url, this.accessToken);
      return {
        buffer,
        mime: String(meta.data?.mime_type ?? 'application/octet-stream'),
      };
    } catch (err) {
      this.logger.warn(
        `No se pudo descargar el medio ${mediaId} de Meta: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // === Plantillas ===

  async listTemplates(): Promise<WaTemplateLite[]> {
    return (await this.listTemplatesDetailed()).map(toTemplateLite);
  }

  /**
   * Sigue el cursor hasta agotar. Con una sola pagina se perderian plantillas
   * en silencio, que es peor que fallar: el automatico elegiria otra.
   */
  async listTemplatesDetailed(): Promise<WaTemplateRaw[]> {
    const out: WaTemplateRaw[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
      const res = await this.http.get(`/${this.wabaId}/message_templates`, {
        params: { limit: 200, ...(after ? { after } : {}) },
      });
      const rows = res.data?.data;
      // Si el sobre no es el esperado, se LANZA. Devolver [] aqui haria que un
      // fallo de permisos se viera como "esta WABA no tiene plantillas".
      if (!Array.isArray(rows)) {
        throw new Error('Meta devolvió las plantillas en un formato inesperado');
      }
      out.push(...(rows as Any[]).map(mapTemplateRow));
      after = res.data?.paging?.cursors?.after as string | undefined;
      if (!after || rows.length === 0) break;
    }
    return out;
  }

  async createTemplate(input: CreateWaTemplateInput): Promise<{ status: string }> {
    const res = await this.http.post(`/${this.wabaId}/message_templates`, {
      name: input.name,
      language: input.language,
      category: input.category,
      components: buildTemplateComponents(input),
    });
    return { status: String(res.data?.status ?? 'pending').toLowerCase() };
  }

  /** Por NOMBRE: Meta borra todas las versiones de idioma de esa plantilla. */
  async deleteTemplate(name: string): Promise<void> {
    await this.http.delete(`/${this.wabaId}/message_templates`, { params: { name } });
  }

  // === Alta ===

  async verifyCredentials(): Promise<{ phone: string | null }> {
    const res = await this.http.get(`/${this.phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name' },
    });
    const phone = res.data?.display_phone_number as string | undefined;
    return { phone: phone?.trim() || null };
  }

  /**
   * Suscribe la app a la WABA. Lo que NO puede hacer — y por eso devuelve
   * 'manual' — es fijar la URL del webhook: eso se pega en el panel de la App
   * de Meta y no hay API para hacerlo con un token de negocio.
   */
  async registerWebhook(_url: string): Promise<'auto' | 'manual'> {
    await this.http.post(`/${this.wabaId}/subscribed_apps`, {});
    return 'manual';
  }
}
