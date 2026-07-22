'use client';

import { useQuery } from '@tanstack/react-query';
import { MessageSquare, RefreshCw } from 'lucide-react';
import type { ConfirmationLogEntry } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const timeFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Registro de llamadas del webhook de confirmacion de direccion (Whapify).
 * Es la herramienta de diagnostico: cada vez que Whapify llama a la plataforma
 * queda una fila aqui, se haya aplicado o no. Si un cliente confirmo en
 * WhatsApp y NO hay fila, el flujo de Whapify no ejecuto la Solicitud de API
 * Externa (el problema esta alla, no aca).
 */
export function ConfirmationLogCard() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['confirmation-log'],
    queryFn: () => api.get<ConfirmationLogEntry[]>('/v1/webhooks/confirmation/log'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const rows = data ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Confirmaciones de WhatsApp</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cada llamada que Whapify hace a la plataforma queda registrada aquí. Si un cliente
              confirmó y no aparece, el flujo de Whapify no ejecutó la Solicitud de API Externa.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          aria-label="Actualizar registro"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Aún no se registran llamadas de Whapify.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                {timeFmt.format(new Date(r.createdAt))}
              </span>
              <span className="w-32 shrink-0 truncate font-medium tabular-nums" title={r.phone}>
                {r.phone}
              </span>
              <Badge variant={r.action === 'modified' ? 'warning' : 'success'}>
                {r.action === 'modified' ? 'Modificó' : 'Confirmó'}
              </Badge>
              {r.matched > 0 ? (
                <span className="text-xs text-muted-foreground">
                  Aplicada a {r.matched} pedido{r.matched === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="text-xs font-medium text-destructive" title={r.note ?? undefined}>
                  {r.note ?? 'No aplicada'}
                </span>
              )}
              {r.address ? (
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={r.address}
                >
                  {r.address}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
