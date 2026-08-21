'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRelative } from 'date-fns/formatRelative';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, Check, Loader2, Pencil, Plug, Route, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SkydropxConnectionSummary, SkydropxMode } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const ICON_TILE =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400';

const MODE_LABEL: Record<SkydropxMode, string> = {
  sandbox: 'Sandbox',
  production: 'Producción',
};

/**
 * Conexion a Skydropx: agregador multi-transportadora (segunda opcion de guia;
 * la predeterminada sigue siendo Coordinadora). Las credenciales se validan
 * contra la API real al conectar, se guardan cifradas y NUNCA se muestran de
 * vuelta (el GET no las trae).
 */
export function SkydropxConnectionCard({ initial }: { initial?: SkydropxConnectionSummary | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const {
    data: connection,
    isPending,
    error,
  } = useQuery({
    queryKey: ['skydropx-connection'],
    queryFn: () => api.get<SkydropxConnectionSummary | null>('/v1/skydropx/connection'),
    initialData: initial,
    staleTime: 15_000,
    enabled: canManage,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!canManage) return null;

  const disconnect = async () => {
    if (!confirm('¿Desconectar Skydropx? Las guías por agregador dejarán de estar disponibles.'))
      return;
    setDisconnecting(true);
    try {
      await api.delete('/v1/skydropx/connection');
      toast.success('Skydropx desconectado');
      qc.invalidateQueries({ queryKey: ['skydropx-connection'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <Route className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Envíos multi-transportadora (Skydropx)</h3>
              {isPending ? (
                <Badge variant="outline">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Consultando
                </Badge>
              ) : error ? (
                <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  No se pudo consultar
                </Badge>
              ) : connection ? (
                connection.status === 'error' ? (
                  <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    Error · {MODE_LABEL[connection.mode]}
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <Check className="h-3 w-3" />
                    Conectado · {MODE_LABEL[connection.mode]}
                  </Badge>
                )
              ) : (
                <Badge variant="outline">Sin conexion</Badge>
              )}
            </div>

            {connection ? (
              <>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Conectado{' '}
                  {formatRelative(new Date(connection.createdAt), new Date(), { locale: es })}. El
                  remitente sale de la conexión Coordinadora de cada sede.
                </p>
                {connection.lastError ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {connection.lastError}
                  </p>
                ) : null}
              </>
            ) : error ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                El servidor no respondió. Si ya estaba conectado, sigue guardado.
              </p>
            ) : isPending ? null : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Agregador multi-transportadora: cotiza y genera guías con varias transportadoras. El
                remitente sale de la conexión Coordinadora de cada sede (incluido su código postal).
              </p>
            )}
          </div>
        </div>

        {!formOpen ? (
          connection ? (
            // MISMO patron de las demas tarjetas: Editar + basurita. Editar =
            // re-conectar (las llaves guardadas jamas se muestran; para
            // cambiar de modo o de llaves se pegan las nuevas).
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={disconnect}
                loading={disconnecting}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button size="sm" className="shrink-0" onClick={() => setFormOpen(true)}>
              <Plug className="h-3.5 w-3.5" />
              Conectar
            </Button>
          )
        ) : null}
      </div>

      {formOpen ? (
        <SkydropxForm
          initialMode={connection?.mode}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['skydropx-connection'] });
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SkydropxForm({
  initialMode,
  onDone,
  onCancel,
}: {
  /** Modo actual de la conexion (al editar arranca en el que ya esta). */
  initialMode?: SkydropxMode;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<SkydropxMode>(initialMode ?? 'sandbox');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = apiKey.trim().length >= 10 && apiSecret.trim().length >= 10;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      // El server valida las credenciales contra la API real de Skydropx.
      await api.post('/v1/skydropx/connection', {
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        mode,
      });
      toast.success('Skydropx conectado');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar a Skydropx');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="space-y-1.5">
        <Label>Modo</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-input bg-background p-1">
          {(['sandbox', 'production'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="skydropx-key">API Key</Label>
          <Input
            id="skydropx-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="La key del panel de Skydropx"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skydropx-secret">API Secret</Label>
          <Input
            id="skydropx-secret"
            type="password"
            autoComplete="off"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="El secret del panel de Skydropx"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Las credenciales se validan contra la API real al conectar y se guardan cifradas; nunca se
        muestran de vuelta.
      </p>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save} loading={saving} disabled={!valid}>
          Conectar
        </Button>
      </div>
    </div>
  );
}
