'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 350;

/**
 * Busqueda universal. Matchea por nombre de cliente, N.º de pedido, cedula o
 * nombre de producto (incluye ordenes multi-producto). El valor vive en la URL
 * (?q=) para que sea compartible y persista al recargar; se escribe con debounce
 * para no disparar un fetch por tecla.
 */
export function SearchFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get('q') ?? '';
  const [value, setValue] = useState(urlValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lo ultimo que NOSOTROS escribimos a la URL (commit debounced).
  const lastCommitted = useRef(urlValue);

  // Re-sincronizar el input desde la URL SOLO cuando el cambio es EXTERNO
  // (back/forward del navegador, limpiar desde otro lado). NUNCA cuando viene
  // de nuestro propio commit debounced — sino pisa lo que el usuario sigue
  // escribiendo (el input "se devuelve" a un valor intermedio = se siente feo).
  useEffect(() => {
    if (urlValue !== lastCommitted.current) {
      lastCommitted.current = urlValue;
      setValue(urlValue);
    }
  }, [urlValue]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    lastCommitted.current = trimmed;
    const params = new URLSearchParams(searchParams.toString());
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    params.delete('page');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const onChange = (next: string) => {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm sm:w-auto',
        'focus-within:ring-2 focus-within:ring-ring',
        value && 'border-foreground/40',
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar por cliente, N.º, producto..."
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-72"
        aria-label="Buscar pedidos"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            commit('');
          }}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Limpiar busqueda"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
