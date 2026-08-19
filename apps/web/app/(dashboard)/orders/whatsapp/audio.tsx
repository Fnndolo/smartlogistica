'use client';

import { useEffect, useRef, useState } from 'react';
import type { WaMessage } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';

import { BAR_COUNT, addHeard, failText, fallbackBars, fmtSecs, getHeardSet, timeOf } from './helpers';
import { DefaultContactIcon, MicFilled, PauseFilled, PlayFilled, Ticks } from './icons';

/* ===================== Nota de voz (estilo WhatsApp) ===================== */

/**
 * Onda EN VIVO de la grabacion: AnalyserNode sobre el microfono + canvas a
 * 60fps (requestAnimationFrame). Las barras son la amplitud REAL y se
 * desplazan fluidas como en WhatsApp Web.
 */
export function LiveWave({ stream, paused }: { stream: MediaStream | null; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;
    type AC = typeof AudioContext;
    const Ctx: AC | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // Canvas nitido (dpr) al tamaño real del hueco.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    barsRef.current = [];

    const BAR_W = 2 * dpr;
    const GAP = 2 * dpr;
    const maxBars = Math.max(8, Math.floor(w / (BAR_W + GAP)));
    let raf = 0;
    let frame = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!g) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs((data[i] ?? 128) - 128) / 128;
        if (v > peak) peak = v;
      }
      // Nueva barra cada ~50ms (el DIBUJO va a 60fps igual).
      if (!pausedRef.current && frame++ % 3 === 0) {
        barsRef.current.push(Math.min(1, peak * 1.6));
        if (barsRef.current.length > maxBars) barsRef.current.shift();
      }
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#8696a0';
      const bars = barsRef.current;
      // Ancladas a la DERECHA, desplazandose a la izquierda (como WhatsApp).
      for (let i = 0; i < bars.length; i++) {
        const v = bars[bars.length - 1 - i] ?? 0;
        const bh = Math.max(2 * dpr, v * h * 0.86);
        const x = w - (i + 1) * (BAR_W + GAP);
        if (x < 0) break;
        g.fillRect(x, (h - bh) / 2, BAR_W, bh);
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="h-8 min-w-0 flex-1" />;
}

/**
 * Reproductor de nota de voz CALCADO a WhatsApp: avatar con microfono, play,
 * ONDAS REALES del audio (Web Audio API decodifica y saca los picos; si el
 * navegador no puede, onda de respaldo), punto de progreso, duracion y hora.
 */
/** Solo UN audio a la vez en toda la app: darle play a uno pausa al que suene. */
let waActiveAudio: HTMLAudioElement | null = null;

/** Sonidito de transicion al saltar a la siguiente nota de voz (como WhatsApp). */
function playChainBeep() {
  try {
    type AC = typeof AudioContext;
    const Ctx: AC | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1350, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    /* sin beep: no bloquea la reproduccion */
  }
}

