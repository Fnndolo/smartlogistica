'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, MessageCircle, Pencil, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WhapifyConnectionSummary, WhapifyTestResult } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

const ICON_TILE =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';

/**
 * Conexion a Whapify (WhatsApp del negocio). El token del API se guarda
 * cifrado y habilita la pestaña WhatsApp del pedido (solo administradores).
 * `initial` undefined = el SSR no pudo consultar (la query reintenta).
 */
export function WhapifyConnectionCard({ initial }: { initial?: WhapifyConnectionSummary | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  // TEMPORAL: solo el PROPIETARIO ve/gestiona la conexion mientras la
  // integracion madura (igual que la pestaña WhatsApp del pedido).
  const canManage = user?.role === 'OWNER';

  const {
    data: connection,
    isPending,
    error,
  } = useQuery({
    queryKey: ['whapify-connection'],
    queryFn: () => api.get<WhapifyConnectionSummary | null>('/v1/connections/whapify'),
    initialData: initial,
    staleTime: 15_000,
    enabled: canManage,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!canManage) return null;

  const disconnect = async () => {
    if (!confirm('¿Desconectar Whapify? La pestaña WhatsApp de los pedidos dejará de funcionar.')) return;
    setDisconnecting(true);
    try {
      await api.delete('/v1/connections/whapify');
      toast.success('Whapify desconectado');
      qc.invalidateQueries({ queryKey: ['whapify-connection'] });
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
            <MessageCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">WhatsApp (Whapify)</h3>
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
                  Conectado
                </Badge>
              ) : (
                <Badge variant="outline">Sin conexion</Badge>
              )}
            </div>

            {connection ? (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                <span className="text-foreground">{connection.accountName ?? 'Cuenta Whapify'}</span>
                {connection.totalContacts != null ? (
                  <>
                    <span className="px-1.5 text-border">·</span>
                    <span className="tabular-nums">{connection.totalContacts.toLocaleString('es-CO')} contactos</span>
                  </>
                ) : null}
              </p>
            ) : error ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                El servidor no respondió. Si ya estaba conectado, sigue guardado.
              </p>
            ) : isPending ? null : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Conecta el token del API de Whapify para ver y responder el WhatsApp de cada pedido.
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
        <WhapifyForm
          isEdit={Boolean(connection)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['whapify-connection'] });
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WhapifyForm({
  isEdit,
  onDone,
  onCancel,
}: {
  isEdit: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);

  const valid = token.trim().length >= 10;

  const test = async () => {
    if (!valid) return;
    setTesting(true);
    setVerified(null);
    try {
      const r = await api.post<WhapifyTestResult>('/v1/connections/whapify/test', { token: token.trim() });
      setVerified(
        `Cuenta «${r.accountName ?? '—'}»${r.totalContacts != null ? ` · ${r.totalContacts.toLocaleString('es-CO')} contactos` : ''}`,
      );
      toast.success('Conexion exitosa con Whapify');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar a Whapify');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.put('/v1/connections/whapify', { token: token.trim() });
      toast.success('Whapify conectado');
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
        <Label htmlFor="whapify-token">Token del API</Label>
        <Input
          id="whapify-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setVerified(null);
          }}
          placeholder="Pega el token (Whapify → Settings → API)"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        El token se guarda cifrado; nunca se muestra de vuelta. Habilita la pestaña WhatsApp del
        pedido para los administradores.
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          {verified ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span className="truncate">{verified}</span>
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
