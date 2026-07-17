'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plug, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraConnectionSummary, AlegraTestResult } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

interface Props {
  warehouseId: string;
  warehouseName: string;
  initial: AlegraConnectionSummary | null;
}

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';

export function AlegraConnectionCard({ warehouseId, warehouseName, initial }: Props) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER';

  const { data: connection } = useQuery({
    queryKey: ['alegra', warehouseId],
    queryFn: () => api.get<AlegraConnectionSummary | null>(`/v1/warehouses/${warehouseId}/alegra`),
    initialData: initial,
  });

  const [form, setForm] = useState<null | 'connect' | 'edit'>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const closeForm = () => setForm(null);
  const onDone = () => {
    qc.invalidateQueries({ queryKey: ['alegra', warehouseId] });
    closeForm();
  };

  const disconnect = async () => {
    if (!confirm(`Desconectar Alegra de "${warehouseName}"? Tendras que volver a ingresar las credenciales.`))
      return;
    setDisconnecting(true);
    try {
      await api.delete(`/v1/warehouses/${warehouseId}/alegra`);
      toast.success('Alegra desconectado');
      qc.invalidateQueries({ queryKey: ['alegra', warehouseId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <Receipt className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Contabilidad · Alegra</h3>
              {connection ? (
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
                {connection.companyName ? (
                  <>
                    <span className="text-foreground">{connection.companyName}</span>
                    <span className="px-1.5 text-border">·</span>
                  </>
                ) : null}
                {connection.email}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {canManage
                  ? `Conecta Alegra para facturar los pedidos de ${warehouseName}.`
                  : 'Esta sede aun no tiene Alegra conectado.'}
              </p>
            )}
          </div>
        </div>

        {/* Acciones (solo admin, y solo cuando el form esta cerrado) */}
        {canManage && form === null ? (
          connection ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setForm('edit')}>
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
            <Button size="sm" className="shrink-0" onClick={() => setForm('connect')}>
              <Plug className="h-3.5 w-3.5" />
              Conectar Alegra
            </Button>
          )
        ) : null}
      </div>

      {form !== null ? (
        <AlegraForm
          warehouseId={warehouseId}
          mode={form}
          initialEmail={connection?.email ?? ''}
          onDone={onDone}
          onCancel={closeForm}
        />
      ) : null}
    </div>
  );
}

function AlegraForm({
  warehouseId,
  mode,
  initialEmail,
  onDone,
  onCancel,
}: {
  warehouseId: string;
  mode: 'connect' | 'edit';
  initialEmail: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email.trim()) && token.trim().length >= 8;

  const test = async () => {
    if (!valid) return;
    setTesting(true);
    setVerified(null);
    try {
      const r = await api.post<AlegraTestResult>(`/v1/warehouses/${warehouseId}/alegra/test`, {
        email: email.trim(),
        token: token.trim(),
      });
      setVerified(r.companyName ?? 'Credenciales validas');
      toast.success(r.companyName ? `Conexion exitosa: ${r.companyName}` : 'Credenciales validas');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar a Alegra');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.put(`/v1/warehouses/${warehouseId}/alegra`, { email: email.trim(), token: token.trim() });
      toast.success(mode === 'edit' ? 'Credenciales actualizadas' : 'Alegra conectado');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexion');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="alegra-email">Email de Alegra</Label>
          <Input
            id="alegra-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setVerified(null);
            }}
            placeholder="contabilidad@empresa.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alegra-token">API Token</Label>
          <Input
            id="alegra-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setVerified(null);
            }}
            placeholder={mode === 'edit' ? 'Ingresa el token nuevamente' : 'Token de la API de Alegra'}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Genera el token en Alegra → <span className="text-foreground">Configuracion → API</span>. Se
        guarda cifrado; nunca se muestra de vuelta.
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
          <Button
            variant="outline"
            size="sm"
            onClick={test}
            loading={testing}
            disabled={!valid || saving}
          >
            Probar conexion
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!valid || testing}>
            {mode === 'edit' ? 'Guardar' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
