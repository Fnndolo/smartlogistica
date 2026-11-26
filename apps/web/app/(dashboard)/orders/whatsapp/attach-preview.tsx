'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Film, Plus, Send, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Archivo en espera de confirmacion (pegado, arrastrado o agregado con el +).
 * `caption`: el texto que lo acompaña, propio de cada foto o video.
 */
export type StagedWaFile = { id: string; file: File; url: string; caption: string };

const isImage = (f: File) => f.type.startsWith('image/');
const isVideo = (f: File) => f.type.startsWith('video/');

/**
 * Solo fotos y videos llevan texto, como en WhatsApp: el de un documento o un
 * audio no tendria donde guardarse (ahi el mensaje guarda el nombre del archivo).
 */
export const canCaption = (f: File): boolean => isImage(f) || isVideo(f);

/** Tope de Meta para el texto de una foto o video (el API valida lo mismo). */
export const CAPTION_MAX = 1024;

/** ¿Hay mouse? En el cel, enfocar un campo abre el teclado y tapa la foto. */
const hasMouse = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

const fmtSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Vista previa ANTES de enviar al cliente, como WhatsApp Web: lo que se pega
 * con Ctrl+V o se arrastra al chat NO sale solo. Un Ctrl+V por error (o con
 * otra cosa en el portapapeles) le llegaria al cliente sin poder deshacerlo.
 *
 * Cada foto o video lleva su propio texto (caption), como en WhatsApp: se
 * escribe debajo de la vista grande y viaja pegado al archivo.
 *
 * Enter o el boton verde envian todo (Shift+Enter, salto de linea); Esc o la X
 * cancelan. Tapa el panel entero (cabecera, hilo y barra) para que no quede
 * duda de que hay un envio pendiente.
 */
