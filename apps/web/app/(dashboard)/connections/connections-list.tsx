'use client';

import { useQuery } from '@tanstack/react-query';
import { formatRelative } from 'date-fns/formatRelative';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, ArrowRight, Link2, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { VtexConnectionSummary } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

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
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-12">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="mt-3 text-sm font-semibold">No se pudieron cargar tus conexiones</h2>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          {error instanceof ApiError ? error.message : 'El servidor no respondio.'} Tus conexiones
          siguen guardadas: esto es un problema para consultarlas, no una desconexion.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()} loading={isFetching}>
          <RefreshCw className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </div>
    );
  }

  if (data.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-3">
      {data.map((c) => (
        <ConnectionRow key={c.id} connection={c} />
      ))}
    </div>
  );
}

function ConnectionRow({ connection }: { connection: VtexConnectionSummary }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
          <Link2 className="h-4 w-4 text-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{connection.accountName}</p>
            <Badge variant="outline">{connection.provider.toUpperCase()}</Badge>
            <StatusBadge status={connection.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connection.lastSyncedAt
              ? `Ultima sincronizacion ${formatRelative(new Date(connection.lastSyncedAt), new Date(), { locale: es })}`
              : 'Sin sincronizaciones aun'}
          </p>
        </div>
      </div>
      <SyncButton connectionId={connection.id} />
    </div>
  );
}

function StatusBadge({ status }: { status: VtexConnectionSummary['status'] }) {
  if (status === 'connected') return <Badge variant="success">Activa</Badge>;
  if (status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Deshabilitada</Badge>;
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Link2 className="h-5 w-5 text-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">Aun no tienes marketplaces conectados</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Conecta VTEX/Addi con tus credenciales y empieza a centralizar pedidos. Tu informacion se cifra
        antes de almacenarse.
      </p>
      <Button asChild className="mt-5">
        <Link href="/connections/vtex/new">
          Conectar VTEX
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
