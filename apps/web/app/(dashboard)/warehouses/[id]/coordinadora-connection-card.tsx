'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plug, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  coordinadoraRotuloOptions,
  DEFAULT_ROTULO_ID,
  type CoordinadoraCity,
  type CoordinadoraConnectionSummary,
  type CoordinadoraTestResult,
} from '@smartlogistica/shared';

import { CityPicker } from '@/components/city-picker';
import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

interface Props {
  warehouseId: string;
  warehouseName: string;
  initial: CoordinadoraConnectionSummary | null;
}

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400';

export function CoordinadoraConnectionCard({ warehouseId, warehouseName, initial }: Props) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER';

  const { data: connection } = useQuery({
    queryKey: ['coordinadora', warehouseId],
    queryFn: () =>
      api.get<CoordinadoraConnectionSummary | null>(`/v1/warehouses/${warehouseId}/coordinadora`),
    initialData: initial,
  });

  const [open, setOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    if (!confirm(`Desconectar Coordinadora de "${warehouseName}"?`)) return;
    setDisconnecting(true);
    try {
      await api.delete(`/v1/warehouses/${warehouseId}/coordinadora`);
      toast.success('Coordinadora desconectada');
      qc.invalidateQueries({ queryKey: ['coordinadora', warehouseId] });
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
            <Truck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Envios · Coordinadora</h3>
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
                <span className="text-foreground">{connection.usuario}</span>
                <span className="px-1.5 text-border">·</span>
                Origen: {connection.senderCityName ?? connection.senderCityCode}
                <span className="px-1.5 text-border">·</span>
                {connection.senderAddress}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {canManage
                  ? `Conecta Coordinadora para generar guias de los pedidos de ${warehouseName}.`
                  : 'Esta sede aun no tiene Coordinadora conectada.'}
              </p>
            )}
          </div>
        </div>

        {canManage && !open ? (
          connection ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
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
            <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
              <Plug className="h-3.5 w-3.5" />
              Conectar
            </Button>
          )
        ) : null}
      </div>

      {open ? (
        <CoordinadoraForm
          warehouseId={warehouseId}
          connection={connection ?? null}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['coordinadora', warehouseId] });
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CoordinadoraForm({
  warehouseId,
  connection,
  onDone,
  onCancel,
}: {
  warehouseId: string;
  connection: CoordinadoraConnectionSummary | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(connection);
  const [idCliente, setIdCliente] = useState(connection ? String(connection.idCliente) : '');
  const [usuario, setUsuario] = useState(connection?.usuario ?? '');
  const [password, setPassword] = useState('');
  const [nit, setNit] = useState(connection?.nit ?? '');
  const [div, setDiv] = useState(connection?.div ?? '01');
  const [senderName, setSenderName] = useState(connection?.senderName ?? '');
  const [senderPhone, setSenderPhone] = useState(connection?.senderPhone ?? '');
  const [senderAddress, setSenderAddress] = useState(connection?.senderAddress ?? '');
  const [senderNit, setSenderNit] = useState(connection?.senderNit ?? '');
  const [cityCode, setCityCode] = useState(connection?.senderCityCode ?? '');
  const [cityName, setCityName] = useState(connection?.senderCityName ?? '');
  const [rotuloId, setRotuloId] = useState(connection?.rotuloId ?? DEFAULT_ROTULO_ID);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const credsReady =
    Number(idCliente) > 0 && usuario.trim().length >= 3 && nit.trim().length >= 3 &&
    (password.trim().length >= 3 || editing);
  const valid =
    credsReady &&
    senderName.trim().length >= 2 &&
    senderPhone.trim().length >= 5 &&
    senderAddress.trim().length >= 3 &&
    cityCode.trim().length >= 4;

  const credsBody = () => ({
    idCliente: Number(idCliente),
    usuario: usuario.trim(),
    ...(password.trim() ? { password: password.trim() } : {}),
    nit: nit.trim(),
    div: div.trim() || '01',
  });

  const test = async () => {
    if (!credsReady || !password.trim()) {
      toast.error('Ingresa la contrasena para probar la conexion');
      return;
    }
    setTesting(true);
    try {
      const r = await api.post<CoordinadoraTestResult>(
        `/v1/warehouses/${warehouseId}/coordinadora/test`,
        { idCliente: Number(idCliente), usuario: usuario.trim(), password: password.trim(), nit: nit.trim(), div: div.trim() || '01' },
      );
      toast.success(`Conexion exitosa (${r.cities} ciudades disponibles)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar a Coordinadora');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.put(`/v1/warehouses/${warehouseId}/coordinadora`, {
        ...credsBody(),
        senderName: senderName.trim(),
        senderNit: senderNit.trim() || null,
        senderPhone: senderPhone.trim(),
        senderAddress: senderAddress.trim(),
        senderCityCode: cityCode.trim(),
        senderCityName: cityName.trim() || null,
        rotuloId,
      });
      toast.success(editing ? 'Conexion actualizada' : 'Coordinadora conectada');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexion');
    } finally {
      setSaving(false);
    }
  };

  const searchCities = (q: string) =>
    api.post<CoordinadoraCity[]>(`/v1/warehouses/${warehouseId}/coordinadora/cities`, {
      query: q,
      ...credsBody(),
    });

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Credenciales */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Credenciales de Coordinadora
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Id de cliente">
            <Input value={idCliente} onChange={(e) => setIdCliente(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="54073" />
          </Field>
          <Field label="Usuario">
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" placeholder="prefijo.usuario" />
          </Field>
          <Field label={editing ? 'Contrasena (dejar en blanco = conservar)' : 'Contrasena'}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={editing ? '••••••••' : 'Contrasena'} />
          </Field>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Field label="NIT">
              <Input value={nit} onChange={(e) => setNit(e.target.value)} placeholder="901339881" />
            </Field>
            <Field label="Div">
              <Input value={div} onChange={(e) => setDiv(e.target.value)} placeholder="01" />
            </Field>
          </div>
        </div>
      </div>

      {/* Origen / remitente */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Origen (remitente de esta sede)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre del remitente">
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="KUPO CELL SAS" />
          </Field>
          <Field label="Telefono">
            <Input value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} placeholder="6011234567" />
          </Field>
          <Field label="Direccion de origen">
            <Input value={senderAddress} onChange={(e) => setSenderAddress(e.target.value)} placeholder="CALLE 1 # 1-1" />
          </Field>
          <Field label="NIT remitente (opcional)">
            <Input value={senderNit} onChange={(e) => setSenderNit(e.target.value)} placeholder="Igual al NIT si se deja vacio" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ciudad de origen">
              <CityPicker
                value={cityName || cityCode}
                onPick={(c) => {
                  setCityCode(c.code);
                  setCityName(`${c.name} — ${c.department}`);
                }}
                search={searchCities}
                queryKey={`origin-${warehouseId}`}
                disabled={!credsReady}
              />
            </Field>
            {!credsReady ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Completa las credenciales para buscar la ciudad.
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Field label="Formato de rotulo (por defecto)">
              <select
                value={rotuloId}
                onChange={(e) => setRotuloId(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {coordinadoraRotuloOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={testing || saving}>
          Cancelar
        </Button>
        <Button variant="outline" size="sm" onClick={test} loading={testing} disabled={!credsReady || saving}>
          Probar conexion
        </Button>
        <Button size="sm" onClick={save} loading={saving} disabled={!valid || testing}>
          {editing ? 'Guardar' : 'Conectar'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
