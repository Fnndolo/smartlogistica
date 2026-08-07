'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface LightboxImage {
  url: string;
  name?: string | null;
  caption?: string | null;
}

/**
 * Visor de imagenes EMBEBIDO (estilo Google): overlay a pantalla completa con
 * fondo oscuro difuminado, zoom con un clic, flechas para navegar entre todas
 * las imagenes de la conversacion, descargar/abrir, Esc o clic afuera cierra.
 * Liviano: solo CSS transitions, cero librerias.
 */
export function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const [zoom, setZoom] = useState(false);
  const img = images[index];

  // Zoom se resetea al cambiar de imagen.
  useEffect(() => setZoom(false), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1);
    };
    document.addEventListener('keydown', onKey);
    // Bloquear el scroll de atras mientras el visor esta abierto.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [index, images.length, onClose, onNavigate]);

  if (!img || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="lightbox-in fixed inset-0 z-[100] flex flex-col bg-[rgba(4,7,12,0.92)] backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Barra superior: nombre + acciones */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 md:px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-[13px] text-white/80">
          {img.name || 'Imagen'}
          {images.length > 1 ? (
            <span className="ml-2 font-mono text-[11.5px] text-white/50">
              {index + 1} / {images.length}
            </span>
          ) : null}
        </p>
        <a
          href={img.url}
          download={img.name ?? 'imagen'}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Descargar"
          title="Descargar"
        >
          <Download className="h-[18px] w-[18px]" />
        </a>
        <a
          href={img.url}
          target="_blank"
          rel="noreferrer"
          className="hidden h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white md:flex"
          aria-label="Abrir en otra pestaña"
          title="Abrir en otra pestaña"
        >
          <ExternalLink className="h-[18px] w-[18px]" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Imagen (clic = zoom; clic afuera = cerrar) */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={img.name ?? 'Imagen'}
          decoding="async"
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => !z);
          }}
          className={cn(
            'max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl transition-transform duration-300 ease-out',
            zoom ? 'scale-[1.9] cursor-zoom-out' : 'cursor-zoom-in',
          )}
          draggable={false}
        />

        {index > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index - 1);
            }}
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 md:left-4"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {index < images.length - 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index + 1);
            }}
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 md:right-4"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>

      {img.caption ? (
        <p
          className="mx-auto mb-3 max-w-[85%] truncate rounded-full bg-white/10 px-4 py-1.5 text-center text-[13px] text-white/90 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {img.caption}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
