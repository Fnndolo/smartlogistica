'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  WA_FLOW_LABEL,
  WA_TEMPLATE_CATEGORY_LABEL,
  type WaLineSummary,
  type WaTemplateCategory,
  type WaTemplateDetail,
  type WaTemplateListForLine,
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
  FOCUS_RING,
  Pill,
  type PillTone,
  SectionHead,
  tileCls,
} from '../../settings/settings-ui';
import { TemplateDrawer, type TemplateSeed } from './template-drawer';

/** El modo de pruebas es de 360dialog: Meta no tiene, y ahi nunca aplica. */
function isD360Sandbox(line: WaLineSummary | undefined): boolean {
  return line?.provider === 'dialog360' && line.mode === 'sandbox';
}

/**
 * LAS PLANTILLAS de Meta.
 *
 * Fuera de la ventana de 24h no se le puede escribir a un cliente con texto
 * libre: solo con una plantilla que Meta haya aprobado. Viven en la WABA de
 * cada linea, no en nuestra base — por eso la lista se pide por linea y no
 * viene con el resto de la configuracion.
 */
export function TemplatesSection({ lines }: { lines: WaLineSummary[] }) {
  // Por defecto, la predeterminada; con varias lineas se puede cambiar.
  const [lineId, setLineId] = useState<string | null>(null);
  const [seed, setSeed] = useState<TemplateSeed | null>(null);

  const active = lines.find((l) => l.id === lineId) ?? lines.find((l) => l.isDefault) ?? lines[0];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wa-templates', active?.id ?? null],
    queryFn: () =>
      api.get<WaTemplateListForLine>(
        active ? `/v1/whatsapp/config/templates?line=${encodeURIComponent(active.id)}` : '',
      ),
    enabled: Boolean(active),
  });

  if (lines.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <SectionHead>Plantillas</SectionHead>
        </div>
        <Button
          onClick={() =>
            setSeed({ key: `nueva-${Date.now()}`, lineId: active?.id ?? '', template: null })
          }
          disabled={!active || isD360Sandbox(active)}
          className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS, 'shrink-0')}
        >
          <Plus />
          Crear plantilla
        </Button>
      </div>

      <p className="max-w-[78ch] text-[12.5px] leading-[1.55] text-muted-foreground">
        Si el cliente lleva más de 24 horas sin escribir, WhatsApp solo deja mandarle una plantilla
        aprobada por Meta. Aquí las ves todas y creas las que falten.
      </p>

      {lines.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {lines.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLineId(l.id)}
              aria-pressed={l.id === active?.id}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-bold transition-colors [transition-duration:140ms]',
                l.id === active?.id
                  ? 'bg-wash-strong text-accent-ink'
                  : 'text-hint hover:bg-surface hover:text-foreground',
                FOCUS_RING,
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}

      {isD360Sandbox(active) ? (
        <div className={EMPTY_CLS}>
          La línea de pruebas de 360dialog no tiene plantillas propias: usa las suyas.
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
        </div>
      ) : error ? (
        <div className={EMPTY_CLS}>
          {error instanceof ApiError ? error.message : 'No se pudieron cargar las plantillas.'}
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
      ) : (data?.templates.length ?? 0) === 0 ? (
        <div className={EMPTY_CLS}>
          <b className="text-foreground">
            {active?.provider === 'meta'
              ? 'Esta línea todavía no tiene ninguna plantilla.'
              : 'Tu proveedor no está devolviendo las plantillas de esta línea.'}
          </b>
          {active?.provider === 'meta' ? (
            active.status === 'pending' ? (
              <p className="mt-1.5">
                Puede que aún no hayas terminado de conectarla en el panel de Meta.
              </p>
            ) : null
          ) : (
            // Vacio NO es lo mismo que "no hay". Leer las plantillas y enviarlas
            // son permisos distintos en Meta, y el proveedor puede perder el
            // primero conservando el segundo: los mensajes automaticos siguen
            // saliendo mientras esta lista se ve vacia. Decir "no tienes
            // plantillas" ahi seria mentir.
            <p className="mx-auto mt-1.5 max-w-[62ch] leading-[1.55]">
              Puede que sigan existiendo en Meta y que tu proveedor haya perdido el permiso para
              leerlas. Los mensajes automáticos siguen saliendo igual, porque enviarlas solo
              necesita el nombre. Si acabas de reconectar el número, escríbeles.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5">
          {data?.templates.map((t) => (
            <TemplateCard
              key={`${t.name}:${t.language}`}
              tpl={t}
              lineId={active?.id ?? ''}
              onDuplicate={() =>
                setSeed({
                  key: `copia-${t.name}-${Date.now()}`,
                  lineId: active?.id ?? '',
                  template: t,
                })
              }
            />
          ))}
        </div>
      )}

      <TemplateDrawer
        key={seed?.key ?? 'cerrado'}
        seed={seed}
        lines={lines}
        onClose={() => setSeed(null)}
      />
    </section>
  );
}

