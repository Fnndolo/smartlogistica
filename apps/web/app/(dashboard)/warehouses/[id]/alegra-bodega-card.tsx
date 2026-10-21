'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Warehouse as WarehouseIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraBodega, AlegraBodegaOption } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { isAdmin } from '@/lib/rbac';
import { cn } from '@/lib/utils';

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted';

/**
 * BODEGA DE ALEGRA de la sede.
 *
 * Varias sedes comparten la misma empresa de Alegra y cada una tiene su propia
 * bodega dentro de ella. Si la factura no dice de cual sale, Alegra usa la
 * predeterminada: un producto que solo esta en la bodega de esta sede se
 * rechaza ("No se encontró el ítem ... en la bodega") y uno que esta en las
 * dos se descuenta del inventario de OTRA sede.
 */
export function AlegraBodegaCard({ warehouseId }: { warehouseId: string }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = isAdmin(user?.role);

  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['alegra-bodega', warehouseId],
    queryFn: () =>
      api.get<{ bodega: AlegraBodega | null }>(`/v1/warehouses/${warehouseId}/alegra/bodega`),
  });
  const current = data?.bodega ?? null;

  const {
    data: options = [],
    isFetching,
    error: listError,
  } = useQuery({
    queryKey: ['alegra-bodegas', warehouseId],
    queryFn: () => api.get<AlegraBodegaOption[]>(`/v1/warehouses/${warehouseId}/alegra/bodegas`),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (bodega: AlegraBodega | null) =>
      api.put<{ bodega: AlegraBodega | null }>(`/v1/warehouses/${warehouseId}/alegra/bodega`, {
        bodega,
      }),
    onSuccess: (res) => {
      toast.success(
        res.bodega
          ? `Se factura desde ${res.bodega.name}`
          : 'Vuelve a facturar desde la bodega predeterminada',
      );
      qc.setQueryData(['alegra-bodega', warehouseId], res);
      setOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <WarehouseIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Bodega de Alegra</h3>
              {current ? (
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  {current.name}
                </Badge>
              ) : (
                <Badge variant="outline">Predeterminada</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              De qué bodega se descuenta lo que factura esta sede. Si la empresa de Alegra la
              comparten varias sedes, cada una debe tener la suya: si no, Alegra busca el producto
              en la bodega predeterminada y{' '}
              <span className="font-medium text-foreground">
                rechaza la factura o descuenta el inventario de otra sede
              </span>
              .
            </p>
          </div>
        </div>

        {canManage && !open ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {current ? 'Cambiar' : 'Elegir bodega'}
            </Button>
            {current ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save.mutate(null)}
                loading={save.isPending}
                className="text-muted-foreground hover:text-destructive"
              >
                Quitar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {listError ? (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {listError instanceof ApiError
                ? listError.message
                : 'No se pudieron traer las bodegas de Alegra.'}
            </p>
          ) : isFetching && options.length === 0 ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              La empresa de Alegra de esta sede no tiene bodegas activas.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {options.map((b) => {
                const selected = b.id === current?.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => save.mutate({ id: b.id, name: b.name })}
                      disabled={save.isPending}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                        selected
                          ? 'border-accent ring-1 ring-accent'
                          : 'border-border hover:border-accent/40',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                      {b.isDefault ? (
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">
                          Predeterminada
                        </span>
                      ) : null}
                      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
