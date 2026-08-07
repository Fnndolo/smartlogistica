/**
 * Sonido de notificacion PROPIO de SmartLogistica (sin archivos: WebAudio).
 * Un "ding" de dos notas con armonico suave — corto, calido y reconocible.
 *
 * Politica de autoplay: el AudioContext solo puede arrancar tras un gesto del
 * usuario. `ensureAudioReady()` deja un listener de primer click/tecla que lo
 * desbloquea; despues, `playNotificationSound()` suena siempre.
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let lastPlay = 0;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Llamar una vez al montar: desbloquea el audio con el primer gesto del usuario. */
export function ensureAudioReady(): void {
  if (typeof window === 'undefined' || unlocked) return;
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume();
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/** Una nota con envolvente suave (ataque corto, caida exponencial). */
function note(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  peak: number,
  type: OscillatorType,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** El "ding" de SmartLogistica: Mi6 -> La6 con brillo armonico. */
export function playNotificationSound(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  // No ametrallar: si llegan varios eventos juntos, un solo sonido por segundo.
  const now = Date.now();
  if (now - lastPlay < 1000) return;
  lastPlay = now;

  const t = c.currentTime + 0.01;
  note(c, 659.25, t, 0.35, 0.16, 'sine'); // E5... (Mi)
  note(c, 1318.5, t, 0.25, 0.05, 'triangle'); // brillo (octava)
  note(c, 880, t + 0.11, 0.45, 0.18, 'sine'); // A5 (La)
  note(c, 1760, t + 0.11, 0.3, 0.05, 'triangle');
}

/**
 * Fanfarria de SUPER MENCION (@todos): tres notas ascendentes Do-Mi-Sol con
 * brillo y un remate en la octava — inconfundible frente al ding normal.
 */
export function playSuperMentionSound(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const now = Date.now();
  if (now - lastPlay < 600) return;
  lastPlay = now;

  const t = c.currentTime + 0.01;
  note(c, 523.25, t, 0.3, 0.2, 'sine'); // C5 (Do)
  note(c, 1046.5, t, 0.2, 0.06, 'triangle');
  note(c, 659.25, t + 0.12, 0.3, 0.2, 'sine'); // E5 (Mi)
  note(c, 1318.5, t + 0.12, 0.2, 0.06, 'triangle');
  note(c, 783.99, t + 0.24, 0.35, 0.22, 'sine'); // G5 (Sol)
  note(c, 1567.98, t + 0.24, 0.25, 0.07, 'triangle');
  note(c, 1046.5, t + 0.4, 0.6, 0.2, 'sine'); // C6 remate
  note(c, 2093, t + 0.4, 0.4, 0.06, 'triangle');
}