/** Estados de Meta, en cristiano. */
const STATUS: Record<string, { label: string; tone: PillTone }> = {
  approved: { label: 'Aprobada', tone: 'ok' },
  pending: { label: 'Esperando a Meta', tone: 'warn' },
  submitted: { label: 'Esperando a Meta', tone: 'warn' },
  rejected: { label: 'Rechazada', tone: 'bad' },
  disabled: { label: 'Desactivada', tone: 'bad' },
  paused: { label: 'En pausa', tone: 'warn' },
};

function TemplateCard({
  tpl,
  lineId,
  onDuplicate,
}: {
  tpl: WaTemplateDetail;
  lineId: string;
  onDuplicate: () => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);

  const remove = useMutation({
    mutationFn: () =>
      api.delete(
        `/v1/whatsapp/config/templates/${encodeURIComponent(tpl.name)}?line=${encodeURIComponent(lineId)}`,
      ),
    onSuccess: () => {
      toast.success(`"${tpl.name}" borrada`);
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo borrar');
    },
  });

  const state = STATUS[tpl.status] ?? { label: tpl.status || 'Sin estado', tone: 'muted' as const };
  const category = WA_TEMPLATE_CATEGORY_LABEL[tpl.category as WaTemplateCategory] ?? tpl.category;

  return (
    <div className={CARD_CLS}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={tileCls(tpl.status === 'approved' ? 'cobalt' : 'muted')}>
          <FileText />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-mono text-[13px] font-extrabold">{tpl.name}</b>
            <Pill tone={state.tone} dot>
              {state.label}
            </Pill>
            {tpl.usedBy.length > 0 ? (
              <Pill tone="violet">{tpl.usedBy.map((k) => WA_FLOW_LABEL[k]).join(' · ')}</Pill>
            ) : null}
          </div>
          <p className="mt-[3px] text-[12px] text-muted-foreground">
            {category}
            <span className="px-1.5 text-border">·</span>
            {tpl.language}
            {tpl.variables > 0 ? (
              <>
                <span className="px-1.5 text-border">·</span>
                {tpl.variables} variable{tpl.variables === 1 ? '' : 's'}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button variant="ghost" onClick={onDuplicate} className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}>
            <Copy />
            Duplicar
          </Button>
          {confirm ? (
            <>
              <Button
                onClick={() => remove.mutate()}
                loading={remove.isPending}
                className={cn(
                  BTN_PRIMARY_CLS,
                  BTN_SM_CLS,
                  'bg-destructive text-destructive-foreground hover:bg-destructive',
                )}
              >
                Sí, borrar
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirm(false)}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              >
                No
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirm(true)}
              aria-label={`Borrar ${tpl.name}`}
              className={cn(BTN_GHOST_CLS, BTN_SM_CLS, 'hover:text-destructive')}
            >
              <Trash2 />
              Borrar
            </Button>
          )}
        </div>
      </div>

      {/* El mensaje tal cual lo ve el cliente. */}
      <div className="mt-3 rounded-[11px] bg-surface px-3.5 py-3">
        {tpl.header ? (
          <p className="mb-1.5 text-[12.5px] font-extrabold">
            {tpl.header.format === 'TEXT'
              ? tpl.header.text
              : `Encabezado con ${headerWord(tpl.header.format)}`}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.55]">{tpl.body}</p>
        {tpl.footer ? <p className="mt-1.5 text-[11.5px] text-hint">{tpl.footer}</p> : null}
        {tpl.buttons.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
            {tpl.buttons.map((b, i) => (
              <span
                key={`${b.text}-${i}`}
                className="rounded-[7px] bg-card px-2.5 py-1 text-[11.5px] font-bold text-accent"
              >
                {b.text}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {tpl.rejectedReason ? (
        <p className="mt-2 text-[12px] text-destructive">
          Meta la rechazó: {readableRejection(tpl.rejectedReason)}
        </p>
      ) : null}
    </div>
  );
}

function headerWord(format: string): string {
  if (format === 'IMAGE') return 'foto';
  if (format === 'VIDEO') return 'video';
  if (format === 'DOCUMENT') return 'archivo';
  return format.toLowerCase();
}

/** Los códigos de rechazo de Meta, en cristiano. */
function readableRejection(reason: string): string {
  const map: Record<string, string> = {
    ABUSIVE_CONTENT: 'contenido que considera abusivo',
    INCORRECT_CATEGORY: 'la categoría no corresponde con el contenido',
    INVALID_FORMAT: 'el formato no es válido (revisa variables y ejemplos)',
    SCAM: 'le pareció un intento de estafa',
    PROMOTIONAL: 'es promocional y está marcada como de servicio',
  };
  return map[reason] ?? reason.toLowerCase().replace(/_/g, ' ');
}
