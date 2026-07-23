'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import type { OrderSearchResult } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { orderTarget } from './use-mentions';

const STAGE_META: Record<
  OrderSearchResult['stage'],
  { label: string; variant: 'outline' | 'warning' | 'success' }
> = {
  general: { label: 'Generales', variant: 'outline' },
  pending: { label: 'Por preparar', variant: 'warning' },
  invoiced: { label: 'Facturado', variant: 'success' },
};

/**
 * Busqueda GLOBAL de pedidos (generales + todas las sedes, por preparar y
 * facturados). Busca por cliente, N.º de pedido, cedula o producto; al elegir
 * un resultado abre el pedido donde vive, con su drawer completo.
 *
 * `variant`: 'sidebar' = fila con atajo ⌘K (escritorio); 'icon' = boton para
 * el top bar movil.
 */
export function GlobalSearch({ variant }: { variant: 'sidebar' | 'icon' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo de teclado (solo lo registra la variante de escritorio para no abrir doble).
  useEffect(() => {
    if (variant !== 'sidebar') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setDebounced('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api.get<OrderSearchResult[]>(`/v1/orders/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const go = (r: OrderSearchResult) => {
    setOpen(false);
    router.push(orderTarget(r));
  };

  const modal =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[60]">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="absolute inset-x-3 top-16 mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl sm:top-24">
              <div className="flex items-center gap-2.5 border-b border-border px-3.5">
                {isFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                    if (e.key === 'Enter' && results[0]) go(results[0]);
                  }}
                  placeholder="Buscar pedidos: cliente, N.º, cédula o producto..."
                  className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
                  ESC
                </kbd>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                {debounced.length < 2 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Busca en pedidos generales y en todas las sedes (por preparar y facturados).
                  </p>
                ) : results.length === 0 && !isFetching ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nada para «{debounced}».
                  </p>
                ) : (
                  results.map((r, i) => {
                    const stage = STAGE_META[r.stage];
                    return (
                      <button
                        key={r.orderId}
                        type="button"
                        onClick={() => go(r)}
                        className={cn(
                          'flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/60',
                          i === 0 && 'bg-muted/30',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{r.customerName}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {r.externalId}
                            </span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.productName ?? 'Sin producto'}
                            {r.customerDocument ? ` · CC ${r.customerDocument}` : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant={stage.variant}>{stage.label}</Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {r.warehouseName ?? 'Sin sede'}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (variant === 'icon') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Buscar pedidos"
          title="Buscar pedidos"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
        {modal}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 flex w-full items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left text-xs">Buscar pedidos...</span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      {modal}
    </>
  );
}
