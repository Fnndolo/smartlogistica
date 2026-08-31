'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Search, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraContact, AlegraFixedClient } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import { isAdmin } from '@/lib/rbac';
import { cn } from '@/lib/utils';

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted';

/**
 * FACTURAR SIEMPRE AL MISMO CLIENTE (ajuste por sede).
 *
 * Los pedidos siguen llegando con su comprador; lo unico que cambia es a nombre
 * de quien se emite la factura EN ALEGRA. El documento que se le manda al
 * comprador por el chat sigue llevando SU nombre — de eso se encarga la
 * plantilla del Certificado, y por eso aqui se avisa de que hace falta.
 */
export function AlegraFixedClientCard({ warehouseId }: { warehouseId: string }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = isAdmin(user?.role);

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce: el catalogo de contactos de Alegra puede tener miles y cada tecla
  // seria una llamada a su API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data } = useQuery({
    queryKey: ['alegra-fixed-client', warehouseId],
    queryFn: () =>
      api.get<{ client: AlegraFixedClient | null }>(
        `/v1/warehouses/${warehouseId}/alegra/fixed-client`,
      ),
  });
  const current = data?.client ?? null;

  const {
    data: results = [],
    isFetching,
    error: searchError,
  } = useQuery({
    queryKey: ['alegra-contacts', warehouseId, debounced],
    queryFn: () =>
      api.get<AlegraContact[]>(
        `/v1/warehouses/${warehouseId}/alegra/contacts?q=${encodeURIComponent(debounced)}`,
      ),
    enabled: open && debounced.length >= 2,
    retry: false,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (client: AlegraFixedClient | null) =>
      api.put<{ client: AlegraFixedClient | null }>(
        `/v1/warehouses/${warehouseId}/alegra/fixed-client`,
        { client },
      ),
    onSuccess: (res) => {
      toast.success(
        res.client ? `Se facturará a ${res.client.name}` : 'Vuelve a facturar a cada cliente',
      );
      qc.setQueryData(['alegra-fixed-client', warehouseId], res);
      // El panel de facturar avisa a nombre de quien sale la factura.
      qc.invalidateQueries({ queryKey: ['invoice-preview'] });
      setOpen(false);
      setTerm('');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <UserCog className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Facturar siempre al mismo cliente</h3>
              {current ? (
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  Activo
                </Badge>
              ) : (
                <Badge variant="outline">Desactivado</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Todas las facturas de esta sede se emiten en Alegra a este contacto. Los pedidos
              siguen llegando con su cliente real y{' '}
              <span className="font-medium text-foreground">
                el documento que se envía al chat lleva el nombre del comprador
              </span>
              , no el de este contacto.
            </p>
            {current ? (
              <p className="mt-1.5 truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{current.name}</span>
                {current.identification ? (
                  <>
                    <span className="px-1.5 text-border">·</span>
                    {current.identification}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>

        {canManage && !open ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {current ? 'Cambiar' : 'Elegir cliente'}
            </Button>
            {current ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save.mutate(null)}
                loading={save.isPending}
                className="text-muted-foreground hover:text-destructive"
              >
                Quitar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {/* El nombre del comprador tiene que poder pintarse ENCIMA del PDF de
              Alegra, y eso lo hace la plantilla del Certificado. Sin ella, con
              cliente fijo no se adjunta nada (mejor eso que filtrar el nombre). */}
          <p className="rounded-lg bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
            Antes de activarlo, la sede necesita la <b>plantilla del Certificado</b> con una caja
            sobre el nombre del cliente y el texto <b>{'{cliente}'}</b> encima. Sin eso no se
            adjunta ningún documento al chat.
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Busca por nombre o NIT/cédula en Alegra…"
              className="pl-9"
            />
          </div>

          {searchError ? (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {searchError instanceof ApiError
                ? searchError.message
                : 'No se pudieron traer los contactos de Alegra.'}
            </p>
          ) : debounced.length < 2 ? (
            <p className="text-xs text-muted-foreground">Escribe al menos 2 caracteres.</p>
          ) : isFetching ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              Ningún contacto de Alegra coincide con lo que buscas.
            </p>
          ) : (
            <ul className="max-h-[260px] space-y-1.5 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => save.mutate(c)}
                    disabled={save.isPending}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                      c.id === current?.id
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-border hover:border-accent/40',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      {c.identification ? (
                        <span className="block truncate font-mono text-[11.5px] text-muted-foreground">
                          {c.identification}
                        </span>
                      ) : null}
                    </span>
                    {c.id === current?.id ? (
                      <Check className="h-4 w-4 shrink-0 text-accent" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTerm('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
