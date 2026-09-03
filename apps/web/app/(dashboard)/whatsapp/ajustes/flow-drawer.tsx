'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  WA_FLOW_HELP,
  WA_FLOW_LABEL,
  type WaConfigOverview,
  type WaFlow,
  type WaFlowConfig,
  type WaFlowKind,
  type WaLineSummary,
  type WaTemplateListForLine,
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
  FOCUS_RING,
  SideDrawer,
} from '../../settings/settings-ui';

/** Una apertura del panel. `flow` null = regla nueva de ese tipo. */
export interface FlowSession {
  id: string;
  kind: WaFlowKind;
  flow: WaFlow | null;
}

const FIELD_CLS =
  'h-auto min-h-[38px] rounded-[10px] border-input bg-card text-[13px] shadow-none transition-colors [transition-duration:140ms] placeholder:text-hint hover:border-accent';
const LABEL_CLS = 'block text-[11px] font-bold uppercase tracking-[0.06em] text-hint';

/** Textos que se pueden ajustar en cada tipo. El resto sigue en codigo. */
const TEXT_FIELDS: Record<
  WaFlowKind,
  Array<{ key: keyof WaFlowConfig; label: string; help?: string; long?: boolean }>
> = {
  confirmation: [],
  guide: [],
  upsell: [
    { key: 'step1Text', label: 'Primer toque', long: true },
    { key: 'step2Text', label: 'Segundo toque', long: true },
  ],
  // La respuesta al confirmar la manda el BOT, no la confirmacion: se edita
  // aqui porque es aqui donde se lee.
  autoreply: [
    {
      key: 'confirmedReply',
      label: 'Cuando el cliente confirma',
      help: 'Lo que se le contesta al tocar «Mis datos son correctos».',
      long: true,
    },
    { key: 'askAddress', label: 'Cuando pide la dirección nueva', long: true },
    { key: 'retryAddress', label: 'Si la dirección no se entiende', long: true },
  ],
};

/**
 * Editor de un mensaje automatico: por que linea sale, a que pedidos aplica y
 * sus textos. Lo que se deja vacio usa el texto que trae el sistema.
 */
