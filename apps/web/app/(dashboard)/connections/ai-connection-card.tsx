'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Pencil, Plug, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_LABELS,
  aiProviderSchema,
  type AiConnectionSummary,
  type AiProvider,
  type AiTestResult,
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

const PROVIDERS = aiProviderSchema.options;

/**
 * `initial` llega `undefined` cuando el servidor no pudo consultar el API (que
 * NO es lo mismo que `null` = no hay proveedor conectado). En ese caso la query
 * lo resuelve en el cliente con reintentos.
 */
export function AiConnectionCard({ initial }: { initial?: AiConnectionSummary | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canManage = user?.role === 'OWNER';

  const {
    data: connection,
    isPending,
    error,
  } = useQuery({
    queryKey: ['ai-connection'],
    queryFn: () => api.get<AiConnectionSummary | null>('/v1/connections/ai'),
    initialData: initial,
    staleTime: 15_000,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const onDone = () => {
    qc.invalidateQueries({ queryKey: ['ai-connection'] });
    setFormOpen(false);
  };

  const disconnect = async () => {
    if (!confirm('¿Desconectar el proveedor de IA? Tendrás que volver a ingresar la API key.'))
      return;
    setDisconnecting(true);
    try {
      await api.delete('/v1/connections/ai');
      toast.success('Proveedor de IA desconectado');
      qc.invalidateQueries({ queryKey: ['ai-connection'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className={CONN_CARD}>
      <div className="flex flex-wrap items-start gap-[13px]">
        <Tile tone="violet">
          <Sparkles className="h-[18px] w-[18px]" />
        </Tile>

        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px] font-extrabold">Inteligencia Artificial</b>
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
                Conectado
              </Pill>
            ) : (
              <Pill tone="muted" dot>
                Sin conexión
              </Pill>
            )}
          </div>

          {connection ? (
            <p className="mt-[3px] max-w-[64ch] truncate text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {AI_PROVIDER_LABELS[connection.provider]}
              </span>
              <span className="px-1.5 text-border">·</span>
              <span className="font-mono text-[11.5px]">{connection.model}</span>
            </p>
          ) : error ? (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              El servidor no respondió. Si tenías un proveedor conectado, sigue guardado.
            </p>
          ) : isPending ? null : (
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              {canManage
                ? 'Conecta un modelo de IA con visión para leer el IMEI de las fotos.'
                : 'Aún no hay un proveedor de IA conectado.'}
            </p>
          )}

          {/* Ultimo error del proveedor (p. ej. sin saldo): la conexion existe, pero no responde. */}
          {connection?.lastError ? <ErrorLine>{connection.lastError}</ErrorLine> : null}
        </div>

        {canManage && !formOpen ? (
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
              Conectar IA
            </Button>
          )
        ) : null}
      </div>

      {formOpen ? (
        <AiForm
          initialProvider={connection?.provider ?? 'openai'}
          initialModel={connection?.model ?? ''}
          onDone={onDone}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AiForm({
  initialProvider,
  initialModel,
  onDone,
  onCancel,
}: {
  initialProvider: AiProvider;
  initialModel: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);

  const valid = apiKey.trim().length >= 10;
  const body = () => ({
    provider,
    apiKey: apiKey.trim(),
    model: model.trim() || undefined,
  });

  const test = async () => {
    if (!valid) return;
    setTesting(true);
    setVerified(null);
    try {
      const r = await api.post<AiTestResult>('/v1/connections/ai/test', body());
      const suffix = r.modelCount != null ? ` (${r.modelCount} modelos disponibles)` : '';
      setVerified(`Credenciales válidas${suffix}`);
      toast.success(`Conexión exitosa con ${AI_PROVIDER_LABELS[provider]}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo conectar al proveedor');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.put('/v1/connections/ai', body());
      toast.success('Proveedor de IA conectado');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexión');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      {/* Proveedor (segmentado) */}
      <div className="space-y-1.5">
        <Label className={LABEL_MICRO}>Proveedor</Label>
        <div className={cn(SEG_WRAP, 'grid-cols-3')}>
          {PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setProvider(p);
                setVerified(null);
              }}
              className={cn(SEG_ITEM, provider === p ? SEG_ON : SEG_OFF)}
            >
              {AI_PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-model" className={LABEL_MICRO}>
            Modelo
          </Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setVerified(null);
            }}
            placeholder={AI_DEFAULT_MODELS[provider]}
            className="rounded-[10px] font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-key" className={LABEL_MICRO}>
            API Key
          </Label>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setVerified(null);
            }}
            placeholder="Pega tu API key"
            className="rounded-[10px]"
          />
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Si dejas el modelo vacío usamos{' '}
        <span className="font-mono text-[11.5px]">{AI_DEFAULT_MODELS[provider]}</span>. La key se
        guarda cifrada; nunca se muestra de vuelta.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
          {verified ? (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{verified}</span>
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
            {initialModel ? 'Guardar' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
