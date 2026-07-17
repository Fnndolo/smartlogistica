'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import type { CoordinadoraCity } from '@smartlogistica/shared';

/** Selector de ciudad con busqueda (codigo DANE de Coordinadora). Origen y destino. */
export function CityPicker({
  value,
  onPick,
  search,
  queryKey,
  disabled,
}: {
  value: string;
  onPick: (city: CoordinadoraCity) => void;
  search: (q: string) => Promise<CoordinadoraCity[]>;
  queryKey: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: cities = [], isFetching } = useQuery({
    queryKey: ['coord-cities', queryKey, q.trim()],
    queryFn: () => search(q.trim()),
    enabled: open && q.trim().length >= 2,
    staleTime: 60_000,
  });

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={value ? 'truncate' : 'text-muted-foreground'}>{value || 'Buscar ciudad...'}</span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-2 shadow-lg">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ciudad o departamento..."
                className="h-6 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            {q.trim().length < 2 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">Escribe al menos 2 letras.</p>
            ) : isFetching ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">Buscando...</p>
            ) : cities.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">Sin resultados.</p>
            ) : (
              <ul className="max-h-56 overflow-auto pt-1">
                {cities.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(c);
                        setOpen(false);
                        setQ('');
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="break-words">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{c.department}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
