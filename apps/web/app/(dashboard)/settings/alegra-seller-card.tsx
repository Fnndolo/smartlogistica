'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraSeller, WarehouseSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  FOCUS_RING,
  Pill,
  SET_CARD_CLS,
  SET_ROW_CLS,
  SettingsRowBody,
} from './settings-ui';

/**
 * TU vendedor de Alegra, sede por sede.
 *
 * Vive en "Tu cuenta" y NO en los Ajustes de la sede, que son de
 * administradores: esto no es configuracion del negocio sino una preferencia
 * PERSONAL (la fila es unica por sede+usuario), y quien mas la necesita es
 * justo quien no entra ahi — el GESTOR factura en todas las sedes. El API
 * siempre lo permitio (`assertWarehouseAccess`, no `isAdmin`); el candado
 * estaba solo en la pagina que la alojaba.
 *
 * Cada sede tiene su PROPIA cuenta de Alegra, asi que los vendedores y sus id
 * no se comparten entre sedes: por eso es una fila por sede y no un solo
 * selector.
 */
export function AlegraSellerCard({ warehouses }: { warehouses: WarehouseSummary[] }) {
  const [open, setOpen] = useState(false);

  if (warehouses.length === 0) return null;

  return (
    <div className={SET_CARD_CLS}>
      {/* Misma fila desplegable que "Clave de acceso". */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(SET_ROW_CLS, 'focus-visible:ring-offset-card')}
      >
        <SettingsRowBody
          icon={<UserRound />}
          title="Tu vendedor en Alegra"
          description={
            warehouses.length === 1
              ? 'El nombre con el que salen las facturas que tú generas.'
              : 'El nombre con el que salen las facturas que tú generas, en cada sede.'
          }
          expanded={open}
        />
      </button>

      {/* Las consultas cuelgan de `open`: cada sede pregunta sus vendedores a
          Alegra en vivo, y eso no se paga al pintar Ajustes sino al abrir. */}
      {open ? (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-[13px]">
          {warehouses.map((w) => (
            <SedeSellerRow key={w.id} warehouse={w} enabled={open} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SedeSellerRow({
  warehouse,
  enabled,
}: {
  warehouse: WarehouseSummary;
  enabled: boolean;
}) {
  const qc = useQueryClient();
  /** null = sin tocar (manda lo guardado); '' = eligio "sin vendedor". */
  const [selected, setSelected] = useState<string | null>(null);

  const pref = useQuery({
    queryKey: ['alegra-seller-pref', warehouse.id],
    queryFn: () =>
      api.get<{ seller: AlegraSeller | null }>(`/v1/warehouses/${warehouse.id}/alegra/seller`),
    enabled,
  });

  const sellers = useQuery({
    queryKey: ['alegra-sellers', warehouse.id],
    queryFn: () => api.get<AlegraSeller[]>(`/v1/warehouses/${warehouse.id}/alegra/sellers`),
    enabled,
    staleTime: 5 * 60_000,
    // Sin reintentos: una sede sin Alegra conectado falla SIEMPRE, y reintentar
    // solo retrasa el aviso que explica por que no hay lista.
    retry: false,
  });

  const save = useMutation({
    mutationFn: (seller: AlegraSeller | null) =>
      api.put<{ seller: AlegraSeller | null }>(`/v1/warehouses/${warehouse.id}/alegra/seller`, {
        seller,
      }),
    onSuccess: (res) => {
      toast.success(
        res.seller
          ? `${warehouse.name}: facturas a nombre de ${res.seller.name}`
          : `${warehouse.name}: facturarás sin vendedor`,
      );
      setSelected(null);
      qc.setQueryData(['alegra-seller-pref', warehouse.id], res);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar el vendedor'),
  });

  const current = pref.data?.seller ?? null;
  const value = selected ?? current?.id ?? '';
  const dirty = selected !== null && selected !== (current?.id ?? '');
  const loading = pref.isLoading || sellers.isLoading;

  return (
    <div className="rounded-[11px] border border-border bg-surface px-3 py-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-extrabold">{warehouse.name}</span>
        {warehouse.invoicePrefix ? (
          <Pill tone="muted">{warehouse.invoicePrefix}</Pill>
        ) : null}
        {!loading && !sellers.isError && current ? (
          <Pill tone="cobalt">{current.name}</Pill>
        ) : null}
        {!loading && !sellers.isError && !current ? <Pill tone="muted">Sin vendedor</Pill> : null}
      </div>

      {sellers.isError ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          No se pudieron traer los vendedores
          {sellers.error instanceof ApiError ? ` (${sellers.error.message})` : ''}. Esta sede
          necesita Alegra conectado — eso lo hace un administrador.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label={`Tu vendedor en ${warehouse.name}`}
            value={value}
            disabled={loading}
            onChange={(e) => setSelected(e.target.value)}
            className={cn(
              'h-9 w-full min-w-0 rounded-[10px] border border-input bg-card px-2.5 text-[13px] font-semibold disabled:opacity-60 sm:w-auto sm:min-w-[15rem]',
              FOCUS_RING,
            )}
          >
            <option value="">— Sin vendedor —</option>
            {(sellers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => {
              const seller = (sellers.data ?? []).find((s) => s.id === selected) ?? null;
              save.mutate(selected ? seller : null);
            }}
          >
            <Check />
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
