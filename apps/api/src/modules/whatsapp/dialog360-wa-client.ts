import type { AxiosInstance } from 'axios';
import type { CreateWaTemplateInput, Dialog360Mode, WaProvider } from '@smartlogistica/shared';

import type { Dialog360Client } from './dialog360-client.service';
import type { WaClient, WaMediaKind, WaTemplateLite, WaTemplateRaw } from './wa-client.port';

/**
 * El puerto, implementado sobre 360dialog.
 *
 * Es un ENVOLTORIO, no una reescritura: cada metodo delega en el
 * `Dialog360Client` de siempre con exactamente los mismos argumentos. Esa es
 * la garantia de que el numero que hoy atiende clientes reales no cambia ni un
 * byte de su trafico saliente al meter el segundo proveedor. Si algo de esta
 * clase hace algo mas que reenviar, esa garantia se pierde.
 */
export class Dialog360WaClient implements WaClient {
  readonly provider: WaProvider = 'dialog360';

  constructor(
    private readonly api: Dialog360Client,
    private readonly http: AxiosInstance,
    private readonly mode: Dialog360Mode,
    private readonly apiKey: string,
    readonly lineId: string,
  ) {}

  sendText(to: string, body: string, contextWamid?: string | null): Promise<string | null> {
    return this.api.sendText(this.http, this.mode, to, body, contextWamid);
  }

  sendReaction(to: string, targetWamid: string, emoji: string): Promise<string | null> {
    return this.api.sendReaction(this.http, this.mode, to, targetWamid, emoji);
  }

  sendContact(to: string, name: string, phone: string): Promise<string | null> {
    return this.api.sendContact(this.http, this.mode, to, name, phone);
  }

  sendMediaId(
    to: string,
    kind: WaMediaKind,
    mediaId: string,
    filename?: string,
  ): Promise<string | null> {
    return this.api.sendMediaId(this.http, this.mode, to, kind, mediaId, filename);
  }

  sendMediaLink(
    to: string,
    kind: WaMediaKind,
    link: string,
    filename?: string,
  ): Promise<string | null> {
    return this.api.sendMediaLink(this.http, this.mode, to, kind, link, filename);
  }

  sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<string | null> {
    return this.api.sendInteractiveButtons(this.http, this.mode, to, body, buttons);
  }

  sendTemplate(
    to: string,
    name: string,
    language: string,
    components: unknown[],
  ): Promise<string | null> {
    return this.api.sendTemplate(this.http, this.mode, to, name, language, components);
  }

  async sendTypingIndicator(messageId: string): Promise<void> {
    await this.api.sendTypingIndicator(this.http, this.mode, messageId);
  }

  uploadMedia(buffer: Buffer, mime: string, filename: string): Promise<string | null> {
    // Ojo: 360dialog sube con la API key EN CLARO y fetch nativo, no con la
    // instancia de axios. Por eso esta clase guarda tambien la key.
    return this.api.uploadMedia(this.apiKey, this.mode, buffer, mime, filename);
  }

  downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string } | null> {
    return this.api.downloadMedia(this.http, this.mode, mediaId);
  }

  listTemplates(): Promise<WaTemplateLite[]> {
    return this.api.listTemplates(this.http);
  }

  listTemplatesDetailed(): Promise<WaTemplateRaw[]> {
    return this.api.listTemplatesDetailed(this.http);
  }

  createTemplate(input: CreateWaTemplateInput): Promise<{ status: string }> {
    return this.api.createTemplate(this.http, input);
  }

  deleteTemplate(name: string): Promise<void> {
    return this.api.deleteTemplate(this.http, name);
  }

  /** El validador de siempre: si el API key no sirve, esto revienta. */
  async verifyCredentials(): Promise<{ phone: string | null }> {
    await this.api.getWebhook(this.http);
    // 360dialog no expone el numero: la linea lo deja en null y la UI no lo pinta.
    return { phone: null };
  }

  async registerWebhook(url: string): Promise<'auto' | 'manual'> {
    await this.api.setWebhook(this.http, url);
    return 'auto';
  }
}
