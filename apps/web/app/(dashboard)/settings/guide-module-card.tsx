'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  GUIDE_CHANNEL_LABEL,
  guidesEnabledFor,
  type AddiLbaConnectionSummary,
  type GuideModule,
  type MarketplaceProvider,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { useGuideModuleSetting } from '../orders/use-guide-module';
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

/** Que pasa en cada canal con las guias APAGADAS (la confirmacion lo repite). */
const OFF_EFFECT: Record<MarketplaceProvider, string> = {
  vtex: 'al facturar en Alegra, el pedido queda facturado también en VTEX, sin guía, y el MKT llega a la conversación.',
  manual: 'con la factura el pedido queda completo, sin guía (y sin recaudo contraentrega).',
};

const CHANNELS = Object.keys(GUIDE_CHANNEL_LABEL) as MarketplaceProvider[];

/**
 * Guias POR CANAL. Apagar un canal pide confirmacion: en VTEX, desde ese
 * momento facturar tambien factura alla, que es irreversible. Encender no la
 * pide (vuelve todo a como era). Un pedido que ya tiene envio conserva su
 * pestaña y su rastreo en cualquier caso.
 */
export function GuideModuleCard() {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState<MarketplaceProvider | null>(null);

  // Misma clave que el drawer: al guardar, la pestaña Guia de esta pestaña del
  // navegador cambia sin esperar el evento.
  const { data, isError, refetch } = useGuideModuleSetting();
  // Con las guias de Addi conectadas, el interruptor de VTEX es TAMBIEN el suyo
  // (apagadas = las pone Addi; encendidas = Addi en pausa). Misma clave que la
  // tarjeta de Addi: una sola consulta.
  const { data: addi } = useQuery({
    queryKey: ['addi-lba-connection'],
    queryFn: () => api.get<AddiLbaConnectionSummary | null>('/v1/addi-lba/connection'),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (next: GuideModule) => api.put<GuideModule>('/v1/guide-module', next),
    onSuccess: (saved, next) => {
      qc.setQueryData(['guide-module'], saved);
      setConfirmOff(null);
      const changed = CHANNELS.find(
        (c) => guidesEnabledFor(saved, c) !== (data ? guidesEnabledFor(data, c) : true),
      );
      if (changed) {
        toast.success(
          `${GUIDE_CHANNEL_LABEL[changed]}: guías ${guidesEnabledFor(next, changed) ? 'encendidas' : 'apagadas'}`,
        );
      }
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar el módulo de guías'),
  });

  const setChannel = (channel: MarketplaceProvider, on: boolean) => {
    if (!data) return;
    const disabled = new Set(data.disabledFor);
    if (on) disabled.delete(channel);
    else disabled.add(channel);
    save.mutate({ disabledFor: [...disabled] });
  };

  return (
    <div className={CARD_CLS}>
      <CardHead
        icon={<Truck />}
        tone="cobalt"
        title="Módulo de guías"
        description="Elige en qué pedidos se generan guías. Donde lo apagues, desaparecen la pestaña Guía y «Hacer todo», y el pedido se cierra al facturar. Los pedidos que ya tienen guía conservan su pestaña y su rastreo."
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
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-[12px] border border-border">
          {CHANNELS.map((channel) => {
            const on = guidesEnabledFor(data, channel);
            const label = GUIDE_CHANNEL_LABEL[channel];
            return (
              <li key={channel} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold">{label}</span>
                      {on ? (
                        <Pill tone="ok" dot>
                          Con guías
                        </Pill>
                      ) : (
                        <Pill tone="warn" dot>
                          Sin guías
                        </Pill>
                      )}
                    </div>
                    {!on ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Apagado: {OFF_EFFECT[channel]}
                        {channel === 'vtex' && addi ? ' Las guías las pone Addi (Guías de Addi).' : ''}
                      </p>
                    ) : channel === 'vtex' && addi ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Cada sede genera su guía; las guías de Addi quedan en pausa (los pedidos que
                        ya traen una salen con ella).
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Guías para ${label}`}
                    disabled={save.isPending}
                    onClick={() => (on ? setConfirmOff(channel) : setChannel(channel, true))}
                    className={cn(
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none disabled:opacity-60',
                      on ? 'border-transparent bg-accent' : 'border-border bg-muted',
                      FOCUS_RING,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
                        on ? 'translate-x-[22px]' : 'translate-x-[2px]',
                      )}
                    />
                  </button>
                </div>

                {confirmOff === channel ? (
                  <div className="mt-3 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
                    <p className="text-[12.5px] leading-[1.45] text-amber-700 dark:text-amber-400">
                      <b>¿Apagar las guías para {label}?</b> Desde ya, {OFF_EFFECT[channel]}
                      {channel === 'vtex' ? ' Eso no se puede deshacer en VTEX.' : ''}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => setChannel(channel, false)}
                        loading={save.isPending}
                        className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
                      >
                        Sí, apagar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmOff(null)}
                        disabled={save.isPending}
                        className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
