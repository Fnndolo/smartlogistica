import { BadRequestException, type Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import type { WaMessage as WaMessageDto } from '@smartlogistica/shared';

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
