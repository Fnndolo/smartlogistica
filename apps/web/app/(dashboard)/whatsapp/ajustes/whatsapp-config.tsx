'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, MessageCircle, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  WA_FLOW_HELP,
  WA_FLOW_LABEL,
  type WaConfigOverview,
  type WaFlow,
  type WaFlowKind,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  BTN_SM_CLS,
  CARD_CLS,
  EMPTY_CLS,
  PageHead,
  Pill,
  SectionHead,
  tileCls,
} from '../../settings/settings-ui';

const KINDS: WaFlowKind[] = ['confirmation', 'guide', 'upsell', 'autoreply'];

/**
 * Los numeros conectados y los mensajes automaticos.
 *
 * Lo importante de esta pantalla: mientras un flujo NO tenga fila propia, se
 * comporta exactamente como estaba cableado en codigo. Por eso existe el boton
 * "Tomar el control": crea las filas con lo que hoy hace el sistema, sin
 * cambiar nada, y a partir de ahi ya se pueden apagar y ajustar.
 */
export function WhatsappConfig({ initial }: { initial?: WaConfigOverview }) {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wa-config'],
    queryFn: () => api.get<WaConfigOverview>('/v1/whatsapp/config'),
    initialData: initial,
    refetchOnMount: 'always',
  });

  const materialize = useMutation({
    mutationFn: () => api.post<WaConfigOverview>('/v1/whatsapp/config/materialize', {}),
    onSuccess: (res) => {
      qc.setQueryData(['wa-config'], res);
      toast.success('Listo: ya puedes encender y apagar cada mensaje');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo preparar la configuración'),
  });

  const byKind = useMemo(() => {
    const map = new Map<WaFlowKind, WaFlow[]>();
    for (const f of data?.flows ?? []) {
      const list = map.get(f.kind) ?? [];
      list.push(f);
      map.set(f.kind, list);
    }
    return map;
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={EMPTY_CLS}>
        {error instanceof ApiError ? error.message : 'No se pudo cargar la configuración.'}
        <div className="mt-3">
          <Button
            variant="ghost"
            onClick={() => refetch()}
            className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
          >
            Reintentar
          </Button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const pending = data.unconfigured.length > 0;

  return (
    <div className="space-y-[22px]">
      <PageHead
        title="WhatsApp"
        description="Los números conectados y los mensajes que salen solos."
      />

      {/* ── Líneas ── */}
      <section className="space-y-2.5">
        <SectionHead>Líneas</SectionHead>
        {data.lines.length === 0 ? (
          <div className={EMPTY_CLS}>
            Todavía no hay ningún número conectado. Conéctalo desde{' '}
            <b className="text-muted-foreground">Conexiones</b>.
          </div>
        ) : (
          <div className="grid gap-2.5">
            {data.lines.map((l) => (
              <div key={l.id} className={cn(CARD_CLS, 'flex flex-wrap items-center gap-3')}>
                <span className={tileCls('cobalt')}>
                  <Phone />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[13.5px] font-extrabold">{l.label}</b>
                    {l.isDefault ? <Pill tone="cobalt">Predeterminada</Pill> : null}
                    {l.status === 'error' ? (
                      <Pill tone="bad" dot>
                        Con error
                      </Pill>
                    ) : (
                      <Pill tone="ok" dot>
                        Conectada
                      </Pill>
                    )}
                  </div>
                  <p className="mt-[3px] text-[12px] text-muted-foreground">
                    {l.provider === 'meta' ? 'API de Meta' : '360dialog'}
                    <span className="px-1.5 text-border">·</span>
                    {l.mode === 'sandbox' ? 'Pruebas' : 'Producción'}
                    {l.phone ? (
                      <>
                        <span className="px-1.5 text-border">·</span>
                        <span className="font-mono text-[11.5px]">{l.phone}</span>
                      </>
                    ) : null}
                  </p>
                  {l.lastError ? (
                    <p className="mt-1 text-[12px] text-destructive">{l.lastError}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Mensajes automáticos ── */}
      <section className="space-y-2.5">
        <SectionHead>Mensajes automáticos</SectionHead>

        {pending ? (
          <div className="flex flex-wrap items-start gap-3 rounded-[14px] border border-border bg-wash px-4 py-3.5">
            <Sparkles className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-extrabold text-accent-ink">
                Estos mensajes ya se están enviando, pero todavía no se pueden tocar
              </p>
              <p className="mt-1 max-w-[72ch] text-[12.5px] leading-[1.5] text-muted-foreground">
                Hoy están cableados en el sistema. Al tomar el control se guardan{' '}
                <b className="text-muted-foreground">tal y como funcionan ahora</b> — no cambia nada
                — y a partir de ahí puedes apagar los que no quieras y ajustar sus textos.
              </p>
            </div>
            <Button
              onClick={() => materialize.mutate()}
              loading={materialize.isPending}
              disabled={materialize.isPending || data.lines.length === 0}
              className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS, 'shrink-0')}
            >
              Tomar el control
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2.5">
          {KINDS.map((kind) => (
            <FlowRow
              key={kind}
              kind={kind}
              flows={byKind.get(kind) ?? []}
              showScope={data.showScope}
              sources={data.sources}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Una fila por tipo de mensaje: estado, a quién aplica e interruptor. */
function FlowRow({
  kind,
  flows,
  showScope,
  sources,
}: {
  kind: WaFlowKind;
  flows: WaFlow[];
  showScope: boolean;
  sources: WaConfigOverview['sources'];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (f: WaFlow) =>
      api.put<WaFlow>(`/v1/whatsapp/config/flows/${f.id}`, {
        kind: f.kind,
        lineId: f.lineId,
        enabled: !f.enabled,
        scope: f.scope,
        config: f.config,
        priority: f.priority,
      }),
    onSuccess: (f) => {
      toast.success(
        f.enabled ? `${WA_FLOW_LABEL[f.kind]}: encendido` : `${WA_FLOW_LABEL[f.kind]}: apagado`,
      );
      qc.invalidateQueries({ queryKey: ['wa-config'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar'),
    onSettled: () => setBusy(null),
  });

  const labelFor = (key: string): string =>
    key === '*' ? 'Todos los pedidos' : (sources.find((s) => s.key === key)?.label ?? key);

  // Sin fila propia: sigue funcionando con lo que hay cableado en el sistema.
  if (flows.length === 0) {
    return (
      <div className={cn(CARD_CLS, 'flex flex-wrap items-center gap-3')}>
        <span className={tileCls('muted')}>
          <MessageCircle />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px] font-extrabold">{WA_FLOW_LABEL[kind]}</b>
            <Pill tone="muted">Como viene de fábrica</Pill>
          </div>
          <p className="mt-1 max-w-[72ch] text-[12px] text-muted-foreground">
            {WA_FLOW_HELP[kind]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(CARD_CLS, 'space-y-2.5')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={tileCls(flows.some((f) => f.enabled) ? 'cobalt' : 'muted')}>
          <MessageCircle />
        </span>
        <div className="min-w-0 flex-1">
          <b className="text-[13.5px] font-extrabold">{WA_FLOW_LABEL[kind]}</b>
          <p className="mt-1 max-w-[72ch] text-[12px] text-muted-foreground">
            {WA_FLOW_HELP[kind]}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {flows.map((f) => (
          <div
            key={f.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] border border-border bg-surface px-3.5 py-2.5"
          >
            <div className="min-w-0 flex-1">
              {showScope ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {f.scope.map((s) => (
                    <Pill key={s} tone={s === '*' ? 'muted' : 'cobalt'}>
                      {labelFor(s)}
                    </Pill>
                  ))}
                </div>
              ) : (
                <span className="text-[12.5px] text-muted-foreground">
                  Aplica a todos los pedidos
                </span>
              )}
              <p className="mt-1 text-[11.5px] text-hint">
                Sale por <b className="text-muted-foreground">{f.lineLabel}</b>
              </p>
            </div>

            <Switch
              on={f.enabled}
              busy={busy === f.id}
              label={`${f.enabled ? 'Apagar' : 'Encender'} ${WA_FLOW_LABEL[kind]}`}
              onToggle={() => {
                setBusy(f.id);
                toggle.mutate(f);
              }}
            />
          </div>
        ))}
      </div>

      {!flows.some((f) => f.enabled) ? (
        <p className="flex items-start gap-2.5 rounded-[11px] bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
          <span>
            Apagado: a los clientes ya no les llega este mensaje. Nadie recibirá aviso de que dejó
            de enviarse.
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Interruptor, mismo lenguaje que el de recaudo del panel de guía. */
function Switch({
  on,
  busy,
  label,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-2.5 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60 max-md:min-h-[40px]"
    >
      <span
        className={cn(
          'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors motion-reduce:transition-none',
          on ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-input',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-[left] motion-reduce:transition-none',
            on ? 'left-[19px]' : 'left-[3px]',
          )}
        />
      </span>
      <b className="text-[12.5px]">{on ? 'Encendido' : 'Apagado'}</b>
    </button>
  );
}