export function AttachPreview({
  files,
  onAddMore,
  onRemove,
  onCaption,
  onCancel,
  onSend,
}: {
  files: StagedWaFile[];
  onAddMore: () => void;
  onRemove: (id: string) => void;
  onCaption: (id: string, text: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  // Por defecto se ve el ULTIMO agregado (lo recien pegado).
  const lastId = files[files.length - 1]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(lastId);
  useEffect(() => setSelectedId(lastId), [lastId]);
  const current = files.find((f) => f.id === selectedId) ?? files[files.length - 1];
  const currentIdx = current ? files.indexOf(current) : -1;
  const captionable = current ? canCaption(current.file) : false;

  // Foco inicial: con mouse, en el TEXTO de la foto (se escribe de una, como en
  // WhatsApp Web). En el cel, en Enviar: enfocar el texto abriria el teclado
  // encima de la foto. Nunca queda en el campo del chat, que esta TAPADO.
  // Los siguientes Ctrl+V igual llegan al panel (el evento sube desde aqui).
  useEffect(() => {
    if (captionable && hasMouse()) captionRef.current?.focus();
    else sendRef.current?.focus();
    // Solo al abrir: despues el foco es de quien escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El texto CRECE con los saltos de linea hasta ~5 lineas; luego hace scroll.
  const caption = current?.caption ?? '';
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [caption, current?.id]);

  // Teclado en fase de CAPTURA + stopPropagation, como el visor de fotos: el
  // drawer escucha Esc en document y la bandeja en window; sin esto el mismo
  // Esc cerraria tambien el pedido o el chat.
  const onSendRef = useRef(onSend);
  const onCancelRef = useRef(onCancel);
  onSendRef.current = onSend;
  onCancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      const ae = document.activeElement;
      // Solo si el foco esta en la vista previa (o en ningun lado): un dialogo
      // abierto encima, como la busqueda global, recibe sus propias teclas.
      if (!root || (ae && ae !== document.body && !root.contains(ae))) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        // Enter sobre "quitar" o una miniatura hace lo de ESE boton.
        if (ae instanceof HTMLButtonElement && ae !== sendRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        onSendRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  if (!current) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Enviar archivos al cliente"
      className="absolute inset-0 z-40 flex flex-col bg-[#e9edef] dark:bg-[#0b141a]"
    >
      {/* Cabecera: cancelar + nombre del archivo que se esta viendo. */}
      <div className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 dark:bg-[#202c33] md:px-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar envío"
          title="Cancelar (Esc)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">
            {current.file.name}
          </p>
          <p className="text-[12px] text-[#667781] dark:text-[#8696a0]">
            {fmtSize(current.file.size)}
            {files.length > 1 ? ` · ${currentIdx + 1} de ${files.length}` : ''}
          </p>
        </div>
      </div>

      {/* Vista grande del archivo elegido. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-6">
        {isImage(current.file) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.file.name}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          />
        ) : isVideo(current.file) ? (
          <video
            key={current.id}
            src={current.url}
            controls
            preload="metadata"
            className="max-h-full max-w-full rounded-md bg-black"
          />
        ) : (
          <div className="flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl bg-white px-6 py-8 text-center shadow-sm dark:bg-[#202c33]">
            <FileText className="h-12 w-12 text-[#7f66ff]" />
            <p className="w-full truncate text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">
              {current.file.name}
            </p>
            <p className="text-[12px] text-[#667781] dark:text-[#8696a0]">Sin vista previa</p>
          </div>
        )}
      </div>
      <p className="hidden pb-2 text-center text-[11.5px] text-[#667781] dark:text-[#8696a0] md:block">
        Enter para enviar · Shift+Enter salto de línea · Esc para cancelar · Ctrl+V para agregar
        más
      </p>

      {/* TEXTO de la foto/video que se esta viendo (cada una tiene el suyo). */}
      {captionable ? (
        <div className="px-3 pb-2 md:px-6">
          <textarea
            ref={captionRef}
            value={current.caption}
            onChange={(e) => onCaption(current.id, e.target.value)}
            rows={1}
            maxLength={CAPTION_MAX}
            placeholder="Añade un comentario"
            aria-label="Texto que acompaña el archivo"
            // 16px en cel (minimo anti auto-zoom), como el campo del chat.
            className="scrollbar-none mx-auto block min-h-10 w-full max-w-2xl resize-none overflow-hidden rounded-lg bg-white px-4 py-[9px] text-[16px] leading-[22px] text-[#111b21] outline-none placeholder:text-[#667781] focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0] md:text-[14.5px]"
          />
          {current.caption.length > CAPTION_MAX - 100 ? (
            <p className="mx-auto mt-1 max-w-2xl text-right text-[11px] text-[#667781] dark:text-[#8696a0]">
              {current.caption.length}/{CAPTION_MAX}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="px-3 pb-2 text-center text-[12px] text-[#667781] dark:text-[#8696a0]">
          Los documentos y audios se envían sin texto.
        </p>
      )}

      {/* Miniaturas (elegir / quitar) + agregar mas + ENVIAR. */}
      <div className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto pb-1 pr-2 pt-2">
          {files.map((f) => (
            <div key={f.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSelectedId(f.id)}
                aria-label={`Ver ${f.file.name}`}
                className={cn(
                  'flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-white ring-2 transition-shadow dark:bg-[#2a3942]',
                  f.id === current.id ? 'ring-[#00a884]' : 'ring-transparent hover:ring-black/15',
                )}
              >
                {isImage(f.file) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                ) : isVideo(f.file) ? (
                  <Film className="h-5 w-5 text-[#007bfc]" />
                ) : (
                  <FileText className="h-5 w-5 text-[#7f66ff]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Quitar ${f.file.name}`}
                title="Quitar"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#54656f] text-white shadow hover:bg-[#3b4a54]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddMore}
            aria-label="Agregar más archivos"
            title="Agregar más"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-[#8696a0] text-[#54656f] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <button
          ref={sendRef}
          type="button"
          onClick={onSend}
          aria-label={files.length > 1 ? `Enviar ${files.length} archivos` : 'Enviar'}
          title="Enviar (Enter)"
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow transition-colors hover:bg-[#029377] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f5] dark:focus-visible:ring-offset-[#202c33]"
        >
          <Send className="h-5 w-5" />
          {files.length > 1 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold text-[#00a884] shadow">
              {files.length}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
