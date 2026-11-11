'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw, Tags } from 'lucide-react';
import { toast } from 'sonner';
import {
  ADDI_PACKAGE_STATUS_LABEL,
  type AddiGuideInfo,
  type OrderSummary,
} from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** Tono de la pastilla segun el estado del paquete en Addi. */
const STATUS_TONE: Record<string, 'cobalt' | 'warn' | 'ok'> = {
  PENDING_RECOLLECTION: 'cobalt',
  TRANSPORT: 'cobalt',
  TRANSPORT_WITH_NOVELTY: 'warn',
  DELIVERED: 'ok',
};

const deadlineFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });

/**
 * GUIA DE ADDI del pedido (Detalle): el numero que Addi genero en Coordinadora
 * (sale del portal de aliados por el MKT), su estado y QUE remitente lleva.
 * Al pasar el pedido a una sede, la plataforma cambia ese remitente al de la
 * sede y deja el rotulo en la conversacion; aqui se ve como va y, si hace
 * falta, se pide a mano.
 */
export function AddiGuideSection({ order }: { order: OrderSummary }) {
  const qc = useQueryClient();
  const key = ['addi-guide', order.id] as const;
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<AddiGuideInfo>(`/v1/orders/${order.id}/addi-guide`),
    staleTime: 15_000,
    // Mientras se aplica el cambio, el panel se mantiene al dia solo.
    refetchInterval: (q) => (q.state.data?.sender.state === 'pending' ? 10_000 : false),
  });

  const apply = useMutation({
    mutationFn: () => api.post<AddiGuideInfo>(`/v1/orders/${order.id}/addi-guide/sender`, {}),
    onSuccess: (info) => {
      qc.setQueryData(key, info);
      void qc.invalidateQueries({ queryKey: ['order-messages', order.id] });
      toast.success('Remitente cambiado. El rótulo quedó en la conversación.');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar el remitente');
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  // Sin conexion ni guia no hay nada que mostrar (pedidos viejos / sin Addi).
  if (!data || (!data.connected && !data.guide)) return null;

  const status = data.packageStatus;
  const tone = status ? (STATUS_TONE[status] ?? 'cobalt') : null;
  const s = data.sender;

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-wash text-accent">
          <Tags className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">
          Guía de Addi
        </h3>
        <span className="ml-auto min-w-0 break-words text-right text-xs text-hint">
          {data.syncedAt ? `portal de Addi · ${ago(data.syncedAt)}` : 'portal de Addi'}
        </span>
      </div>

      <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
        <dl className="grid grid-cols-1 text-[13.5px] [&>dd:last-of-type]:pb-0 [&>dd]:pb-2.5 min-[400px]:grid-cols-[110px_minmax(0,1fr)] min-[400px]:gap-y-[9px] min-[400px]:[&>dd]:pb-0 md:grid-cols-[130px_minmax(0,1fr)]">
          <dt className="min-w-0 self-start break-words font-semibold text-hint">Guía</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
            {data.guide ? (
              <>
                <span className="font-mono tracking-[0.02em]">{data.guide}</span>
                <button
                  type="button"
                  aria-label="Copiar número de guía"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(data.guide!)
                      .then(() => toast.success('Guía copiada'))
                      .catch(() => null);
                  }}
                  className="grid h-6 w-6 place-items-center rounded-md text-hint transition-colors hover:bg-wash hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a
                  href={`https://coordinadora.com/rastreo/rastreo-de-guia/?guia=${encodeURIComponent(data.guide)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-accent-ink underline-offset-2 hover:underline"
                >
                  Rastrear
                  <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : (
              <span className="font-normal text-muted-foreground">
                Addi todavía no la ha generado
              </span>
            )}
          </dd>

          {status ? (
            <>
              <dt className="min-w-0 self-start break-words font-semibold text-hint">Estado</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-bold tracking-[0.01em]',
                    tone === 'cobalt' && 'bg-wash text-accent-ink',
                    tone === 'warn' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    tone === 'ok' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {tone === 'cobalt' ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                  ) : null}
                  {ADDI_PACKAGE_STATUS_LABEL[status] ?? status}
                </span>
                {data.carrier ? (
                  <span className="text-[12px] font-normal capitalize text-muted-foreground">
                    {data.carrier}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          {data.dispatchDeadline && status === 'PENDING_RECOLLECTION' ? (
            <>
              <dt className="min-w-0 self-start break-words font-semibold text-hint">
                Despachar antes
              </dt>
              <dd className="min-w-0 break-words font-semibold first-letter:uppercase">
                {deadlineFmt.format(new Date(data.dispatchDeadline))}
              </dd>
            </>
          ) : null}

          <dt className="min-w-0 self-start break-words font-semibold text-hint">Remitente</dt>
          <dd className="min-w-0 break-words font-semibold">
            <SenderLine info={data} />
          </dd>
        </dl>

        {data.canApply ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-dashed border-input pt-3">
            <button
              type="button"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-all [transition-duration:130ms] disabled:opacity-60',
                s.state === 'applied'
                  ? 'border border-border bg-card text-foreground hover:border-accent hover:text-accent-ink'
                  : 'bg-accent text-accent-foreground hover:-translate-y-px hover:brightness-110',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              )}
            >
              {apply.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {apply.isPending
                ? 'Editando la guía en Coordinadora…'
                : s.state === 'applied'
                  ? 'Volver a aplicar y reenviar rótulo'
                  : s.state === 'pending'
                    ? 'Intentar ahora'
                    : 'Poner el remitente de esta sede'}
            </button>
            <span className="text-[11.5px] text-hint">
              Edita la guía en la suite de Coordinadora y deja el rótulo en la conversación.
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SenderLine({ info }: { info: AddiGuideInfo }) {
  const s = info.sender;
  if (s.state === 'pending') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
        <span>Cambiando al de esta sede…</span>
        {s.error ? <span className="font-normal text-muted-foreground">{s.error}</span> : null}
      </span>
    );
  }
  if (s.state === 'applied') {
    return (
      <span className="flex flex-col gap-1">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {s.warehouseName ?? 'Esta sede'}
          {s.at ? <span className="font-normal text-muted-foreground">· {ago(s.at)}</span> : null}
        </span>
        {s.error ? (
          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-400">
            {s.error}
          </span>
        ) : null}
      </span>
    );
  }
  if (s.state === 'error') {
    return (
      <span className="inline-flex items-start gap-1.5 text-destructive">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-normal">{s.error}</span>
      </span>
    );
  }
  return (
    <span className="font-normal text-muted-foreground">
      {s.warehouseName
        ? `Lleva el de ${s.warehouseName} (otra sede)`
        : 'El que puso Addi (sin cambiar)'}
    </span>
  );
}
