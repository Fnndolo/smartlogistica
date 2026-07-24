/**
 * Emojis mas usados por MI para reaccionar (localStorage). Alimentan los
 * accesos rapidos del toolbar flotante de cada mensaje (estilo Google Chat).
 */
const KEY = 'smartlog-reaction-frequents';
const DEFAULTS = ['👍', '✅', '❤️'];

function read(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Registra un uso (al reaccionar) para que suba en los accesos rapidos. */
export function bumpReaction(emoji: string): void {
  if (typeof window === 'undefined') return;
  try {
    const counts = read();
    counts[emoji] = (counts[emoji] ?? 0) + 1;
    window.localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    /* localStorage lleno o bloqueado: sin drama */
  }
}

/** Los N emojis mas frecuentes (rellena con los por defecto). */
export function topReactions(n = 3): string[] {
  const counts = read();
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
  const merged = [...sorted, ...DEFAULTS.filter((d) => !sorted.includes(d))];
  return merged.slice(0, n);
}