export function WaAudio({
  message: m,
  mine,
  pending,
  base,
}: {
  message: WaMessage;
  mine: boolean;
  pending: boolean;
  base: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  // Primero por NUESTRA API (misma origen: la onda se puede decodificar sin
  // CORS); si el audio viejo solo tiene URL externa, se cae a esa.
  const apiSrc = `${base}/audio/${m.id}`;
  const [src, setSrc] = useState(apiSrc);

  // UNA sola descarga del audio: con el mismo archivo se muestrean los picos
  // de la onda REAL y se crea un blob EN MEMORIA que pasa a ser el src del
  // <audio> -> el play es INSTANTANEO (cero red, cero esperas de streaming).
  useEffect(() => {
    let alive = true;
    let blobUrl: string | null = null;
    void (async () => {
      try {
        let res = await fetch(apiSrc, { credentials: 'include' });
        if (!res.ok && m.mediaUrl) res = await fetch(m.mediaUrl);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        // El blob se arma ANTES de decodificar (decodeAudioData vacia el buffer).
        const blob = new Blob([buf.slice(0)], {
          type: res.headers.get('content-type') ?? 'audio/ogg',
        });
        type AC = typeof AudioContext;
        const Ctx: AC | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
        if (Ctx) {
          try {
            const ctx = new Ctx();
            const decoded = await ctx.decodeAudioData(buf);
            const ch = decoded.getChannelData(0);
            const block = Math.max(1, Math.floor(ch.length / BAR_COUNT));
            const p: number[] = [];
            for (let i = 0; i < BAR_COUNT; i++) {
              let peak = 0;
              for (let j = 0; j < block; j += 32)
                peak = Math.max(peak, Math.abs(ch[i * block + j] ?? 0));
              p.push(peak);
            }
            const max = Math.max(...p, 0.01);
            if (alive) {
              setPeaks(p.map((v) => Math.max(0.18, v / max)));
              if (Number.isFinite(decoded.duration)) setDur(decoded.duration);
            }
            void ctx.close();
          } catch {
            /* formato raro: quedan las barras de respaldo */
          }
        }
        if (!alive) return;
        // Pasarse al blob local: si aun no ha avanzado (parado o TRABADO en
        // 0), se cambia ya mismo; y si el usuario ya habia dado play, se
        // reanuda solo sobre el blob (esto destranca el primer play lento).
        const a = audioRef.current;
        if (!a || a.currentTime < 0.1) {
          blobUrl = URL.createObjectURL(blob);
          const resume = a ? !a.paused : false;
          const keepRate = a?.playbackRate ?? 1;
          setSrc(blobUrl);
          if (resume) {
            window.setTimeout(() => {
              const el = audioRef.current;
              if (el) {
                el.playbackRate = keepRate;
                void el.play();
              }
            }, 60);
          }
        }
      } catch {
        /* CORS o red: el <audio> sigue con la URL normal */
      }
    })();
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [apiSrc, m.mediaUrl]);

  const bars = peaks ?? fallbackBars(m.id);
  const progress = dur && dur > 0 ? Math.min(1, t / dur) : 0;

  const [heard, setHeard] = useState(false);
  useEffect(() => setHeard(getHeardSet().has(m.id)), [m.id]);

  // Velocidad de reproduccion (el boton 1x/1.5x/2x de WhatsApp, que aparece
  // en el puesto del avatar MIENTRAS suena la nota).
  const [rate, setRate] = useState(1);
  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    const a = audioRef.current;
    if (a) a.playbackRate = next;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      a.playbackRate = rate;
      void a.play();
      if (!heard) {
        addHeard(m.id);
        setHeard(true);
      }
    }
  };
  // Autoplay en cadena: el panel avisa que ESTE audio es el que sigue ->
  // sonidito de transicion y a reproducir (queda como escuchado).
  useEffect(() => {
    const h = (ev: Event) => {
      if ((ev as CustomEvent<{ id?: string }>).detail?.id !== m.id) return;
      const a = audioRef.current;
      if (!a) return;
      playChainBeep();
      addHeard(m.id);
      setHeard(true);
      window.setTimeout(() => {
        a.playbackRate = rate;
        void a.play();
      }, 180);
    };
    window.addEventListener('wa-audio-play-id', h);
    return () => window.removeEventListener('wa-audio-play-id', h);
  }, [m.id, rate]);

  // Progreso FLUIDO (60fps): mientras suena, la posicion se lee en cada frame
  // con requestAnimationFrame (el evento timeupdate solo llega ~4 veces/seg).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const a = audioRef.current;
      if (a) setT(a.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Adelantar/retroceder: click O ARRASTRE de la bolita (pointer capture ->
  // el arrastre sigue fluido aunque el mouse se salga de la onda).
  const draggingRef = useRef(false);
  const scrubTo = (clientX: number, el: HTMLElement) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    a.currentTime = frac * dur;
    setT(frac * dur);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientX, e.currentTarget);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) scrubTo(e.clientX, e.currentTarget);
  };
  const onScrubEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya estaba suelto */
    }
  };

  // Colores CALCADOS: enviado -> mic gris verdoso y bolita azul; recibido ->
  // mic y bolita VERDES hasta escucharlo, luego azules.
  const dotColor = mine ? '#4fc3f7' : heard ? '#4fc3f7' : '#25d366';
  const micColor = mine ? '#4d5e56' : heard ? '#4fc3f7' : '#25d366';
  const barPlayed = 'bg-[#7a8a93] dark:bg-[#8696a0]';
  const barIdle = mine ? 'bg-[#a9cbb7] dark:bg-[#1d5c4d]' : 'bg-[#cdd4d8] dark:bg-[#3b4a54]';

  const avatar = (
    // Avatar REAL de WhatsApp (default-contact-refreshed a circulo completo).
    // Mientras SUENA la nota, el avatar se reemplaza por el boton de
    // velocidad (1x -> 1.5x -> 2x), igual que en WhatsApp Web.
    <span className="relative flex h-[54px] w-[54px] shrink-0 items-center justify-center">
      {playing ? (
        <button
          type="button"
          onClick={cycleRate}
          className="flex h-[26px] min-w-[42px] items-center justify-center rounded-full bg-[#8696a0] px-1.5 text-[13px] font-semibold leading-none text-white dark:bg-[#3b4a54] dark:text-[#e9edef]"
          aria-label={`Velocidad ${rate}×`}
        >
          {rate}×
        </button>
      ) : (
        <>
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#dfe5e7] text-[#606263] dark:bg-[#2a3942] dark:text-[#8696a0]">
            <DefaultContactIcon className="h-full w-full" />
          </span>
          <MicFilled
            className={cn('absolute bottom-0 h-[26px] w-[17px]', mine ? 'right-[2px]' : '-left-[0px]')}
            style={{ color: micColor }}
          />
        </>
      )}
    </span>
  );

  const playBtn = (
    // El -left-[6px] corre SOLO el boton a la izquierda (posicion relativa:
    // no empuja al avatar, la onda, la hora ni la duracion).
    <span className="relative -left-[6px] shrink-0 mx-4">
      <button
        type="button"
        onClick={toggle}
        className="block text-[#111b21] dark:text-[#e9edef]"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
      >
        {playing ? (
          <PauseFilled className="h-[22px] w-[22px]" />
        ) : (
          <PlayFilled className="h-[22px] w-[22px]" />
        )}
      </button>
    </span>
  );

  // Columna de la onda: MISMA altura que el avatar (38px). La onda arriba y
  // la fila de duracion/hora abajo -> su borde inferior queda EXACTO al filo
  // inferior del circulo del avatar.
  const waveCol = (
    // Añadimos mr-8 (margen derecho de 32px) directamente aquí adentro
    <div className="flex h-[38px] min-w-0 flex-1 flex-col justify-between mr-8">
      <div
        className="relative h-[20px] min-w-0 cursor-pointer touch-none select-none"
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
      >
        {/* Capa 1: la onda completa en color SIN escuchar. El espaciado es
            AUTOMATICO (justify-between): la onda llena EXACTO el ancho del
            contenedor y termina justo donde la bolita llega al 100%. */}
        <div className="flex h-full items-center justify-between pl-1.5">
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn('w-[2.5px] shrink-0 rounded-full', barIdle)}
              style={{ height: `${Math.round(3 + v * 13)}px` }}
            />
          ))}
        </div>
        {/* Capa 2: la MISMA onda en color escuchado, RECORTADA al mismo % que
            posiciona la bolita. La copia interna mide 100/progress% (el
            inverso) -> siempre igual de ancha que la capa 1, barra por barra. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${(progress * 100).toFixed(3)}%` }}
        >
          <div
            className="flex h-full items-center justify-between pl-1.5"
            style={{ width: progress > 0.0001 ? `${(100 / progress).toFixed(3)}%` : '100%' }}
          >
            {bars.map((v, i) => (
              <span
                key={i}
                className={cn('w-[2.5px] shrink-0 rounded-full', barPlayed)}
                style={{ height: `${Math.round(3 + v * 13)}px` }}
              />
            ))}
          </div>
        </div>
        {/* Bolita SIEMPRE visible (al inicio si no se ha reproducido). */}
        <span
          className="absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full shadow"
          style={{ left: `calc(${(progress * 100).toFixed(3)}% - 4px)`, backgroundColor: dotColor }}
        />
      </div>
      <div className="flex items-center w-full pl-1.5 text-[11px] leading-[12px] text-[#667781] dark:text-[#8696a0]">

        {/* El contador de la izquierda (0:01) */}
        <span>{fmtSecs(playing || t > 0 ? t : (dur ?? 0))}</span>

        {/* 2. CONTROL TOTAL: Usa ml-[px] para empujarlo los píxeles exactos que quieras */}
        {/* Añadimos whitespace-nowrap al contenedor de la hora para prohibir los saltos de línea */}
        <span className="flex items-center gap-1 ml-[105px] whitespace-nowrap">
          {timeOf(m.createdAt)}
          {mine ? <Ticks status={m.status} pending={pending} failText={failText(m)} /> : null}
        </span>

      </div>
    </div>
  );




  return (
    // BURBUJA de 1.3cm EXACTOS (49px) para AMBOS, contenido CENTRADO
    // verticalmente (mismo aire arriba y abajo del avatar: (49-38)/2).
    <div className="flex h-[65px] w-[325px] max-w-full items-center px-1.5 ">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        className="hidden"
        onError={() => {
          if (m.mediaUrl && src !== m.mediaUrl) setSrc(m.mediaUrl);
        }}
        onPlay={(e) => {
          // Reproduccion EXCLUSIVA: si otro audio esta sonando, se pausa.
          const el = e.currentTarget;
          if (waActiveAudio && waActiveAudio !== el) waActiveAudio.pause();
          waActiveAudio = el;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setT(0);
          // Aviso para la CADENA: si el siguiente mensaje es audio, sigue el.
          window.dispatchEvent(new CustomEvent('wa-audio-next', { detail: { afterId: m.id } }));
        }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDur(d);
        }}
      />
      {mine ? (
        <>
          {avatar}
          <div className="w-2 shrink-0" />
          {playBtn}
          {/* Agregamos mt-2 para bajar la onda de audio y la hora */}
          <div className="min-w-0 flex-1 mt-4">{waveCol}</div>
        </>
      ) : (
        <>
          {playBtn}
          {/* Agregamos mt-2 para bajar la onda de audio y la hora */}
          <div className="min-w-0 flex-1 mt-4">{waveCol}</div>
          <div className="h-[54px] w-[54px] min-w-[54px] max-w-[54px] shrink-0">
            {avatar}
          </div>
        </>
      )}

    </div>
  );
}
