'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PackagePreset } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

interface Row {
  name: string;
  weight: string;
  height: string;
  width: string;
  length: string;
}

const toRow = (p: PackagePreset): Row => ({
  name: p.name,
  weight: String(p.weight),
  height: String(p.height),
  width: String(p.width),
  length: String(p.length),
});

const EMPTY_ROW: Row = { name: '', weight: '', height: '', width: '', length: '' };

/**
 * Paquetes guardados PROPIOS del modo Skydropx — GLOBALES. Equivalen a los
 * "Mis paquetes" del panel de Skydropx, que su API no expone (probado): se
 * gestionan aqui y se eligen al generar una guia en modo Skydropx. Aparte de
 * los paquetes de guia de Coordinadora ("Coordinadora lo suyo, Skydropx lo
 * suyo"). initial null = la lectura SSR fallo: no se permite guardar (el PUT
 * es reemplazo total y pisaria lo configurado).
 */
export function SkydropxPackagesCard({ initial }: { initial: PackagePreset[] | null }) {
  const [rows, setRows] = useState<Row[]>((initial ?? []).map(toRow));
  const [dirty, setDirty] = useState(false);

  const patch = (i: number, p: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setDirty(true);
  };
  const add = () => {
    setRows((rs) => [...rs, EMPTY_ROW]);
    setDirty(true);
  };

  const valid = rows.every(
    (r) =>
      r.name.trim().length > 0 &&
      Number(r.weight) > 0 &&
      Number(r.height) > 0 &&
      Number(r.width) > 0 &&
      Number(r.length) > 0,
  );

  const save = useMutation({
    mutationFn: () =>
      api.put<PackagePreset[]>(
        `/v1/skydropx/package-presets`,
        rows.map((r) => ({
          name: r.name.trim(),
          weight: Number(r.weight),
          height: Number(r.height),
          width: Number(r.width),
          length: Number(r.length),
        })),
      ),
    onSuccess: () => {
      setDirty(false);
      toast.success('Paquetes de Skydropx guardados');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar los paquetes'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Boxes className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Paquetes Skydropx</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Como los «Mis paquetes» de tu panel de Skydropx (su API no los deja traer): al generar en
            modo Skydropx los eliges y llenan medidas y peso de un clic. Independientes de los
            paquetes de Coordinadora.
          </p>
        </div>
      </div>

      {initial === null ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No se pudieron cargar los paquetes (API reiniciando). Recarga la página antes de editar.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {rows.length > 0 ? (
              <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_2rem] gap-2 px-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid">
                <span>Nombre</span>
                <span>Alto cm</span>
                <span>Ancho cm</span>
                <span>Largo cm</span>
                <span>Peso kg</span>
                <span />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                Sin paquetes aún. Crea el primero (ej. «TECNOLOGIA»).
              </p>
            )}

            {rows.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_2rem] sm:border-0 sm:p-0"
              >
                <Input
                  value={r.name}
                  placeholder="Nombre (ej. TECNOLOGIA)"
                  onChange={(e) => patch(i, { name: e.target.value })}
                  className="col-span-2 sm:col-span-1"
                />
                <Input
                  inputMode="decimal"
                  value={r.height}
                  placeholder="Alto"
                  aria-label="Alto (cm)"
                  onChange={(e) => patch(i, { height: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <Input
                  inputMode="decimal"
                  value={r.width}
                  placeholder="Ancho"
                  aria-label="Ancho (cm)"
                  onChange={(e) => patch(i, { width: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <Input
                  inputMode="decimal"
                  value={r.length}
                  placeholder="Largo"
                  aria-label="Largo (cm)"
                  onChange={(e) => patch(i, { length: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <Input
                  inputMode="decimal"
                  value={r.weight}
                  placeholder="Peso"
                  aria-label="Peso (kg)"
                  onChange={(e) => patch(i, { weight: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="flex h-9 w-8 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={`Eliminar ${r.name || 'paquete'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={add}>
              <Plus className="h-3.5 w-3.5" />
              Agregar paquete
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!dirty || !valid}
              loading={save.isPending}
            >
              Guardar paquetes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
