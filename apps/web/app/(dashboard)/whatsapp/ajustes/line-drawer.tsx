'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { WaLineSummary, WaProvider } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  FOCUS_RING,
  SideDrawer,
} from '../../settings/settings-ui';

const FIELD_CLS =
  'h-auto min-h-[38px] rounded-[10px] border-input bg-card text-[13px] shadow-none transition-colors [transition-duration:140ms] placeholder:text-hint hover:border-accent';
const LABEL_CLS = 'block text-[11px] font-bold uppercase tracking-[0.06em] text-hint';

/**
 * Conectar OTRO numero de WhatsApp.
 *
 * Dos proveedores, mismo cuerpo de mensaje (los dos hablan la Cloud API de
 * Meta): solo cambian las credenciales y como se registra el webhook. Con
 * 360dialog se configura solo; con Meta hay que pegarlo a mano en su panel, asi
 * que al terminar se muestran la URL y el token para copiarlos.
 */
export function LineDrawer({
  open,
  isFirst,
  onClose,
}: {
  open: boolean;
  /** true = no hay ninguna linea todavia; nace predeterminada sin preguntar. */
  isFirst: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<WaProvider>('dialog360');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [done, setDone] = useState<WaLineSummary | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<WaLineSummary>('/v1/whatsapp/config/lines', {
        label: label.trim(),
        provider,
        apiKey: apiKey.trim(),
        mode: 'production',
        isDefault: isFirst || isDefault,
        ...(provider === 'meta'
          ? {
              phoneNumberId: phoneNumberId.trim(),
              wabaId: wabaId.trim(),
              ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            }
          : {}),
      }),
    onSuccess: (line) => {
      qc.invalidateQueries({ queryKey: ['wa-config'] });
      if (line.provider === 'meta') {
        // Con Meta falta un paso MANUAL: sin pegar el webhook en su panel, no
        // entra ni un mensaje. Por eso el panel no se cierra todavia.
        setDone(line);
        toast.success('Línea creada — falta pegar el webhook en Meta');
      } else {
        toast.success(`${line.label} conectada`);
        onClose();
      }
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar'),
  });

  const valid =
    label.trim().length >= 2 &&
    apiKey.trim().length >= 10 &&
    (provider === 'dialog360' || (phoneNumberId.trim() && wabaId.trim()));

  return (
    <SideDrawer
      open={open}
      busy={create.isPending}
      title="Conectar WhatsApp"
      subtitle={isFirst ? 'Tu primer número' : 'Otro número, aparte del que ya tienes'}
      onClose={onClose}
      footer={
        done ? (
          <Button onClick={onClose} className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}>
            Listo
          </Button>
        ) : (
          <>
            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!valid || create.isPending}
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
            >
              Conectar
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={create.isPending}
              className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
            >
              Cancelar
            </Button>
          </>
        )
      }
    >
      {done ? (
        <MetaWebhookStep line={done} />
      ) : (
        <div className="space-y-5">
          <div>
            <Label className={LABEL_CLS}>Por dónde se conecta</Label>
            <div className="mt-1.5 grid gap-1.5">
              <ProviderPick
                on={provider === 'dialog360'}
                title="360dialog"
                help="El intermedario que ya usas. Solo pide la API key y el webhook se configura solo."
                onPick={() => setProvider('dialog360')}
              />
              <ProviderPick
                on={provider === 'meta'}
                title="API de Meta (directo)"
                help="Sin intermediario. Pide el token de tu App y registrar el webhook a mano en el panel de Meta."
                onPick={() => setProvider('meta')}
              />
            </div>
          </div>

          <div>
            <Label className={LABEL_CLS} htmlFor="label">
              Nombre de la línea
            </Label>
            <Input
              id="label"
              autoFocus
              value={label}
              maxLength={40}
              placeholder="Ej. Ventas"
              onChange={(e) => setLabel(e.target.value)}
              className={cn(FIELD_CLS, 'mt-1.5')}
            />
            <p className="mt-1.5 text-[11.5px] text-hint">
              Así la verás en la bandeja y al elegir por dónde sale cada mensaje.
            </p>
          </div>

          <div>
            <Label className={LABEL_CLS} htmlFor="apiKey">
              {provider === 'meta' ? 'Token permanente de la App' : 'API key de 360dialog'}
            </Label>
            <Input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'meta' ? 'EAAG…' : 'Tu D360-API-KEY'}
              className={cn(FIELD_CLS, 'mt-1.5')}
            />
            <p className="mt-1.5 text-[11.5px] text-hint">
              Se guarda cifrada y nunca se muestra de vuelta.
            </p>
          </div>

          {provider === 'meta' ? (
            <>
              <div>
                <Label className={LABEL_CLS} htmlFor="phoneNumberId">
                  ID del número (Phone number ID)
                </Label>
                <Input
                  id="phoneNumberId"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  className={cn(FIELD_CLS, 'mt-1.5 font-mono')}
                />
              </div>
              <div>
                <Label className={LABEL_CLS} htmlFor="wabaId">
                  ID de la cuenta de WhatsApp (WABA ID)
                </Label>
                <Input
                  id="wabaId"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  className={cn(FIELD_CLS, 'mt-1.5 font-mono')}
                />
              </div>
              <div>
                <Label className={LABEL_CLS} htmlFor="appSecret">
                  App Secret <span className="font-normal normal-case text-hint">(opcional)</span>
                </Label>
                <Input
                  id="appSecret"
                  type="password"
                  autoComplete="off"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className={cn(FIELD_CLS, 'mt-1.5')}
                />
                <p className="mt-1.5 text-[11.5px] text-hint">
                  Sirve para comprobar que los mensajes entrantes vienen de verdad de Meta.
                </p>
              </div>
            </>
          ) : null}

          {!isFirst ? (
            <button
              type="button"
              onClick={() => setIsDefault((v) => !v)}
              aria-pressed={isDefault}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-left text-[13px] transition-colors [transition-duration:140ms]',
                isDefault ? 'border-accent ring-1 ring-accent' : 'border-input hover:border-accent',
                FOCUS_RING,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] font-black text-accent-foreground',
                  isDefault ? 'border-accent bg-accent' : 'border-input',
                )}
              >
                {isDefault ? '✓' : null}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-semibold">Hacerla la predeterminada</b>
                <span className="text-[11.5px] text-hint">
                  La que se usa cuando ninguna regla dice otra cosa.
                </span>
              </span>
            </button>
          ) : null}
        </div>
      )}
    </SideDrawer>
  );
}

