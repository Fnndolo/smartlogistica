import type { CreateWaTemplateInput, WaProvider, WaTemplateDetail } from '@smartlogistica/shared';

/** Los tipos de medio que sabe enviar la Cloud API. */
export type WaMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

/** Lo minimo de una plantilla que necesita el picker de "/" y los automaticos. */
export interface WaTemplateLite {
  name: string;
  language: string;
  category: string;
  /** Siempre en MINUSCULAS: hay una decena de sitios que comparan con 'approved'. */
  status: string;
  body: string;
  buttons: string[];
}

/** Una plantilla completa, sin el cruce con los mensajes automaticos. */
export type WaTemplateRaw = Omit<WaTemplateDetail, 'usedBy'>;

/**
 * EL PUERTO: todo lo que la plataforma le pide a un numero de WhatsApp.
 *
 * Existe porque el negocio puede tener numeros de dos proveedores a la vez —
 * 360dialog (un BSP que revende la Cloud API) y la API nativa de Meta — y los
 * dos tienen que funcionar igual de bien. El cuerpo de los mensajes es el
 * mismo en ambos (los dos hablan Cloud API); lo que cambia es el host, la
 * cabecera de autenticacion y, sobre todo, que Meta exige el id del numero
 * emisor DENTRO de la ruta.
 *
 * Justo por eso el puerto es una instancia YA LIGADA A UNA LINEA, con sus
 * credenciales e ids cerrados dentro, y ningun metodo recibe `http` ni `mode`.
 * La firma vieja `metodo(http, mode, ...)` es lo que hacia imposible meter el
 * phoneNumberId en la ruta sin tocar los treinta sitios que llaman.
 *
 * CONTRATOS que toda implementacion debe respetar, porque hay codigo que
 * depende de ellos y hoy solo estaban implicitos:
 *  1. `status` de plantilla en minusculas.
 *  2. `rejectedReason` es null cuando Meta dice 'NONE'.
 *  3. Los listados LANZAN si la respuesta no tiene la forma esperada. Nunca
 *     devuelven [] ante un fallo de transporte: ese `?? []` mudo es el origen
 *     de "la guia no salio y nadie se entero".
 *  4. Los envios devuelven el id del mensaje (wamid) o null.
 */
export interface WaClient {
  readonly provider: WaProvider;
  readonly lineId: string;

  // === Envio ===
  sendText(to: string, body: string, contextWamid?: string | null): Promise<string | null>;
  sendReaction(to: string, targetWamid: string, emoji: string): Promise<string | null>;
  sendContact(to: string, name: string, phone: string): Promise<string | null>;
  sendMediaId(
    to: string,
    kind: WaMediaKind,
    mediaId: string,
    filename?: string,
  ): Promise<string | null>;
  sendMediaLink(
    to: string,
    kind: WaMediaKind,
    link: string,
    filename?: string,
  ): Promise<string | null>;
  sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<string | null>;
  sendTemplate(
    to: string,
    name: string,
    language: string,
    components: unknown[],
  ): Promise<string | null>;
  /** "Escribiendo..." en el celular del cliente. Best-effort: nunca lanza. */
  sendTypingIndicator(messageId: string): Promise<void>;

  // === Medios ===
  uploadMedia(buffer: Buffer, mime: string, filename: string): Promise<string | null>;
  downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string } | null>;

  // === Plantillas ===
  listTemplates(): Promise<WaTemplateLite[]>;
  listTemplatesDetailed(): Promise<WaTemplateRaw[]>;
  createTemplate(input: CreateWaTemplateInput): Promise<{ status: string }>;
  deleteTemplate(name: string): Promise<void>;

  // === Alta ===
  /** Comprueba que la credencial sirve. Lanza si no. Devuelve el numero si el
   *  proveedor lo reporta. */
  verifyCredentials(): Promise<{ phone: string | null }>;
  /**
   * Deja el webhook apuntando a `url`. Devuelve 'auto' si el proveedor lo
   * configuro solo (360dialog) o 'manual' si hay que pegarlo a mano en el
   * panel de Meta — que es lo que decide si la linea nace conectada o
   * pendiente.
   */
  registerWebhook(url: string): Promise<'auto' | 'manual'>;
}
