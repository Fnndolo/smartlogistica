'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraSeller } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

/**
 * Vendedor de Alegra del USUARIO actual en esta sede. Cada quien elige su
 * nombre (los nombres se traen en vivo del catalogo /sellers de la cuenta
 * Alegra de la sede) y las facturas que ese usuario emita salen con ese
 * vendedor. Es una preferencia POR USUARIO: cada miembro ve y guarda la suya.
 */
export function AlegraSellerCard({ warehouseId }: { warehouseId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null); // null = sin tocar

  const pref = useQuery({
    queryKey: ['alegra-seller-pref', warehouseId],
    queryFn: () => api.get<{ seller: AlegraSeller | null }>(`/v1/warehouses/${warehouseId}/alegra/seller`),
  });

  const sellers = useQuery({
    queryKey: ['alegra-sellers', warehouseId],
    queryFn: () => api.get<AlegraSeller[]>(`/v1/warehouses/${warehouseId}/alegra/sellers`),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (seller: AlegraSeller | null) =>
      api.put<{ seller: AlegraSeller | null }>(`/v1/warehouses/${warehouseId}/alegra/seller`, {
        seller,
      }),
    onSuccess: (res) => {
      toast.success(res.seller ? `Vendedor: ${res.seller.name}` : 'Facturarás sin vendedor');
      setSelected(null);
      qc.setQueryData(['alegra-seller-pref', warehouseId], res);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar el vendedor'),
  });

  const current = pref.data?.seller ?? null;
  const value = selected ?? current?.id ?? '';
  const dirty = selected !== null && selected !== (current?.id ?? '');

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <UserRound className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Tu vendedor en Alegra</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Elige tu nombre (viene de los vendedores guardados en Alegra). Las facturas que
            <span className="font-medium"> tú</span> generes en esta sede saldrán con ese vendedor.
            Cada usuario configura el suyo.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sellers.isError ? (
              <p className="text-sm text-muted-foreground">
                No se pudieron traer los vendedores{' '}
                {sellers.error instanceof ApiError ? `(${sellers.error.message})` : ''} — ¿la sede
                tiene Alegra conectado?
              </p>
            ) : (
              <>
                <select
                  value={value}
                  disabled={sellers.isLoading || pref.isLoading}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Sin vendedor —</option>
                  {(sellers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!dirty}
                  loading={save.isPending}
                  onClick={() => {
                    const seller = (sellers.data ?? []).find((s) => s.id === selected) ?? null;
                    save.mutate(selected ? seller : null);
                  }}
                >
                  Guardar
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
