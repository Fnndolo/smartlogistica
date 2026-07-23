'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PackagePreset, WarehouseSummary } from '@smartlogistica/shared';

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
 * Paquetes predefinidos para las guias de Coordinadora (por sede). Equivalen a
 * los "empaques" del portal web de Coordinadora — su API no los expone, asi que
 * se configuran aqui y se eligen en la pestana Guia del pedido.
 */
export function PackagePresetsCard({
  warehouseId,
  initial,
}: {
  warehouseId: string;
  initial: PackagePreset[];
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
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
      api.put<WarehouseSummary>(
        `/v1/warehouses/${warehouseId}/package-presets`,
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
      toast.success('Paquetes guardados');
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['guide-preview'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar los paquetes'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Package className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Paquetes de guía</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Como los empaques del portal de Coordinadora: al generar una guía los eliges y llenan
            medidas y peso de un clic.
          </p>
        </div>
      </div>

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
            Sin paquetes aún. Crea el primero (ej. «Celular», «Portátil»).
          </p>
        )}

        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_2rem] sm:border-0 sm:p-0"
          >
            <Input
              value={r.name}
              placeholder="Nombre (ej. Celular)"
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
    </div>
  );
}
