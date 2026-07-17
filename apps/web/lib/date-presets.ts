import { endOfDay, startOfDay, startOfMonth, subDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * SmartLogistica opera 100% en zona Colombia (sin DST). Todos los filtros de
 * fecha se calculan aqui y devuelven ISO UTC strings para mandar al API.
 */
export const TIMEZONE = 'America/Bogota';

export const PRESETS = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last7', label: 'Ultimos 7 dias' },
  { value: 'currentMonth', label: 'Mes actual' },
  { value: 'last30', label: 'Ultimos 30 dias' },
  { value: 'custom', label: 'Personalizado' },
] as const;

export type PresetValue = (typeof PRESETS)[number]['value'];

export interface DateRange {
  from: string; // ISO UTC
  to: string; // ISO UTC
}

/** Calcula el rango UTC ISO equivalente al preset, interpretado en hora Colombia. */
export function computeRange(preset: Exclude<PresetValue, 'custom'>): DateRange {
  const nowLocal = toZonedTime(new Date(), TIMEZONE);

  let startLocal: Date;
  let endLocal: Date;

  switch (preset) {
    case 'today':
      startLocal = startOfDay(nowLocal);
      endLocal = endOfDay(nowLocal);
      break;
    case 'yesterday': {
      const y = subDays(nowLocal, 1);
      startLocal = startOfDay(y);
      endLocal = endOfDay(y);
      break;
    }
    case 'last7':
      startLocal = startOfDay(subDays(nowLocal, 6));
      endLocal = endOfDay(nowLocal);
      break;
    case 'currentMonth':
      startLocal = startOfMonth(nowLocal);
      endLocal = endOfDay(nowLocal);
      break;
    case 'last30':
      startLocal = startOfDay(subDays(nowLocal, 29));
      endLocal = endOfDay(nowLocal);
      break;
  }

  return {
    from: fromZonedTime(startLocal, TIMEZONE).toISOString(),
    to: fromZonedTime(endLocal, TIMEZONE).toISOString(),
  };
}

/** Construye un rango UTC ISO a partir de dos strings YYYY-MM-DD en hora Colombia. */
export function buildCustomRange(fromYmd: string, toYmd: string): DateRange | null {
  if (!fromYmd || !toYmd) return null;
  const fromLocal = startOfDay(toZonedTime(new Date(`${fromYmd}T12:00:00Z`), TIMEZONE));
  const toLocal = endOfDay(toZonedTime(new Date(`${toYmd}T12:00:00Z`), TIMEZONE));
  if (fromLocal > toLocal) return null;
  return {
    from: fromZonedTime(fromLocal, TIMEZONE).toISOString(),
    to: fromZonedTime(toLocal, TIMEZONE).toISOString(),
  };
}

/** Dado from/to UTC actuales, devuelve cual preset matchea (o 'custom' si ninguno). */
export function resolvePreset(from: string | null, to: string | null): PresetValue | null {
  if (!from || !to) return null;
  for (const preset of PRESETS) {
    if (preset.value === 'custom') continue;
    const range = computeRange(preset.value);
    // Tolerancia de 1 minuto para evitar drifts por el segundo del calculo
    if (
      Math.abs(new Date(range.from).getTime() - new Date(from).getTime()) < 60_000 &&
      Math.abs(new Date(range.to).getTime() - new Date(to).getTime()) < 60_000
    ) {
      return preset.value;
    }
  }
  return 'custom';
}

export function presetLabel(preset: PresetValue | null): string {
  if (!preset) return 'Todas las fechas';
  return PRESETS.find((p) => p.value === preset)?.label ?? 'Todas las fechas';
}

/** Convierte un ISO UTC en YYYY-MM-DD interpretado en hora Colombia (para inputs `date`). */
export function isoToYmdInColombia(iso: string | null): string {
  if (!iso) return '';
  const zoned = toZonedTime(new Date(iso), TIMEZONE);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
