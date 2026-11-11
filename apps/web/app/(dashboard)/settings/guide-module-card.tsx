'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { GuideModule } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  CardHead,
  EMPTY_CLS,
  FOCUS_RING,
  Pill,
} from './settings-ui';

/**
 * Encender/apagar el MODULO DE GUIAS (global). Apagarlo pide confirmacion:
 * desde ese momento facturar tambien factura en VTEX, que es irreversible.
 * Encenderlo no la pide (vuelve todo a como era).
 */
export function GuideModuleCard() {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);

  // Misma clave que el drawer: al guardar, la pestaña Guia de esta pestaña del
  // navegador cambia sin esperar el evento.
  const { data, isError, refetch } = useQuery({
    queryKey: ['guide-module'],
    queryFn: () => api.get<GuideModule>('/v1/guide-module'),
    staleTime: 5 * 60_000,
  });
  const enabled = data?.enabled;

  const save = useMutation({
    mutationFn: (next: boolean) => api.put<GuideModule>('/v1/guide-module', { enabled: next }),
    onSuccess: (saved) => {
      qc.setQueryData(['guide-module'], saved);
      setConfirmOff(false);
      toast.success(
        saved.enabled
          ? 'Guías encendidas: la pestaña Guía vuelve a los pedidos'
          : 'Guías apagadas: al facturar, el pedido se cierra en VTEX',
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar el módulo de guías'),
  });

  return (
    <div className={CARD_CLS}>
      <CardHead
        icon={<Truck />}
        tone="cobalt"
        title="Módulo de guías"
        badge={
          enabled === undefined ? null : enabled ? (
            <Pill tone="ok" dot>
              Encendido
            </Pill>
          ) : (
            <Pill tone="warn" dot>
              Apagado
            </Pill>
          )
        }
        description={
          <>
            <b className="text-foreground">Encendido:</b> la pestaña Guía genera el envío
            (Coordinadora, Skydropx o domicilio) y con él el pedido se factura en VTEX.{' '}
            <b className="text-foreground">Apagado:</b> no hay pestaña Guía ni «Hacer todo»; al
            facturar en Alegra el pedido queda facturado también en VTEX, sin guía, y el MKT llega a
            la conversación.
          </>
        }
        action={
          enabled === undefined ? null : (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Módulo de guías"
              disabled={save.isPending}
              onClick={() => (enabled ? setConfirmOff(true) : save.mutate(true))}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none disabled:opacity-60',
                enabled ? 'border-transparent bg-accent' : 'border-border bg-muted',
                FOCUS_RING,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
                  enabled ? 'translate-x-[22px]' : 'translate-x-[2px]',
                )}
              />
            </button>
          )
        }
      />

      {data === undefined ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>
          {isError ? (
            <>
              No se pudo cargar el ajuste.{' '}
              <button
                type="button"
                onClick={() => refetch()}
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
      ) : null}

      {confirmOff ? (
        <div className="mt-4 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-[12.5px] leading-[1.45] text-amber-700 dark:text-amber-400">
            <b>¿Apagar las guías?</b> Desde ya, cada pedido que se facture en Alegra se factura
            también en VTEX sin número de guía. Eso no se puede deshacer en VTEX.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => save.mutate(false)}
              loading={save.isPending}
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
            >
              Sí, apagar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmOff(false)}
              disabled={save.isPending}
              className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
