import { BadRequestException, type Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import type { Dialog360Mode, WaMessage as WaMessageDto, WaProvider } from '@smartlogistica/shared';

/**
 * Helpers PUROS del modulo de WhatsApp (sin estado ni dependencias Nest):
 * los comparten el servicio de envios (WhatsappService), el publicador y el
 * lado de recepcion (WhatsappWebhookService).
 */

/** Cuantas variables {{n}} usa el cuerpo de una plantilla. */
export const templateVarCount = (body: string): number =>
  Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

/** Reemplaza {{n}} por los valores — el TEXTO REAL que le llega al cliente. */
export const renderTemplateBody = (body: string, params: string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

/** Minusculas sin acentos ni signos, para comparar botones con tolerancia. */
export function normBtn(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WaMessageRow {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  attachmentKey: string | null;
  mediaUrl: string | null;
  authorName: string | null;
  buttons?: unknown;
  replyToId?: string | null;
  reactions?: unknown;
  status?: string | null;
  error?: string | null;
  edited?: boolean;
  starred?: boolean;
  createdAt: Date;
}

const WA_KINDS = ['text', 'image', 'video', 'audio', 'file', 'sticker'] as const;
export const waKindOf = (k: string): WaMessageDto['kind'] =>
  (WA_KINDS as readonly string[]).includes(k) ? (k as WaMessageDto['kind']) : 'text';

/** Ultimos 10 digitos (CO): "+57 300 123 4567" -> "3001234567". */
export function tenDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Tipo de mensaje de WhatsApp segun el mime del archivo. */
export function waTypeOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Traduce el error del API de WhatsApp (360dialog) a un mensaje UTIL: SIEMPRE
 * incluye el detalle real que devolvio el servidor (leccion aprendida: un
 * generico "rechazo el token" escondia "number blocked due to lack of payment").
 */
export function translateWaError(
  err: unknown,
  fallback: string,
  logger: Logger,
): BadRequestException {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as
      | { message?: string; error?: unknown; meta?: { developer_message?: string } }
      | string
      | undefined;
    // Formas de error de 360dialog/Meta: {error: "..."}, {meta: {developer_message}}, {message}.
    const detail =
      typeof data === 'string'
        ? data.slice(0, 300)
        : data && typeof data === 'object'
          ? typeof data.error === 'string'
            ? data.error
            : (data.meta?.developer_message ?? data.message ?? null)
          : null;
    return new BadRequestException(
      detail
        ? `WhatsApp (360dialog): ${String(detail).slice(0, 300)}`
        : `${fallback} (HTTP ${status ?? '?'})`,
    );
  }
  logger.warn(`WhatsApp error: ${err instanceof Error ? err.message : err}`);
  return new BadRequestException(fallback);
}

/* ------------------ TEXTOS POR DEFECTO DE LOS AUTOMATICOS ------------------ */
/**
 * Viven aqui, y no en el servicio que los envia, porque los necesitan DOS
 * lados: quien manda el mensaje y la pantalla de configuracion, que al "tomar
 * el control" los guarda tal cual para que se puedan leer y retocar. Si se
 * quedaran en cada servicio, la pantalla mostraria campos vacios y el usuario
 * no tendria forma de saber que se esta enviando hoy.
 */
export const MSG_CONFIRMED =
  '¡Muchas gracias por confirmar 🙌 Su pedido ya quedó en alistamiento. Puede seguir el ' +
  'estado de su pedido desde la app de ADDI. Si hay alguna novedad con su pedido, le ' +
  'avisamos enseguida. 😊';
export const MSG_ASK_ADDRESS =
  '¡Claro! 😊 Para modificar tu dirección de entrega, escríbela completa en un solo mensaje ' +
  'y sin agregar palabras adicionales.\n\nEjemplo:\nCalle 123 # 1-2, barrio San José, Medellín, ' +
  'Antioquia\n\nPor favor, envía únicamente la dirección con ese formato para poder actualizarla ' +
  'correctamente';
export const MSG_RETRY_ADDRESS = 'Por favor vuelve a enviar tu dirección, en un ÚNICO mensaje.';
export const MSG_STEP1 =
  'Mientras preparamos su envío 📦, piense en esto un segundo:\n\n' +
  'Usted acaba de invertir en un equipo nuevo. Ahora imagine que a los pocos días se lo roban en la calle 🚨 o se le va al piso y la pantalla no sobrevive 📱💥… tocaría empezar de cero, pagando todo otra vez.\n\n' +
  'Para que esa NUNCA sea su historia, existe el RESPALDO de Smart Gadgets 🛡️:\n\n' +
  '✅ Cubre ROBO, caídas y accidentes\n' +
  '✅ Protección por UN AÑO completo\n' +
  '✅ Cuesta solo el 10% del valor de su equipo\n' +
  '✅ Y lo paga en cuotas cómodas con Addi 💙\n\n' +
  'Estrenar tranquilo cuesta poquito — perder el equipo cuesta TODO.\n\n' +
  'Toque el botón y su asesor le confirma de una vez las cuotas y el medio de pago 👇';
export const MSG_STEP2 =
  '🚚 ¡Su equipo ya va en camino!\n\n' +
  'Y justo ahora toca decidir algo importante: ¿qué pasa si se lo roban 🚨 o se le cae al tercer día de estreno? 📱💥 Nadie lo planea — por eso es lo que más duele en el bolsillo.\n\n' +
  'Con el RESPALDO de Smart Gadgets eso deja de ser un riesgo:\n\n' +
  '✅ ROBO, caídas y accidentes cubiertos\n' +
  '✅ UN AÑO completo de protección\n' +
  '✅ Solo el 10% del valor de su equipo\n' +
  '✅ En cuotas cómodas con Addi 💙\n\n' +
  'Su equipo llega en cualquier momento — que llegue ya protegido.\n\n' +
  'Toque el botón y su asesor le confirma de una vez las cuotas y el medio de pago 👇';

/** Horas de frescura del pedido para la confirmacion automatica. */
export const DEFAULT_CONFIRMATION_MAX_AGE_HOURS = 48;
/** Minutos entre los toques 1 y 2 del respaldo. */
export const DEFAULT_UPSELL_STEP_DELAY_MINUTES = 2;

/* ------------------------ ¿ESTA LINEA ALCANZA CLIENTES? ------------------------ */

/** Lo minimo de una linea para decidir si puede escribirle a un cliente real. */
export interface WaReachRef {
  /** `string` y no la union a proposito: esto se compara muchas veces contra
   *  filas crudas de la base, donde la columna es texto. Estrecharlo aqui
   *  obligaria a castear en cada consulta y el cast es justo lo que esconde el
   *  fallo que este helper existe para evitar. */
  provider: string;
  mode: string;
}

/**
 * El SANDBOX de 360dialog, que solo puede escribirle a su numero de prueba.
 *
 * `mode` es un concepto de 360dialog: tiene un host de pruebas aparte. En Meta
 * un numero de prueba vive en una WABA normal — mismo host, mismo
 * comportamiento — asi que la pregunta no significa nada ahi y la respuesta es
 * siempre no. Preguntarlo por `mode` a secas funcionaba solo por casualidad:
 * las lineas de Meta nacen con mode='production'.
 */
export function isD360Sandbox(ready: WaReachRef | null | undefined): boolean {
  return Boolean(ready && ready.provider === 'dialog360' && ready.mode === 'sandbox');
}

/**
 * ¿Se le puede escribir a un cliente REAL por esta linea?
 *
 * La excepcion de los pedidos montados a mano se conserva tal cual: en sandbox
 * se dejan pasar porque el destinatario es el numero de pruebas del propio
 * equipo, no un cliente.
 */
export function waCanReachCustomers<T extends WaReachRef>(
  ready: T | null | undefined,
  orderProvider?: string,
): ready is T {
  if (!ready) return false;
  return !isD360Sandbox(ready) || orderProvider === 'manual';
}
