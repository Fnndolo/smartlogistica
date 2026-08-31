'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent } from 'lucide-react';
import { toast } from 'sonner';
import { vtexNetValue, type VtexFees } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { BTN_PRIMARY_CLS, BTN_SM_CLS, CARD_CLS, CardHead, EMPTY_CLS, FOCUS_RING } from './settings-ui';

interface Form {
  commissionPct: string;
  vatPct: string;
  fixed: string;
}

const toForm = (f: VtexFees): Form => ({
  commissionPct: String(f.commissionPct),
  vatPct: String(f.vatPct),
  fixed: String(f.fixed),
});

/**
 * Descuentos del NETO VTEX (el precio entre parentesis al hacer clic en la
 * tabla): comision % + IVA % sobre la comision + valor fijo por pedido.
 * GLOBAL y solo visual — no toca facturas ni guias.
 */
export function VtexFeesCard({ initial }: { initial: VtexFees | null }) {
  const qc = useQueryClient();
  // null = el SSR fallo: se recarga por el cliente y el guardado queda
  // bloqueado hasta tener los valores REALES (no pisar con defaults).
  const [form, setForm] = useState<Form | null>(initial ? toForm(initial) : null);
  const [dirty, setDirty] = useState(false);

  const fallback = useQuery({
    queryKey: ['vtex-fees'],
    queryFn: () => api.get<VtexFees>('/v1/vtex-fees'),
    enabled: form === null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (form === null && fallback.data) setForm(toForm(fallback.data));
  }, [form, fallback.data]);

  const patch = (p: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setDirty(true);
  };

  const parsed: VtexFees | null =
    form &&
    form.commissionPct !== '' &&
    form.vatPct !== '' &&
    form.fixed !== '' &&
    Number(form.commissionPct) >= 0 &&
    Number(form.commissionPct) <= 100 &&
    Number(form.vatPct) >= 0 &&
    Number(form.vatPct) <= 100 &&
    Number(form.fixed) >= 0
      ? {
          commissionPct: Number(form.commissionPct),
          vatPct: Number(form.vatPct),
          fixed: Number(form.fixed),
        }
      : null;

  const save = useMutation({
    mutationFn: () => api.put<VtexFees>('/v1/vtex-fees', parsed!),
    onSuccess: (saved) => {
      setForm(toForm(saved));
      setDirty(false);
      toast.success('Descuentos del neto guardados');
      // La tabla recalcula el neto con los valores nuevos.
      qc.invalidateQueries({ queryKey: ['vtex-fees'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar los descuentos'),
  });

  // Ejemplo en vivo con un precio tipico, para VER el efecto antes de guardar.
  const EXAMPLE = 1_000_000;

  return (
    <div className={CARD_CLS}>
      <CardHead
        icon={<Percent />}
        title="Neto VTEX (clic en el precio)"
        description="Al hacer clic en el precio de un pedido VTEX, la tabla muestra entre paréntesis lo que realmente queda: precio − comisión − IVA sobre esa comisión − valor fijo. Solo visual."
      />

      {form === null ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>
          {fallback.isError ? (
            <>
              No se pudo cargar la configuración.{' '}
              <button
                type="button"
                onClick={() => fallback.refetch()}
                className={cn(
                  'rounded font-bold text-accent-ink underline underline-offset-2',
                  FOCUS_RING,
                )}
              >
                Reintentar
              </button>
            </>
          ) : (
            'Cargando...'
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Comisión (%)</Label>
              <Input
                inputMode="decimal"
                value={form.commissionPct}
                onChange={(e) => patch({ commissionPct: e.target.value.replace(/[^\d.]/g, '') })}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>IVA sobre la comisión (%)</Label>
              <Input
                inputMode="decimal"
                value={form.vatPct}
                onChange={(e) => patch({ vatPct: e.target.value.replace(/[^\d.]/g, '') })}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor fijo por pedido (COP)</Label>
              <Input
                inputMode="numeric"
                value={form.fixed}
                onChange={(e) => patch({ fixed: e.target.value.replace(/[^\d.]/g, '') })}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-[11px] tabular-nums text-hint">
              {parsed
                ? `Ejemplo: un pedido de ${cop(EXAMPLE)} quedaría en ${cop(vtexNetValue(EXAMPLE, parsed))}.`
                : 'Revisa los valores: porcentajes entre 0 y 100.'}
            </p>
            <Button
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
              onClick={() => save.mutate()}
              disabled={!dirty || !parsed}
              loading={save.isPending}
            >
              Guardar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function cop(value: number): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toLocaleString('es-CO')}`;
  }
}
