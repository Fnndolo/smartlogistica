'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRelative } from 'date-fns/formatRelative';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, ArrowRight, Link2, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { VtexConnectionSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { BTN_GHOST, BTN_PRIMARY, BTN_SM, CONN_CARD, Pill, Tile } from './connection-ui';
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
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(connection.label);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['connections'] });
    // Las pestañas de pedidos se llaman igual que la tienda.
    qc.invalidateQueries({ queryKey: ['order-accounts'] });
  };

  const rename = useMutation({
    mutationFn: () =>
      api.patch<VtexConnectionSummary>(`/v1/connections/${connection.id}`, { label: name.trim() }),
    onSuccess: () => {
      toast.success('Tienda renombrada');
      setRenaming(false);
      done();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo renombrar'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/connections/${connection.id}`),
    onSuccess: () => {
      toast.success('Conexión eliminada');
      done();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar'),
  });

  return (
    <div className={`${CONN_CARD} flex flex-wrap items-start gap-[13px]`}>
      <Tile tone="cobalt">
        <Link2 className="h-[18px] w-[18px]" />
      </Tile>

      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 break-words text-[13.5px] font-extrabold">{connection.label}</b>
          <Pill tone="muted">{connection.provider.toUpperCase()}</Pill>
          <StatusPill status={connection.status} />
        </div>
        {/* La CUENTA es lo que ata los pedidos a su tienda y no cambia nunca;
            el nombre de arriba si. Por eso se muestran las dos. */}
        <p className="mt-[3px] font-mono text-[11.5px] text-hint">{connection.accountName}</p>
        <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
          {connection.lastSyncedAt
            ? `Última sincronización ${formatRelative(new Date(connection.lastSyncedAt), new Date(), { locale: es })}`
            : 'Sin sincronizaciones aún'}
        </p>

        {renaming ? (
          <div className="mt-2.5 flex max-w-[380px] flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim().length >= 2) rename.mutate();
                if (e.key === 'Escape') {
                  setName(connection.label);
                  setRenaming(false);
                }
              }}
              aria-label="Nombre de la tienda"
              className="h-auto min-h-[34px] min-w-[160px] flex-1 rounded-[9px] border-input bg-card text-[13px] shadow-none"
            />
            <Button
              onClick={() => rename.mutate()}
              loading={rename.isPending}
              disabled={name.trim().length < 2 || rename.isPending}
              className={cn(BTN_PRIMARY, BTN_SM)}
            >
              Guardar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setName(connection.label);
                setRenaming(false);
              }}
              className={cn(BTN_GHOST, BTN_SM)}
            >
              Cancelar
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-[7px]">
        <SyncButton connectionId={connection.id} />
        {renaming ? null : (
          <Button
            variant="ghost"
            onClick={() => setRenaming(true)}
            className={cn(BTN_GHOST, BTN_SM)}
          >
            <Pencil />
            Renombrar
          </Button>
        )}
        {/* Eliminar en dos pasos: se lleva las credenciales y desregistra el
            webhook en VTEX. Los pedidos ya ingeridos NO se borran. */}
        <Button
          variant="ghost"
          onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}
          loading={remove.isPending}
          className={cn(
            BTN_GHOST,
            BTN_SM,
            confirmDelete && 'border-destructive text-destructive hover:text-destructive',
          )}
        >
          <Trash2 />
          {confirmDelete ? '¿Seguro? Sí, eliminar' : 'Eliminar'}
        </Button>
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
