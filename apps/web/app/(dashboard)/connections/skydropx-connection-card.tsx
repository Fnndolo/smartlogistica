'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRelative } from 'date-fns/formatRelative';
import { es } from 'date-fns/locale/es';
import { AlertTriangle, Loader2, Pencil, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SkydropxConnectionSummary, SkydropxMode } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST,
  BTN_ICON,
  BTN_PRIMARY,
  BTN_QUIET,
  CONN_CARD,
  ErrorLine,
  LABEL_MICRO,
  Pill,
  SEG_ITEM,
  SEG_OFF,
  SEG_ON,
  SEG_WRAP,
  Tile,
} from './connection-ui';

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
    <div className={CONN_CARD}>
      <div className="flex flex-wrap items-start gap-[13px]">
        {/* Baldosa con el logo de Skydropx (la imagen llena el cuadrado). */}
        <Tile>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/carriers/skydropx.webp" alt="" className="h-full w-full object-cover" />
        </Tile>

        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px] font-extrabold">Envíos multi-transportadora</b>
            <Pill tone="muted">Skydropx</Pill>
            {isPending ? (
              <Pill tone="muted" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
                Consultando
              </Pill>
            ) : error ? (
              <Pill tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>
                No se pudo consultar
              </Pill>
            ) : connection ? (
              connection.status === 'error' ? (
                <Pill tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>
                  Error · {MODE_LABEL[connection.mode]}
                </Pill>
              ) : (
                <Pill tone="ok" dot>
                  Conectado · {MODE_LABEL[connection.mode]}
                </Pill>
              )
            ) : (
              <Pill tone="muted" dot>
                Sin conexión
              </Pill>
            )}
          </div>

          {connection ? (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              Conectado {formatRelative(new Date(connection.createdAt), new Date(), { locale: es })}.
              El remitente sale de la conexión Coordinadora de cada sede.
            </p>
          ) : error ? (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              El servidor no respondió. Si ya estaba conectado, sigue guardado.
            </p>
          ) : isPending ? null : (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              Agregador multi-transportadora: cotiza y genera guías con varias transportadoras. El
              remitente sale de la conexión Coordinadora de cada sede (incluido su código postal).
            </p>
          )}

          {connection?.lastError ? <ErrorLine>{connection.lastError}</ErrorLine> : null}
        </div>

        {!formOpen ? (
          connection ? (
            // MISMO patron de las demas tarjetas: Editar + basurita. Editar =
            // re-conectar (las llaves guardadas jamas se muestran; para
            // cambiar de modo o de llaves se pegan las nuevas).
            <div className="flex shrink-0 flex-wrap items-center gap-[7px]">
              <Button variant="ghost" size="sm" className={BTN_GHOST} onClick={() => setFormOpen(true)}>
                <Pencil />
                Editar
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={BTN_ICON}
                onClick={disconnect}
                loading={disconnecting}
                title="Desconectar"
                aria-label="Desconectar"
              >
                {disconnecting ? null : <Trash2 />}
              </Button>
            </div>
          ) : (
            <Button size="sm" className={`${BTN_PRIMARY} shrink-0`} onClick={() => setFormOpen(true)}>
              <Plug />
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
        <Label className={LABEL_MICRO}>Modo</Label>
        <div className={cn(SEG_WRAP, 'grid-cols-2')}>
          {(['sandbox', 'production'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(SEG_ITEM, mode === m ? SEG_ON : SEG_OFF)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="skydropx-key" className={LABEL_MICRO}>
            API Key
          </Label>
          <Input
            id="skydropx-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="La key del panel de Skydropx"
            className="rounded-[10px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skydropx-secret" className={LABEL_MICRO}>
            API Secret
          </Label>
          <Input
            id="skydropx-secret"
            type="password"
            autoComplete="off"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="El secret del panel de Skydropx"
            className="rounded-[10px]"
          />
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Las credenciales se validan contra la API real al conectar y se guardan cifradas; nunca se
        muestran de vuelta.
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className={BTN_QUIET} onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button size="sm" className={BTN_PRIMARY} onClick={save} loading={saving} disabled={!valid}>
          Conectar
        </Button>
      </div>
    </div>
  );
}
