'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, MessageSquareReply, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  WA_TEMPLATE_CATEGORY_HELP,
  WA_TEMPLATE_CATEGORY_LABEL,
  waTemplateVars,
  type WaLineSummary,
  type WaTemplateButton,
  type WaTemplateCategory,
  type WaTemplateDetail,
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

const FIELD_CLS =
  'h-auto min-h-[38px] rounded-[10px] border-input bg-card text-[13px] shadow-none transition-colors [transition-duration:140ms] placeholder:text-hint hover:border-accent';
const LABEL_CLS = 'block text-[11px] font-bold uppercase tracking-[0.06em] text-hint';
const HELP_CLS = 'mt-1.5 text-[11.5px] leading-[1.45] text-hint';

/** Que abre el panel: una plantilla nueva, o una copia de otra. */
export type TemplateSeed = {
  /** Cambia en cada apertura: fuerza que el formulario nazca limpio. */
  key: string;
  lineId: string;
  /** Plantilla de la que se copia (null = en blanco). */
  template: WaTemplateDetail | null;
};

const CATEGORIES: WaTemplateCategory[] = ['UTILITY', 'MARKETING'];

/**
 * Crear una plantilla.
 *
 * No hay "editar" a proposito: ni Meta ni 360dialog dejan cambiarle el cuerpo a
 * una plantilla ya creada. Por eso la accion de la lista es "Duplicar", que
 * trae aqui una copia con otro nombre — y la de siempre se puede borrar despues.
 */
