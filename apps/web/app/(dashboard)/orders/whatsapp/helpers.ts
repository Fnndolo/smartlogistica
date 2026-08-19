'use client';

import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale/es';
import type { WaMessage } from '@smartlogistica/shared';

/** Reemplaza {{n}} por los valores — el mismo render que hace el server. */
export const renderTpl = (body: string, params: string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

/** Etiquetas de las variables por convencion del negocio ({{1}}..{{3}}). */
export const VAR_HINTS = ['Nombre del cliente', 'Productos', 'Dirección de entrega'];

/* ======================= Helpers de presentacion ======================= */

/** ¿El texto son SOLO emojis? (WhatsApp los pinta grandes y sin burbuja). */
export const isEmojiOnly = (s: string | null): boolean => {
  if (!s || !s.trim()) return false;
  try {
    // Solo pictograficos + ZWJ/VS16/tonos de piel/espacios (los digitos y #*
    // NO cuentan: "123" debe ir en burbuja normal).
    return /^(?=.*\p{Extended_Pictographic})[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\s]+$/u.test(
      s.trim(),
    );
  } catch {
    return false;
  }
};
export const emojiCount = (s: string): number => {
  try {
    return [...s.matchAll(/\p{Extended_Pictographic}/gu)].length;
  } catch {
    return 99;
  }
};

export const timeOf = (iso: string): string => format(new Date(iso), 'h:mm aaaa', { locale: es });

/** Errores de Meta traducidos al ESPAÑOL (por codigo). */
const META_ERRORS: Array<[RegExp, string]> = [
  [/131053/, 'No se pudo procesar el archivo: WhatsApp no aceptó el formato o el tamaño del multimedia (131053).'],
  [/131047|re-?engagement/i, 'Han pasado más de 24 horas desde la última respuesta del cliente. Usa una plantilla aprobada para reabrir la conversación (131047).'],
  [/131026/, 'No se pudo entregar: el número puede no tener WhatsApp o bloqueó al negocio (131026).'],
  [/131049/, 'Meta limitó los mensajes de marketing a este usuario (131049). Reintenta en unas horas o usa una plantilla utility.'],
  [/131056/, 'Demasiados mensajes a este número en poco tiempo. Espera unos minutos y reintenta (131056).'],
  [/131048/, 'Meta limitó temporalmente los envíos del número (posible marca de spam) (131048).'],
  [/132000|132001|132005|132007|132012/, 'Problema con la plantilla: no existe, no está aprobada o las variables no coinciden.'],
  [/\b470\b/, 'Solo se puede responder dentro de las 24 horas siguientes al último mensaje del cliente; usa una plantilla aprobada (470).'],
  [/131051/, 'Tipo de mensaje no soportado por WhatsApp (131051).'],
];

/** Motivo del fallo en español (a partir de lo que reportó Meta). */
export const failText = (m: WaMessage): string => {
  const raw = (m.error ?? '').trim();
  for (const [re, es] of META_ERRORS) if (re.test(raw)) return es;
  return raw
    ? `No entregado — ${raw.replace(/^Meta:\s*/i, '')}`
    : 'WhatsApp no entregó este mensaje.';
};

// Celulares colombianos (3xx...), con o sin +57, con espacios/guiones/puntos.
export const PHONE_RE = /(\+?57[\s.-]?)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g;

export const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (isToday(d)) return 'HOY';
  if (isYesterday(d)) return 'AYER';
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: es }).toUpperCase();
};

/* ==================== Helpers de audio (nota de voz) ==================== */

export const BAR_COUNT = 40;

/** Barras de respaldo (si el audio no se puede decodificar): onda suave estable. */
export const fallbackBars = (seed: string): number[] => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.55 + (h % 17)) * 0.7 + Math.sin(i * 1.7 + h) * 0.3);
    return 0.2 + v * 0.8;
  });
};

export const fmtSecs = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** Audios ya ESCUCHADOS (verde -> azul en recibidos), persistente. */
const HEARD_KEY = 'wa-heard-audios';
export const getHeardSet = (): Set<string> => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HEARD_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
};
export const addHeard = (id: string): void => {
  try {
    const s = getHeardSet();
    s.add(id);
    window.localStorage.setItem(HEARD_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* sin storage */
  }
};