/** Con Meta el webhook NO se puede registrar por API: se pega a mano. */
function MetaWebhookStep({ line }: { line: WaLineSummary }) {
  return (
    <div className="space-y-4">
      <p className="rounded-[11px] bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-amber-600 dark:text-amber-400">
        <b>{line.label}</b> quedó creada, pero <b>todavía no recibe mensajes</b>. Pega estos dos
        valores en el panel de tu App de Meta, en Webhooks → WhatsApp Business Account, y suscríbete
        al campo <b>messages</b>.
      </p>
      <CopyRow label="URL de devolución de llamada" value={line.webhookUrl ?? ''} />
      <CopyRow label="Token de verificación" value={line.verifyToken ?? ''} />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Label className={LABEL_CLS}>{label}</Label>
      <div className="mt-1.5 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-[10px] border border-input bg-surface px-3 py-2 font-mono text-[11.5px] leading-[1.6]">
          {value || '—'}
        </code>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copiar ${label}`}
          className={cn(BTN_GHOST_CLS, BTN_SM_CLS, 'shrink-0')}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}

function ProviderPick({
  on,
  title,
  help,
  onPick,
}: {
  on: boolean;
  title: string;
  help: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-left transition-colors [transition-duration:140ms]',
        on ? 'border-accent ring-1 ring-accent' : 'border-input hover:border-accent',
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
          on ? 'border-accent' : 'border-input',
        )}
      >
        {on ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] font-semibold">{title}</b>
        <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-hint">{help}</span>
      </span>
    </button>
  );
}