export function TemplateDrawer({
  seed,
  lines,
  onClose,
}: {
  seed: TemplateSeed | null;
  lines: WaLineSummary[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const src = seed?.template ?? null;
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [lineId, setLineId] = useState(seed?.lineId ?? lines[0]?.id ?? '');
  const [name, setName] = useState(src ? `${src.name}_v2`.slice(0, 60) : '');
  const [category, setCategory] = useState<WaTemplateCategory>(
    src && CATEGORIES.includes(src.category as WaTemplateCategory)
      ? (src.category as WaTemplateCategory)
      : 'UTILITY',
  );
  const [header, setHeader] = useState(src?.header?.format === 'TEXT' ? src.header.text : '');
  const [body, setBody] = useState(src?.body ?? '');
  const [footer, setFooter] = useState(src?.footer ?? '');
  const [examples, setExamples] = useState<string[]>(src?.examples ?? []);
  const [buttons, setButtons] = useState<WaTemplateButton[]>(src?.buttons ?? []);

  // Las variables mandan: los ejemplos se recortan o se rellenan segun el
  // cuerpo, para que nunca sobre ni falte uno.
  const varCount = useMemo(() => waTemplateVars(body).length, [body]);
  const shownExamples = useMemo(
    () => Array.from({ length: varCount }, (_, i) => examples[i] ?? ''),
    [examples, varCount],
  );
  const orderedVars = useMemo(() => {
    const nums = waTemplateVars(body);
    return nums.join(',') === nums.map((_, i) => i + 1).join(',');
  }, [body]);

  const create = useMutation({
    mutationFn: () =>
      api.post<WaTemplateDetail>('/v1/whatsapp/config/templates', {
        lineId,
        name: name.trim(),
        language: 'es',
        category,
        ...(header.trim() ? { header: header.trim() } : {}),
        body: body.trim(),
        examples: shownExamples.map((v) => v.trim()),
        ...(footer.trim() ? { footer: footer.trim() } : {}),
        buttons: buttons.map((b) => ({
          type: b.type,
          text: b.text.trim(),
          ...(b.type === 'URL' ? { url: (b.url ?? '').trim() } : {}),
        })),
      }),
    onSuccess: (tpl) => {
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
      toast.success(
        tpl.status === 'approved'
          ? `"${tpl.name}" ya está aprobada`
          : `"${tpl.name}" enviada a Meta. Podrás usarla cuando la apruebe.`,
      );
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo crear'),
  });

  const problem = firstProblem({ name, body, varCount, shownExamples, buttons, orderedVars });

  /** Mete {{n}} donde está el cursor, no al final del texto. */
  const insertVar = () => {
    const el = bodyRef.current;
    const token = `{{${varCount + 1}}}`;
    if (!el) {
      setBody((v) => v + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const addButton = (type: WaTemplateButton['type']) => {
    // Meta rechaza mezclar respuestas rápidas con enlaces: al cambiar de tipo
    // se reemplaza la lista en vez de dejar una mezcla que va a rebotar.
    setButtons((prev) => {
      const same = prev.filter((b) => b.type === type);
      return [...same, { type, text: '', ...(type === 'URL' ? { url: '' } : {}) }].slice(0, 3);
    });
  };

  return (
    <SideDrawer
      open={Boolean(seed)}
      busy={create.isPending}
      title={src ? 'Duplicar plantilla' : 'Nueva plantilla'}
      subtitle={
        src
          ? 'Meta no deja editar una plantilla ya creada: esto crea otra con los cambios'
          : 'Meta tiene que aprobarla antes de poder usarla'
      }
      onClose={onClose}
      footer={
        <>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={Boolean(problem) || create.isPending}
            className={cn(BTN_PRIMARY_CLS, BTN_SM_CLS)}
          >
            Enviar a Meta
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
      }
    >
      <div className="space-y-5">
        {lines.length > 1 ? (
          <div>
            <Label className={LABEL_CLS}>Línea</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {lines.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLineId(l.id)}
                  aria-pressed={l.id === lineId}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] font-bold transition-colors [transition-duration:140ms]',
                    l.id === lineId
                      ? 'bg-wash-strong text-accent-ink'
                      : 'text-hint hover:bg-surface hover:text-foreground',
                    FOCUS_RING,
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className={HELP_CLS}>Las plantillas son de la línea: no se comparten entre números.</p>
          </div>
        ) : null}

        <div>
          <Label className={LABEL_CLS} htmlFor="tpl-name">
            Nombre
          </Label>
          <Input
            id="tpl-name"
            autoFocus
            value={name}
            maxLength={60}
            placeholder="confirmacion_pedido"
            onChange={(e) => setName(slug(e.target.value))}
            className={cn(FIELD_CLS, 'mt-1.5 font-mono')}
          />
          <p className={HELP_CLS}>
            Solo minúsculas, números y guion bajo. No lo ve el cliente y{' '}
            <b className="text-hint">no se puede cambiar después</b>.
          </p>
        </div>

        <div>
          <Label className={LABEL_CLS}>Para qué es</Label>
          <div className="mt-1.5 grid gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-left transition-colors [transition-duration:140ms]',
                  category === c ? 'border-accent ring-1 ring-accent' : 'border-input hover:border-accent',
                  FOCUS_RING,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                    category === c ? 'border-accent' : 'border-input',
                  )}
                >
                  {category === c ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold">
                    {WA_TEMPLATE_CATEGORY_LABEL[c]}
                  </b>
                  <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-hint">
                    {WA_TEMPLATE_CATEGORY_HELP[c]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className={LABEL_CLS} htmlFor="tpl-header">
            Título <span className="font-normal normal-case text-hint">(opcional)</span>
          </Label>
          <Input
            id="tpl-header"
            value={header}
            maxLength={60}
            placeholder="Tu pedido va en camino"
            onChange={(e) => setHeader(e.target.value)}
            className={cn(FIELD_CLS, 'mt-1.5')}
          />
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className={LABEL_CLS} htmlFor="tpl-body">
              Mensaje
            </Label>
            <button
              type="button"
              onClick={insertVar}
              className={cn(
                'rounded-[7px] bg-wash px-2 py-0.5 text-[11px] font-bold text-accent-ink transition-colors [transition-duration:140ms] hover:bg-wash-strong',
                FOCUS_RING,
              )}
            >
              + Insertar dato del pedido
            </button>
          </div>
          <textarea
            id="tpl-body"
            ref={bodyRef}
            value={body}
            maxLength={1024}
            rows={7}
            placeholder={'¡Hola {{1}}! Tu pedido de {{2}} ya salió.'}
            onChange={(e) => setBody(e.target.value)}
            className={cn(
              FIELD_CLS,
              'mt-1.5 w-full resize-y border px-3 py-2 leading-[1.55]',
              FOCUS_RING,
            )}
          />
          <p className={HELP_CLS}>
            {body.length}/1024 · Los huecos <code className="font-mono">{'{{1}}'}</code>,{' '}
            <code className="font-mono">{'{{2}}'}</code>… se rellenan al enviar con los datos de
            cada pedido.
          </p>
          {!orderedVars ? (
            <p className="mt-1 text-[12px] text-destructive">
              Los huecos tienen que ir en orden: {'{{1}}'}, {'{{2}}'}, {'{{3}}'}…
            </p>
          ) : null}
        </div>

        {varCount > 0 ? (
          <div>
            <Label className={LABEL_CLS}>Ejemplos</Label>
            <p className={cn(HELP_CLS, 'mb-1.5 mt-0')}>
              Meta los exige para aprobar: pon un valor real de muestra para cada hueco.
            </p>
            <div className="grid gap-1.5">
              {shownExamples.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-11 shrink-0 font-mono text-[11.5px] text-hint">
                    {`{{${i + 1}}}`}
                  </span>
                  <Input
                    value={value}
                    maxLength={200}
                    placeholder={EXAMPLE_HINTS[i] ?? 'Valor de muestra'}
                    onChange={(e) =>
                      setExamples((prev) => {
                        const next = Array.from({ length: varCount }, (_, k) => prev[k] ?? '');
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    className={cn(FIELD_CLS, 'flex-1')}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <Label className={LABEL_CLS} htmlFor="tpl-footer">
            Pie <span className="font-normal normal-case text-hint">(opcional)</span>
          </Label>
          <Input
            id="tpl-footer"
            value={footer}
            maxLength={60}
            placeholder="Smart Gadgets"
            onChange={(e) => setFooter(e.target.value)}
            className={cn(FIELD_CLS, 'mt-1.5')}
          />
        </div>

        <div>
          <Label className={LABEL_CLS}>Botones</Label>
          <div className="mt-1.5 grid gap-1.5">
            {buttons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  value={b.text}
                  maxLength={25}
                  placeholder={b.type === 'URL' ? 'Ver mi envío' : 'Sí, es correcto'}
                  onChange={(e) =>
                    setButtons((prev) =>
                      prev.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                  className={cn(FIELD_CLS, 'min-w-[140px] flex-1')}
                />
                {b.type === 'URL' ? (
                  <Input
                    value={b.url ?? ''}
                    maxLength={2000}
                    placeholder="https://..."
                    onChange={(e) =>
                      setButtons((prev) =>
                        prev.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)),
                      )
                    }
                    className={cn(FIELD_CLS, 'min-w-[160px] flex-1')}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => setButtons((prev) => prev.filter((_, k) => k !== i))}
                  aria-label="Quitar botón"
                  className={cn(BTN_GHOST_CLS, BTN_SM_CLS, 'shrink-0 hover:text-destructive')}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {buttons.length < 3 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                variant="ghost"
                onClick={() => addButton('QUICK_REPLY')}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              >
                <MessageSquareReply />
                Respuesta rápida
              </Button>
              <Button
                variant="ghost"
                onClick={() => addButton('URL')}
                className={cn(BTN_GHOST_CLS, BTN_SM_CLS)}
              >
                <Link2 />
                Enlace
              </Button>
            </div>
          ) : null}
          <p className={HELP_CLS}>
            Hasta 3, todos del mismo tipo: Meta rechaza mezclar respuestas rápidas con enlaces.
          </p>
        </div>

        {/* ── Cómo le llega al cliente ── */}
        <div>
          <Label className={LABEL_CLS}>Así le llega</Label>
          <div className="mt-1.5 rounded-[13px] bg-wash p-3">
            <div className="max-w-[300px] rounded-[12px] rounded-tl-[4px] bg-card px-3 py-2.5 shadow-sm">
              {header.trim() ? (
                <p className="mb-1 text-[12.5px] font-extrabold">{header.trim()}</p>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.55]">
                {preview(body, shownExamples) || (
                  <span className="text-hint">Escribe el mensaje…</span>
                )}
              </p>
              {footer.trim() ? (
                <p className="mt-1.5 text-[11px] text-hint">{footer.trim()}</p>
              ) : null}
              {buttons.length > 0 ? (
                <div className="mt-2 grid gap-1 border-t border-border pt-2">
                  {buttons.map((b, i) => (
                    <span
                      key={i}
                      className="rounded-[7px] py-1 text-center text-[12px] font-bold text-accent"
                    >
                      {b.text.trim() || 'Botón'}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {problem ? <p className="text-[12px] text-destructive">{problem}</p> : null}

        <p className="rounded-[11px] bg-surface px-3.5 py-2.5 text-[12px] leading-[1.5] text-muted-foreground">
          Meta la revisa antes de dejarte usarla. Suele tardar unos minutos, a veces horas. Mientras
          esté esperando aparecerá en la lista, pero no se podrá enviar.
        </p>
      </div>
    </SideDrawer>
  );
}

/** Sugerencias para los tres datos que más se usan, en orden. */
const EXAMPLE_HINTS = ['DAVID CASTRO', '1 IPHONE 17 PRO MAX 256', 'CALLE 16 # 23-71 CENTRO'];

/** Nombre válido para Meta mientras se teclea. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 60);
}

/** El cuerpo con los ejemplos puestos, como lo verá el cliente. */
function preview(body: string, examples: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => examples[Number(n) - 1]?.trim() || m);
}

/** El PRIMER motivo por el que no se puede enviar. Uno solo: sobra la lista. */
function firstProblem(v: {
  name: string;
  body: string;
  varCount: number;
  shownExamples: string[];
  buttons: WaTemplateButton[];
  orderedVars: boolean;
}): string | null {
  if (v.name.trim().length < 3) return 'Ponle un nombre de al menos 3 caracteres.';
  if (!v.body.trim()) return 'El mensaje no puede estar vacío.';
  if (!v.orderedVars) return 'Arregla el orden de los huecos.';
  if (v.shownExamples.some((e) => !e.trim())) return 'Falta un ejemplo para cada hueco.';
  if (v.buttons.some((b) => !b.text.trim())) return 'Hay un botón sin texto.';
  if (v.buttons.some((b) => b.type === 'URL' && !/^https?:\/\/.+/.test((b.url ?? '').trim()))) {
    return 'Pon el enlace completo del botón (https://...).';
  }
  return null;
}
