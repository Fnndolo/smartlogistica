'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WarehouseSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

export function WarehousesManager({ initial }: { initial: WarehouseSummary[] }) {
  const qc = useQueryClient();
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    initialData: initial,
  });

  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['warehouses'] });

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setCreating(true);
    try {
      await api.post('/v1/warehouses', { name: trimmed, invoicePrefix: prefix.trim() || undefined });
      toast.success(`Sede "${trimmed}" creada`);
      setName('');
      setPrefix('');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear la sede');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="flex items-center gap-2"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la sede (ej: Pasto, Medellin, Bodega Centro)"
          className="max-w-sm"
          maxLength={60}
        />
        <Input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          placeholder="Prefijo (ej: PA)"
          className="w-32 font-mono uppercase"
          maxLength={6}
          title="Prefijo de factura VTEX (ej. Pasto = PA)"
        />
        <Button type="submit" loading={creating} disabled={name.trim().length < 2}>
          <Plus className="h-4 w-4" />
          Crear sede
        </Button>
      </form>

      {warehouses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Building2 className="h-5 w-5 text-foreground" />
          </div>
          <h2 className="mt-4 text-base font-semibold">Aun no tienes sedes</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Crea tu primera sede arriba. Luego podras asignarle pedidos desde &laquo;Pedidos&raquo;.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((w) => (
            <WarehouseCard key={w.id} warehouse={w} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function WarehouseCard({
  warehouse,
  onChanged,
}: {
  warehouse: WarehouseSummary;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(warehouse.name);
  const [prefix, setPrefix] = useState(warehouse.invoicePrefix ?? '');
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setName(warehouse.name);
    setPrefix(warehouse.invoicePrefix ?? '');
    setEditing(false);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      cancel();
      return;
    }
    setEditing(false);
    if (trimmed === warehouse.name && prefix === (warehouse.invoicePrefix ?? '')) return;
    setBusy(true);
    try {
      await api.patch(`/v1/warehouses/${warehouse.id}`, {
        name: trimmed,
        invoicePrefix: prefix.trim() || undefined,
      });
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
      cancel();
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archivar la sede "${warehouse.name}"?`)) return;
    setBusy(true);
    try {
      await api.delete(`/v1/warehouses/${warehouse.id}`);
      toast.success('Sede archivada');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo archivar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <Building2 className="h-4 w-4 text-foreground" />
          </div>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') cancel();
                }}
                className="h-8"
                maxLength={60}
              />
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') cancel();
                }}
                placeholder="PA"
                className="h-8 w-16 font-mono uppercase"
                maxLength={6}
                title="Prefijo de factura VTEX"
              />
              <Button size="sm" className="h-8 shrink-0" onClick={save}>
                OK
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
              title="Editar nombre y prefijo"
            >
              <span className="truncate text-sm font-semibold">{warehouse.name}</span>
              {warehouse.invoicePrefix ? (
                <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {warehouse.invoicePrefix}
                </span>
              ) : null}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={archive}
          disabled={busy}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
          aria-label="Archivar sede"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-3 text-2xl font-semibold tabular-nums">{warehouse.orderCount}</p>
      <p className="text-xs text-muted-foreground">pedidos asignados</p>

      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={`/warehouses/${warehouse.id}`}>
          Ver pedidos
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