export function FlowDrawer({
  session,
  data,
  onClose,
}: {
  session: FlowSession | null;
  data: WaConfigOverview;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const flow = session?.flow ?? null;
  const kind = session?.kind ?? 'confirmation';

  const [lineId, setLineId] = useState(
    flow?.lineId ?? data.lines.find((l) => l.isDefault)?.id ?? data.lines[0]?.id ?? '',
  );
  const [scope, setScope] = useState<string[]>(flow?.scope ?? ['*']);
  const [config, setConfig] = useState<WaFlowConfig>(flow?.config ?? {});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['wa-config'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind,
        lineId,
        enabled: flow?.enabled ?? true,
        scope,
        config,
        priority: flow?.priority ?? 0,
      };
      return flow
        ? api.put<WaFlow>(`/v1/whatsapp/config/flows/${flow.id}`, body)
        : api.post<WaFlow>('/v1/whatsapp/config/flows', body);
    },
    onSuccess: () => done(flow ? 'Cambios guardados' : 'Regla creada'),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/whatsapp/config/flows/${flow!.id}`),
    onSuccess: () => done('Regla eliminada'),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar'),
  });

  const busy = save.isPending || remove.isPending;
  const all = scope.includes('*');

  const toggleSource = (key: string) => {
    setScope((prev) => {
      const without = prev.filter((s) => s !== '*');
      return without.includes(key)
        ? // Quitar la ultima dejaria una regla que no aplica a nadie.
          without.filter((s) => s !== key).length > 0
          ? without.filter((s) => s !== key)
          : ['*']
        : [...without, key];
    });
  };

  const fields = TEXT_FIELDS[kind];

  return (
    <SideDrawer
      open={session !== null}
      busy={busy}
      title={WA_FLOW_LABEL[kind]}
      subtitle={flow ? 'Editando una regla' : 'Nueva regla'}
      onClose={onClose}
      footer={
        <>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={busy || !lineId}
            className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
          >
            Guardar
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
          >
            Cancelar
          </Button>
          {flow ? (
            <Button
              variant="ghost"
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
              loading={remove.isPending}
              disabled={busy}
              className={cn(
                BTN_GHOST_CLS,
                BTN_SM_CLS,
                'ml-auto',
                confirmDelete && 'border-destructive text-destructive hover:text-destructive',
              )}
            >
              {confirmDelete ? '¿Seguro? Sí, eliminar' : 'Eliminar regla'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-[11px] bg-wash px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-accent-ink">
          {WA_FLOW_HELP[kind]}
        </p>

        {/* Línea: solo importa cuando hay más de una. */}
        {data.lines.length > 1 ? (
          <div>
            <Label className={LABEL_CLS}>Sale por</Label>
            <div className="mt-1.5 grid gap-1.5">
              {data.lines.map((l) => (
                <LinePick key={l.id} line={l} on={lineId === l.id} onPick={() => setLineId(l.id)} />
              ))}
            </div>
          </div>
        ) : null}

        {/* Alcance: solo cuando hay a qué apuntar. */}
        {data.showScope && data.sources.length > 0 ? (
          <div>
            <Label className={LABEL_CLS}>Aplica a</Label>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-hint">
              Si eliges tiendas concretas, los pedidos de las demás no reciben este mensaje.
            </p>
            <div className="mt-2 grid gap-1.5">
              <Check on={all} label="Todos los pedidos" onToggle={() => setScope(['*'])} />
              {data.sources.map((s) => (
                <Check
                  key={s.key}
                  on={!all && scope.includes(s.key)}
                  label={s.label}
                  onToggle={() => toggleSource(s.key)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Frescura, solo en la confirmación. */}
        {kind === 'confirmation' ? (
          <div>
            <Label className={LABEL_CLS} htmlFor="maxAge">
              No enviar a pedidos de más de
            </Label>
            <div className="relative mt-1.5 max-w-[180px]">
              <Input
                id="maxAge"
                inputMode="numeric"
                placeholder="48"
                value={config.maxAgeHours != null ? String(config.maxAgeHours) : ''}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ''));
                  setConfig((c) => ({ ...c, maxAgeHours: n > 0 ? n : undefined }));
                }}
                className={cn(FIELD_CLS, 'pr-[62px] tabular-nums')}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-hint">
                horas
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-hint">
              Evita que una resincronización le escriba a clientes de hace semanas. Vacío = 48.
            </p>
          </div>
        ) : null}

        {/* Espera entre toques, solo en el respaldo. */}
        {kind === 'upsell' ? (
          <div>
            <Label className={LABEL_CLS} htmlFor="delay">
              Espera entre toques
            </Label>
            <div className="relative mt-1.5 max-w-[180px]">
              <Input
                id="delay"
                inputMode="numeric"
                placeholder="2"
                value={config.stepDelayMinutes != null ? String(config.stepDelayMinutes) : ''}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ''));
                  setConfig((c) => ({ ...c, stepDelayMinutes: n > 0 ? n : undefined }));
                }}
                className={cn(FIELD_CLS, 'pr-[70px] tabular-nums')}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-hint">
                minutos
              </span>
            </div>
          </div>
        ) : null}

        {fields.map((f) => (
          <div key={String(f.key)}>
            <Label className={LABEL_CLS} htmlFor={String(f.key)}>
              {f.label}
            </Label>
            <textarea
              id={String(f.key)}
              rows={f.long ? 4 : 2}
              placeholder="Vacío = el texto que trae el sistema"
              value={(config[f.key] as string | undefined) ?? ''}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  [f.key]: e.target.value.trim() ? e.target.value : undefined,
                }))
              }
              className={cn(
                'mt-1.5 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2 text-[13px] leading-[1.5] outline-none transition-colors [transition-duration:140ms] placeholder:text-hint hover:border-accent',
                FOCUS_RING,
              )}
            />
            {f.help ? <p className="mt-1 text-[11.5px] text-hint">{f.help}</p> : null}
          </div>
        ))}

        {kind !== 'autoreply' ? (
          <TemplatePicker
            lineId={lineId}
            kind={kind}
            chosen={config.templateNames ?? []}
            onChange={(names) =>
              setConfig((c) => ({ ...c, templateNames: names.length ? names : undefined }))
            }
          />
        ) : null}

        {kind === 'guide' ? (
          <p className="text-[12px] leading-[1.5] text-hint">
            La plantilla se elige sola según la transportadora del envío (cada una tiene su enlace
            de rastreo), así que aquí no hay texto que ajustar.
          </p>
        ) : null}
      </div>
    </SideDrawer>
  );
}

function LinePick({ line, on, onPick }: { line: WaLineSummary; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-left text-[13px] transition-colors [transition-duration:140ms]',
        on ? 'border-accent ring-1 ring-accent' : 'border-input hover:border-accent',
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
          on ? 'border-accent' : 'border-input',
        )}
      >
        {on ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">{line.label}</span>
      <span className="shrink-0 text-[11.5px] text-hint">
        {line.provider === 'meta' ? 'Meta' : '360dialog'}
      </span>
    </button>
  );
}

function Check({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-left text-[13px] transition-colors [transition-duration:140ms]',
        on ? 'border-accent ring-1 ring-accent' : 'border-input hover:border-accent',
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] font-black text-accent-foreground',
          on ? 'border-accent bg-accent' : 'border-input',
        )}
      >
        {on ? '✓' : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
    </button>
  );
}

/**
 * Que PLANTILLA usa este mensaje automatico.
 *
 * Se guarda una LISTA por orden de preferencia, no una sola: Meta puede tener
 * una plantilla en revision o desactivarla sin avisar, y con una sola elegida
 * el mensaje simplemente dejaria de salir. Gana la primera que este aprobada
 * en el momento de enviar; vacio = las que trae el sistema.
 */
function TemplatePicker({
  lineId,
  kind,
  chosen,
  onChange,
}: {
  lineId: string;
  kind: WaFlowKind;
  chosen: string[];
  onChange: (names: string[]) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wa-templates', lineId],
    queryFn: () =>
      api.get<WaTemplateListForLine>(
        `/v1/whatsapp/config/templates?line=${encodeURIComponent(lineId)}`,
      ),
    enabled: Boolean(lineId),
  });

  // Solo las aprobadas: ofrecer una pendiente seria ofrecer un mensaje que no
  // va a salir. Las ya elegidas van primero, en su orden de preferencia.
  const approved = (data?.templates ?? []).filter((t) => t.status === 'approved');
  const picked = chosen
    .map((n) => approved.find((t) => t.name === n))
    .filter((t): t is (typeof approved)[number] => Boolean(t));
  const sorted = [...picked, ...approved.filter((t) => !chosen.includes(t.name))];

  const toggle = (name: string) =>
    onChange(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);

  return (
    <div>
      <Label className={LABEL_CLS}>Plantilla</Label>
      <p className="mt-1 text-[11.5px] leading-[1.45] text-hint">
        {kind === 'guide'
          ? 'Vacío = la que corresponda a la transportadora del envío.'
          : 'Vacío = la que trae el sistema. Si eliges varias, gana la primera aprobada.'}
      </p>
      {isLoading ? (
        <p className="mt-2 text-[12px] text-hint">Cargando…</p>
      ) : error ? (
        // "No pude preguntarle a la WABA" NO es lo mismo que "no hay
        // plantillas": confundirlos hace que un fallo de credenciales parezca
        // una cuenta vacia y nadie lo investiga.
        <p className="mt-2 text-[12px] text-destructive">
          {error instanceof ApiError ? error.message : 'No se pudieron cargar las plantillas.'}
        </p>
      ) : sorted.length === 0 ? (
        <p className="mt-2 text-[12px] text-hint">
          Esta línea no tiene plantillas aprobadas todavía.
        </p>
      ) : (
        <div className="mt-2 grid gap-1.5">
          {sorted.map((t, i) => {
            const order = chosen.indexOf(t.name);
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => toggle(t.name)}
                aria-pressed={order >= 0}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[10px] border bg-card px-3 py-2 text-left transition-colors [transition-duration:140ms]',
                  order >= 0
                    ? 'border-accent ring-1 ring-accent'
                    : 'border-input hover:border-accent',
                  FOCUS_RING,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] font-black',
                    order >= 0
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-input text-transparent',
                  )}
                >
                  {order >= 0 ? order + 1 : i}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block font-mono text-[12px] font-bold">{t.name}</b>
                  <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-[1.4] text-hint">
                    {t.body}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
