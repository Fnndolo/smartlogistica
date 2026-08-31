'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Cloud, Loader2, Pencil, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  Dialog360ConnectionSummary,
  Dialog360Mode,
} from '@smartlogistica/shared';

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

/**
 * Conexion a 360dialog (Cloud API de Meta, api-first): EL canal de WhatsApp.
 * Al conectar, el webhook del numero queda apuntando SOLO a esta plataforma
 * (mensajes, medios y echoes del celular entran directo al hilo del pedido).
 * TEMPORAL: solo el propietario, igual que el resto de WhatsApp.
 */
export function Dialog360ConnectionCard({ initial }: { initial?: Dialog360ConnectionSummary | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const {
    data: connection,
    isPending,
    error,
  } = useQuery({
    queryKey: ['dialog360-connection'],
    queryFn: () => api.get<Dialog360ConnectionSummary | null>('/v1/connections/dialog360'),
    initialData: initial,
    staleTime: 15_000,
    enabled: canManage,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!canManage) return null;

  const disconnect = async () => {
    if (!confirm('¿Desconectar 360dialog? La plataforma quedará SIN WhatsApp (confirmaciones y chat).'))
      return;
    setDisconnecting(true);
    try {
      await api.delete('/v1/connections/dialog360');
      toast.success('360dialog desconectado');
      qc.invalidateQueries({ queryKey: ['dialog360-connection'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className={CONN_CARD}>
      <div className="flex flex-wrap items-start gap-[13px]">
        <Tile tone="sky">
          <Cloud className="h-[18px] w-[18px]" />
        </Tile>

        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px] font-extrabold">WhatsApp Cloud API</b>
            <Pill tone="muted">360dialog</Pill>
            {isPending ? (
              <Pill tone="muted" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
                Consultando
              </Pill>
            ) : error ? (
              <Pill tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>
                No se pudo consultar
              </Pill>
            ) : connection ? (
              <Pill tone="ok" dot>
                {connection.mode === 'sandbox' ? 'Sandbox conectado' : 'Conectado'}
              </Pill>
            ) : (
              <Pill tone="muted" dot>
                Sin conexión
              </Pill>
            )}
          </div>

          {connection ? (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              Webhook configurado automáticamente: todo lo del número entra directo al hilo del
              pedido{connection.mode === 'sandbox' ? ' (modo pruebas)' : ''}.
            </p>
          ) : error ? (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              El servidor no respondió. Si ya estaba conectado, sigue guardado.
            </p>
          ) : isPending ? null : (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              El API crudo de Meta: mensajes, medios y lo enviado desde el celular, sin
              intermediarios. Empieza con el sandbox para probar.
            </p>
          )}

          {/* Ultimo error reportado por 360dialog: sigue conectado, pero algo fallo. */}
          {connection?.lastError ? <ErrorLine>{connection.lastError}</ErrorLine> : null}
        </div>

        {!formOpen ? (
          connection ? (
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
        <Dialog360Form
          initialMode={connection?.mode ?? 'sandbox'}
          isEdit={Boolean(connection)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['dialog360-connection'] });
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Dialog360Form({
  initialMode,
  isEdit,
  onDone,
  onCancel,
}: {
  initialMode: Dialog360Mode;
  isEdit: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Dialog360Mode>(initialMode);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);

  const valid = apiKey.trim().length >= 10;
  const body = () => ({ apiKey: apiKey.trim(), mode });

  const test = async () => {
    if (!valid) return;
    setTesting(true);
    setVerified(false);
    try {
      await api.post('/v1/connections/dialog360/test', body());
      setVerified(true);
      toast.success('API key válida');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar a 360dialog');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.put('/v1/connections/dialog360', body());
      toast.success('360dialog conectado y webhook configurado');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexión');
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
              onClick={() => {
                setMode(m);
                setVerified(false);
              }}
              className={cn(SEG_ITEM, mode === m ? SEG_ON : SEG_OFF)}
            >
              {m === 'sandbox' ? 'Sandbox (pruebas)' : 'Producción'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="d360-key" className={LABEL_MICRO}>
          API key (D360-API-KEY)
        </Label>
        <Input
          id="d360-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setVerified(false);
          }}
          placeholder={mode === 'sandbox' ? 'La key que muestra el demo de 360dialog' : 'La key del número en el hub de 360dialog'}
          className="rounded-[10px]"
        />
      </div>

      <p className="text-[12px] text-muted-foreground">
        Al conectar, el webhook del número queda apuntando automáticamente a esta plataforma. La key
        se guarda cifrada; nunca se muestra de vuelta.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
          {verified ? (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span>API key válida</span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={BTN_QUIET}
            onClick={onCancel}
            disabled={testing || saving}
          >
            Cancelar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={BTN_GHOST}
            onClick={test}
            loading={testing}
            disabled={!valid || saving}
          >
            Probar conexión
          </Button>
          <Button
            size="sm"
            className={BTN_PRIMARY}
            onClick={save}
            loading={saving}
            disabled={!valid || testing}
          >
            {isEdit ? 'Guardar' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
