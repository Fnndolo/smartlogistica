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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const PROVIDERS = aiProviderSchema.options;

const ICON_TILE =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400';

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
    if (!confirm('Desconectar el proveedor de IA? Tendras que volver a ingresar la API key.')) return;
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={ICON_TILE}>
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Inteligencia Artificial</h3>
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
                <span className="text-foreground">{AI_PROVIDER_LABELS[connection.provider]}</span>
                <span className="px-1.5 text-border">·</span>
                <span className="font-mono text-xs">{connection.model}</span>
              </p>
            ) : error ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                El servidor no respondio. Si tenias un proveedor conectado, sigue guardado.
              </p>
            ) : isPending ? null : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {canManage
                  ? 'Conecta un modelo de IA con vision para leer el IMEI de las fotos.'
                  : 'Aun no hay un proveedor de IA conectado.'}
              </p>
            )}
          </div>
        </div>

        {canManage && !formOpen ? (
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
      setVerified(`Credenciales validas${suffix}`);
      toast.success(`Conexion exitosa con ${AI_PROVIDER_LABELS[provider]}`);
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
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la conexion');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      {/* Proveedor (segmentado) */}
      <div className="space-y-1.5">
        <Label>Proveedor</Label>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-input bg-background p-1">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setProvider(p);
                setVerified(null);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                provider === p
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {AI_PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-model">Modelo</Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setVerified(null);
            }}
            placeholder={AI_DEFAULT_MODELS[provider]}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-key">API Key</Label>
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
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Si dejas el modelo vacio usamos <span className="font-mono">{AI_DEFAULT_MODELS[provider]}</span>.
        La key se guarda cifrada; nunca se muestra de vuelta.
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
            {initialModel ? 'Guardar' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
