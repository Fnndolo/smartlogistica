'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import { History, Loader2, X } from 'lucide-react';
import type { OrderMessageHistory } from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Historial de un mensaje editado del chat interno (SOLO administradores): cada
 * version que tuvo, de la original a la actual, con quien la escribio y cuando.
 */
export function MessageHistoryDialog({
  orderId,
  messageId,
  onClose,
}: {
  orderId: string;
  messageId: string | null;
  onClose: () => void;
}) {
  const open = messageId !== null;

  const { data, isLoading, error } = useQuery({
    queryKey: ['message-history', orderId, messageId],
    queryFn: () =>
      api.get<OrderMessageHistory>(`/v1/orders/${orderId}/messages/${messageId}/history`),
    enabled: open,
    retry: false,
  });

  // Escape cierra, en fase de captura + stopPropagation: si no, tambien
  // cerraria el drawer (que escucha Escape en document).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  const versions = data?.versions ?? [];
  // Lo mas reciente arriba: es lo que se esta comparando con la burbuja.
  const newestFirst = [...versions].reverse();

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="msg-history-title"
        className="shadow-pop flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <History className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="msg-history-title" className="text-[15px] font-semibold leading-tight">
              Historial del mensaje
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {versions.length > 1
                ? `${versions.length - 1} ${versions.length === 2 ? 'edición' : 'ediciones'} · solo lo ven los administradores`
                : 'Solo lo ven los administradores'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
            </div>
          ) : error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive">
              {error instanceof ApiError ? error.message : 'No se pudo cargar el historial.'}
            </p>
          ) : (
            <ol className="space-y-3">
              {newestFirst.map((v, i) => {
                const current = i === 0;
                const original = i === newestFirst.length - 1;
                return (
                  <li
                    key={`${v.at}-${i}`}
                    className={cn(
                      'rounded-xl border px-3.5 py-2.5',
                      current ? 'border-accent/40 bg-accent/5' : 'border-border bg-surface',
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                      <span
                        className={cn(
                          'font-semibold uppercase tracking-[0.06em]',
                          current ? 'text-accent' : 'text-hint',
                        )}
                      >
                        {current ? 'Actual' : original ? 'Original' : 'Versión anterior'}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {format(new Date(v.at), 'd MMM, HH:mm', { locale: es })}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="min-w-0 truncate">{v.byName}</span>
                    </div>
                    <p
                      className={cn(
                        'whitespace-pre-wrap break-words text-[13.5px] leading-[1.45]',
                        !current && 'text-muted-foreground',
                      )}
                    >
                      {v.body || '—'}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
