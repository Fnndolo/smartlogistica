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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const ICON_TILE =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400';

/**
 * Conexion a 360dialog (Cloud API de Meta, api-first): EL canal de WhatsApp.
 * Al conectar, el webhook del numero queda apuntando SOLO a esta plataforma
 * (mensajes, medios y echoes del celular entran directo al hilo del pedido).
 * TEMPORAL: solo el propietario, igual que el resto de WhatsApp.
 */
export function Dialog360ConnectionCard({ initial }: { initial?: Dialog360ConnectionSummary | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER';

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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <Cloud className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">WhatsApp Cloud API (360dialog)</h3>
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
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  {connection.mode === 'sandbox' ? 'Sandbox conectado' : 'Conectado'}
                </Badge>
              ) : (
                <Badge variant="outline">Sin conexion</Badge>
              )}
            </div>

            {connection ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Webhook configurado automáticamente: todo lo del número entra directo al hilo del
                pedido{connection.mode === 'sandbox' ? ' (modo pruebas)' : ''}.
              </p>
            ) : error ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                El servidor no respondió. Si ya estaba conectado, sigue guardado.
              </p>
            ) : isPending ? null : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                El API crudo de Meta: mensajes, medios y lo enviado desde el celular, sin
                intermediarios. Empieza con el sandbox para probar.
              </p>
            )}
          </div>
        </div>

        {!formOpen ? (
          connection ? (
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
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexion');
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
              onClick={() => {
                setMode(m);
                setVerified(false);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'sandbox' ? 'Sandbox (pruebas)' : 'Producción'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="d360-key">API key (D360-API-KEY)</Label>
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
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Al conectar, el webhook del número queda apuntando automáticamente a esta plataforma. La key
        se guarda cifrada; nunca se muestra de vuelta.
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          {verified ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>API key válida</span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={testing || saving}>
            Cancelar
          </Button>
          <Button variant="outline" size="sm" onClick={test} loading={testing} disabled={!valid || saving}>
            Probar conexion
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!valid || testing}>
            {isEdit ? 'Guardar' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
