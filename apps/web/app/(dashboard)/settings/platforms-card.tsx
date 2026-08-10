'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { badgeColorSchema, type BadgeColor, type Platform } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BADGE_COLOR_CLASSES,
  SWATCH_COLOR_CLASSES,
} from '../orders/platform-badge';

interface Row {
  /** id estable de la plataforma; null = fila nueva (se genera al guardar). */
  id: string | null;
  name: string;
  color: BadgeColor;
}

const ALL_COLORS = badgeColorSchema.options;

/**
 * Catalogo de PLATAFORMAS: de donde viene cada pedido. VTEX es la integracion
 * (no se puede eliminar, solo su color); las demas (Krediya, Mercado Libre...)
 * se eligen al MONTAR un pedido a mano. El color pinta el badge de la columna
 * "Plataforma" en la sede.
 */
export function PlatformsCard({ initial }: { initial: Platform[] | null }) {
  const qc = useQueryClient();
  // null = aun no hay catalogo REAL cargado (el SSR fallo). Se reintenta por
  // el cliente; el guardado queda bloqueado hasta tener datos de verdad — un
  // PUT sembrado con defaults pisaria el catalogo personalizado.
  const [rows, setRows] = useState<Row[] | null>(
    initial ? initial.map((p) => ({ ...p })) : null,
  );
  const [dirty, setDirty] = useState(false);

  const fallback = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/v1/platforms'),
    enabled: rows === null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (rows === null && fallback.data) {
      setRows(fallback.data.map((p) => ({ ...p })));
    }
  }, [rows, fallback.data]);

  const patch = (i: number, p: Partial<Row>) => {
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...p } : r)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setRows((rs) => (rs ?? []).filter((_, j) => j !== i));
    setDirty(true);
  };
  const add = () => {
    setRows((rs) => [...(rs ?? []), { id: null, name: '', color: 'sky' }]);
    setDirty(true);
  };

  const current = rows ?? [];
  const valid =
    current.length > 0 &&
    current.every((r) => r.name.trim().length >= 2 && r.name.trim().length <= 40) &&
    new Set(current.map((r) => r.name.trim().toLowerCase())).size === current.length;

  const save = useMutation({
    mutationFn: () => {
      // id estable: el existente, o un slug del nombre (unico) para las nuevas.
      const taken = new Set(current.map((r) => r.id).filter(Boolean) as string[]);
      const payload = current.map((r) => {
        if (r.id) return { id: r.id, name: r.name.trim(), color: r.color };
        // Sufijo anticolision SIN pasarse de los 40 chars que exige el schema.
        const base = slugify(r.name);
        let id = base;
        for (let n = 2; taken.has(id); n++) {
          const suffix = `-${n}`;
          id = `${base.slice(0, 40 - suffix.length)}${suffix}`;
        }
        taken.add(id);
        return { id, name: r.name.trim(), color: r.color };
      });
      return api.put<Platform[]>('/v1/platforms', payload);
    },
    onSuccess: (saved) => {
      setRows(saved.map((p) => ({ ...p })));
      setDirty(false);
      toast.success('Plataformas guardadas');
      // Refresca los badges de la tabla y el selector de "Montar pedido".
      qc.invalidateQueries({ queryKey: ['platforms'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar las plataformas'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Store className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Plataformas</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            De dónde viene cada pedido. Las eliges al montar un pedido a mano y pintan la columna
            «Plataforma» de la sede con su color. VTEX es la integración: puedes cambiarle el color,
            no eliminarla.
          </p>
        </div>
      </div>

      {rows === null ? (
        <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {fallback.isError ? (
            <>
              No se pudo cargar el catálogo de plataformas (¿API reiniciando?).{' '}
              <button
                type="button"
                onClick={() => fallback.refetch()}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Reintentar
              </button>
            </>
          ) : (
            'Cargando plataformas...'
          )}
        </div>
      ) : (
        <>
      <div className="mt-4 space-y-2">
        {current.map((r, i) => {
          const isVtex = r.id === 'vtex';
          return (
            <div
              key={r.id ?? `new-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
            >
              {/* Vista previa del badge tal cual se vera en la tabla. */}
              <span
                className={cn(
                  'inline-flex min-w-[92px] items-center justify-center gap-[5px] rounded-full border px-[9px] py-[2.5px] text-[10px] font-semibold uppercase tracking-[0.06em]',
                  BADGE_COLOR_CLASSES[r.color],
                )}
              >
                <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
                {r.name.trim() || 'Nueva'}
              </span>

              <Input
                value={r.name}
                placeholder="Nombre (ej. Krediya)"
                maxLength={40}
                disabled={isVtex}
                onChange={(e) => patch(i, { name: e.target.value })}
                className="h-8 w-40 flex-1 sm:flex-none"
              />

              <ColorPicker value={r.color} onPick={(c) => patch(i, { color: c })} />

              {!isVtex ? (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={`Eliminar ${r.name || 'plataforma'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : (
                <span className="ml-auto pr-1 text-[10.5px] uppercase tracking-wide text-muted-foreground/60">
                  Integración
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Agregar plataforma
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || !valid} loading={save.isPending}>
          Guardar plataformas
        </Button>
      </div>
      {!valid && dirty ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cada plataforma necesita un nombre (2 a 40 letras) y no puede repetirse.
        </p>
      ) : null}
        </>
      )}
    </div>
  );
}

/** Selector de color: swatch actual -> paleta en popover. */
function ColorPicker({ value, onPick }: { value: BadgeColor; onPick: (c: BadgeColor) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Elegir color"
        title="Color del badge"
      >
        <span className={cn('h-3.5 w-3.5 rounded-full', SWATCH_COLOR_CLASSES[value])} />
        Color
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1.5 grid w-max grid-cols-6 gap-1.5 rounded-xl border border-border bg-popover p-2 shadow-lg">
          {ALL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110',
                SWATCH_COLOR_CLASSES[c],
              )}
              aria-label={c}
            >
              {c === value ? <Check className="h-3.5 w-3.5 text-white" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plataforma'
  );
}
