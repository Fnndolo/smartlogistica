'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { es } from 'date-fns/locale/es';
import { RefreshCw, Tags } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AddiLbaConnectionInput,
  AddiLbaConnectionSummary,
  AddiLbaSyncResult,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  CardHead,
  EMPTY_CLS,
  FOCUS_RING,
  Pill,
} from './settings-ui';

const KEY = ['addi-lba-connection'] as const;

interface Form {
  portalEmail: string;
  portalPassword: string;
  suiteEmail: string;
  suitePassword: string;
  autoSender: boolean;
}

const EMPTY: Form = {
  portalEmail: '',
  portalPassword: '',
  suiteEmail: '',
  suitePassword: '',
  autoSender: true,
};

/**
 * GUIAS DE ADDI. Addi genera la guia de Coordinadora de cada pedido de VTEX
 * con UN solo remitente. Con las dos cuentas de Addi (portal de aliados +
 * suite de Coordinadora) la plataforma trae el numero de guia de cada pedido y,
 * al pasarlo a una sede, le pone el remitente de esa sede y deja el rotulo en
 * la conversacion. Las contraseñas se guardan cifradas y no vuelven aqui.
 */
export function AddiLbaCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<AddiLbaConnectionSummary | null>('/v1/addi-lba/connection'),
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [confirmOff, setConfirmOff] = useState(false);

  const configured = Boolean(data);
  const showForm = !isLoading && !isError && (editing || !configured);

  useEffect(() => {
    if (!editing) return;
    setForm(
      data
        ? {
            ...EMPTY,
            portalEmail: data.portalEmail,
            suiteEmail: data.suiteEmail,
            autoSender: data.autoSender,
          }
        : EMPTY,
    );
  }, [editing, data]);

  const save = useMutation({
    mutationFn: (input: AddiLbaConnectionInput) =>
      api.put<AddiLbaConnectionSummary>('/v1/addi-lba/connection', input),
    onSuccess: (saved) => {
      qc.setQueryData(KEY, saved);
      setEditing(false);
      setForm(EMPTY);
      toast.success('Conexión guardada: las dos cuentas iniciaron sesión bien');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexión', {
        duration: 9_000,
      }),
  });

  const sync = useMutation({
    mutationFn: () => api.post<AddiLbaSyncResult>('/v1/addi-lba/sync', {}),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['addi-guide'] });
      toast.success(
        `${r.shipments} guías en Addi · ${r.matched} de pedidos nuestros · ${r.updated} completadas o actualizadas`,
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo sincronizar', {
        duration: 9_000,
      }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete('/v1/addi-lba/connection'),
    onSuccess: () => {
      qc.setQueryData(KEY, null);
      setConfirmOff(false);
      toast.success('Conexión eliminada');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar la conexión'),
  });

  const submit = () => {
    save.mutate({
      portalEmail: form.portalEmail.trim(),
      ...(form.portalPassword ? { portalPassword: form.portalPassword } : {}),
      suiteEmail: form.suiteEmail.trim(),
      ...(form.suitePassword ? { suitePassword: form.suitePassword } : {}),
      autoSender: form.autoSender,
    });
  };

  const canSubmit =
    form.portalEmail.trim() !== '' &&
    form.suiteEmail.trim() !== '' &&
    // Al crear hacen falta las dos contraseñas; al editar, vacio = la guardada.
    (configured || (form.portalPassword !== '' && form.suitePassword !== ''));

  return (
    <div className={CARD_CLS}>
      <CardHead
        icon={<Tags />}
        tone="cobalt"
        title="Guías de Addi"
        badge={
          data ? (
            data.status === 'error' ? (
              <Pill tone="bad" dot>
                Con error
              </Pill>
            ) : (
              <Pill tone="ok" dot>
                Conectada
              </Pill>
            )
          ) : null
        }
        description="Addi genera la guía de cada pedido de VTEX con un solo remitente. Con sus dos cuentas, cada pedido llega a la plataforma ya con su número de guía y, al pasarlo a una sede, la guía toma el remitente de esa sede en Coordinadora y el rótulo llega a la conversación."
      />

      {isLoading ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>Cargando...</div>
      ) : isError ? (
        <div className={cn(EMPTY_CLS, 'mt-4')}>
          No se pudo cargar la conexión.{' '}
          <button
            type="button"
            onClick={() => refetch()}
            className={cn(
              'rounded font-bold text-accent-ink underline underline-offset-2',
              FOCUS_RING,
            )}
          >
            Reintentar
          </button>
        </div>
      ) : showForm ? (
        <div className="mt-4 space-y-4">
          <fieldset className="space-y-2.5">
            <legend className="text-[12px] font-bold">Portal de aliados de Addi</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="addi-portal-email">Correo</Label>
                <Input
                  id="addi-portal-email"
                  type="email"
                  autoComplete="off"
                  value={form.portalEmail}
                  onChange={(e) => setForm((f) => ({ ...f, portalEmail: e.target.value }))}
                  placeholder="correo@negocio.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addi-portal-pass">Contraseña</Label>
                <Input
                  id="addi-portal-pass"
                  type="password"
                  autoComplete="new-password"
                  value={form.portalPassword}
                  onChange={(e) => setForm((f) => ({ ...f, portalPassword: e.target.value }))}
                  placeholder={configured ? 'Sin cambios (la guardada)' : ''}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2.5">
            <legend className="text-[12px] font-bold">
              Suite de Coordinadora (la cuenta que da Addi)
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="addi-suite-email">Correo</Label>
                <Input
                  id="addi-suite-email"
                  type="email"
                  autoComplete="off"
                  value={form.suiteEmail}
                  onChange={(e) => setForm((f) => ({ ...f, suiteEmail: e.target.value }))}
                  placeholder="correo@negocio.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addi-suite-pass">Contraseña</Label>
                <Input
                  id="addi-suite-pass"
                  type="password"
                  autoComplete="new-password"
                  value={form.suitePassword}
                  onChange={(e) => setForm((f) => ({ ...f, suitePassword: e.target.value }))}
                  placeholder={configured ? 'Sin cambios (la guardada)' : ''}
                />
              </div>
            </div>
          </fieldset>

          <AutoSenderSwitch
            on={form.autoSender}
            onChange={(v) => setForm((f) => ({ ...f, autoSender: v }))}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={submit}
              disabled={!canSubmit}
              loading={save.isPending}
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
            >
              Guardar y probar
            </Button>
            {configured ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={save.isPending}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              >
                Cancelar
              </Button>
            ) : null}
            <span className="text-[11.5px] text-hint">
              Antes de guardar se inicia sesión en las dos cuentas para comprobarlas.
            </span>
          </div>
        </div>
      ) : data ? (
        <div className="mt-4 space-y-3">
          <dl className="grid grid-cols-1 gap-y-2 rounded-[12px] border border-border px-3.5 py-3 text-[12.5px] sm:grid-cols-[170px_minmax(0,1fr)]">
            <dt className="font-semibold text-hint">Portal de Addi</dt>
            <dd className="min-w-0 break-all font-semibold">{data.portalEmail}</dd>
            <dt className="font-semibold text-hint">Suite de Coordinadora</dt>
            <dd className="min-w-0 break-all font-semibold">{data.suiteEmail}</dd>
            <dt className="font-semibold text-hint">Al pasar a una sede</dt>
            <dd className="min-w-0 font-semibold">
              {data.autoSender
                ? 'Cambia el remitente y envía el rótulo al chat'
                : 'Apagado: solo trae los números de guía'}
            </dd>
            <dt className="font-semibold text-hint">Última búsqueda manual</dt>
            <dd className="min-w-0 font-semibold">
              {data.lastSyncAt
                ? `${formatDistanceToNow(new Date(data.lastSyncAt), { addSuffix: true, locale: es })}${
                    data.lastSyncCount != null ? ` · ${data.lastSyncCount} pedidos encontrados` : ''
                  }`
                : 'Ninguna (las guías se traen solas al llegar cada pedido)'}
            </dd>
          </dl>
          {data.status === 'error' && data.lastError ? (
            <p className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {data.lastError}
            </p>
          ) : null}

          {confirmOff ? (
            <div className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
              <p className="text-[12.5px] leading-[1.45] text-amber-700 dark:text-amber-400">
                <b>¿Eliminar la conexión?</b> Se dejan de traer las guías de Addi y de cambiar
                remitentes. Las guías ya traídas siguen en los pedidos.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => disconnect.mutate()}
                  loading={disconnect.isPending}
                  className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
                >
                  Sí, eliminar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmOff(false)}
                  className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => sync.mutate()}
                loading={sync.isPending}
                className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Buscar guías faltantes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              >
                Editar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmOff(true)}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS, 'text-destructive hover:text-destructive')}
              >
                Eliminar
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AutoSenderSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-border px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">Cambiar remitente al pasar a una sede</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Al asignar o transferir un pedido de VTEX, su guía toma el remitente de la sede (el de
          Ajustes de la sede › Coordinadora) y el rótulo llega a la conversación. Apagado, solo se
          traen los números de guía.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Cambiar remitente al pasar a una sede"
        onClick={() => onChange(!on)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none',
          on ? 'border-transparent bg-accent' : 'border-border bg-muted',
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
            on ? 'translate-x-[22px]' : 'translate-x-[2px]',
          )}
        />
      </button>
    </div>
  );
}
