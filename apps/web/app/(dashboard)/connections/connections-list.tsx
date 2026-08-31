'use client';

import { useQuery } from '@tanstack/react-query';
import { formatRelative } from 'date-fns/formatRelative';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, ArrowRight, Link2, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { VtexConnectionSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

import { BTN_GHOST, BTN_PRIMARY, CONN_CARD, Pill, Tile } from './connection-ui';
import { SyncButton } from './sync-button';

/**
 * Lista de marketplaces conectados, en vivo.
 *
 * `initial` viene del servidor para pintar de una; si el servidor NO pudo
 * preguntarle al API llega `undefined` (que no es lo mismo que "no hay
 * conexiones") y entonces esta query lo resuelve en el cliente, con reintentos.
 * Asi la pagina nunca dice "no tienes conexiones" cuando lo que pasa es que el
 * API no respondio (p.ej. mientras reinicia en desarrollo).
 */
export function ConnectionsList({ initial }: { initial?: VtexConnectionSummary[] }) {
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get<VtexConnectionSummary[]>('/v1/connections'),
    initialData: initial,
    staleTime: 15_000,
  });

  if (isPending) {
    return (
      <div className="flex items-center justify-center rounded-[14px] border border-border bg-card py-12">
        <Loader2 className="h-4 w-4 animate-spin text-hint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" />
        </div>
        <h3 className="mt-3 text-[13.5px] font-extrabold">No se pudieron cargar tus conexiones</h3>
        <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          {error instanceof ApiError ? error.message : 'El servidor no respondió.'} Tus conexiones
          siguen guardadas: esto es un problema para consultarlas, no una desconexión.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className={`${BTN_GHOST} mt-4`}
          onClick={() => void refetch()}
          loading={isFetching}
        >
          <RefreshCw />
          Reintentar
        </Button>
      </div>
    );
  }

  if (data.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-[10px]">
      {data.map((c) => (
        <ConnectionRow key={c.id} connection={c} />
      ))}
    </div>
  );
}

function ConnectionRow({ connection }: { connection: VtexConnectionSummary }) {
  return (
    <div className={`${CONN_CARD} flex flex-wrap items-start gap-[13px]`}>
      <Tile tone="cobalt">
        <Link2 className="h-[18px] w-[18px]" />
      </Tile>

      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 break-words text-[13.5px] font-extrabold">
            {connection.accountName}
          </b>
          <Pill tone="muted">{connection.provider.toUpperCase()}</Pill>
          <StatusPill status={connection.status} />
        </div>
        <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
          {connection.lastSyncedAt
            ? `Última sincronización ${formatRelative(new Date(connection.lastSyncedAt), new Date(), { locale: es })}`
            : 'Sin sincronizaciones aún'}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-[7px]">
        <SyncButton connectionId={connection.id} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: VtexConnectionSummary['status'] }) {
  if (status === 'connected')
    return (
      <Pill tone="ok" dot>
        Activa
      </Pill>
    );
  if (status === 'error')
    return (
      <Pill tone="bad" dot>
        Error
      </Pill>
    );
  return (
    <Pill tone="muted" dot>
      Deshabilitada
    </Pill>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[14px] border border-dashed border-input bg-card p-12 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-accent">
        <Link2 className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-[15px] font-extrabold tracking-[-0.01em]">
        Aún no tienes marketplaces conectados
      </h3>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">
        Conecta VTEX/Addi con tus credenciales y empieza a centralizar pedidos. Tu información se
        cifra antes de almacenarse.
      </p>
      <Button asChild className={`${BTN_PRIMARY} mt-5`}>
        <Link href="/connections/vtex/new">
          Conectar VTEX
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
