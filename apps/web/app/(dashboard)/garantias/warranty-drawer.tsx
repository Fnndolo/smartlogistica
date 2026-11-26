'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  History,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  PackageCheck,
  Pencil,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  WARRANTY_ACCESSORY_LABEL,
  WARRANTY_DEVICE_LABEL,
  WARRANTY_FILE_TAG_LABEL,
  WARRANTY_RESOLUTION_LABEL,
  WARRANTY_STATUS_LABEL,
  WARRANTY_TRANSITIONS,
  warrantyResolutionSchema,
  type WarrantyDetail,
  type WarrantyEvent,
  type WarrantyFileTag,
  type WarrantyMessage,
  type WarrantyResolution,
  type WarrantyStatus,
  type WarrantySuggestions,
} from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { isAdmin } from '@/lib/rbac';
import { cn, titleCaseName } from '@/lib/utils';

import { ImageLightbox } from '../orders/image-lightbox';
import { Pill, TextArea, WarrantyFormDialog, uploadWarrantyFile } from './warranty-form';
import {
  AgeChip,
  WarrantyStatusBadge,
  WarrantyStepper,
  formatDay,
  formatMoment,
  radicado,
  todayIso,
} from './warranty-ui';

type Tab = 'conversacion' | 'detalle' | 'actividad';

const RESOLUTIONS = warrantyResolutionSchema.options;

/** Titulo y explicacion de cada cambio de estado (el dialogo y los botones). */
const TRANSITION_COPY: Record<
  WarrantyStatus,
  { title: string; action: string; hint: string; icon: typeof Truck }
> = {
  at_supplier: {
    title: 'Enviar al proveedor',
    action: 'Enviar a proveedor',
    hint: 'El equipo sale de la tienda hacia el proveedor o el servicio técnico.',
    icon: Truck,
  },
  ready: {
    title: 'Lista para entregar',
    action: 'Marcar lista',
    hint: 'El equipo ya está resuelto y espera a que el cliente lo recoja.',
    icon: PackageCheck,
  },
  closed: {
    title: 'Cerrar garantía',
    action: 'Cerrar garantía',
    hint: 'El cliente ya recibió su solución (o se le explicó que no procede).',
    icon: ShieldCheck,
  },
  received: {
    title: 'Devolver a Recibida',
    action: 'Devolver a Recibida',
    hint: 'El equipo vuelve a la tienda sin resolverse.',
    icon: ArrowLeft,
  },
};

/** El paso "natural" desde cada estado (el boton principal). */
const NEXT_STEP: Partial<Record<WarrantyStatus, WarrantyStatus>> = {
  received: 'at_supplier',
  at_supplier: 'ready',
  ready: 'closed',
};

export function WarrantyDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);

  // Entrada con transicion + Esc cierra + scroll de atras bloqueado.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div
        className={cn(
          'absolute inset-0 bg-scrim/55 backdrop-blur-[2px] transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'shadow-pop absolute right-0 top-0 flex h-full w-full flex-col bg-card transition-transform duration-200 ease-out md:w-[640px] md:border-l md:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <DrawerContent key={id} id={id} onClose={onClose} />
      </aside>
    </div>,
    document.body,
  );
}

function DrawerContent({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useCurrentUser();
  const [tab, setTab] = useState<Tab>('conversacion');
  const [transition, setTransition] = useState<WarrantyStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  const { data: w, error } = useQuery({
    queryKey: ['warranty', id],
    queryFn: () => api.get<WarrantyDetail>(`/v1/warranties/${id}`),
  });
  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['warranty-messages', id],
    queryFn: () => api.get<WarrantyMessage[]>(`/v1/warranties/${id}/messages`),
    staleTime: 0,
  });

  // Esc: primero cierra el dialogo de estado/edicion; si no hay, el panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || transition || editing) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, transition, editing]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : 'No se pudo abrir la garantía.'}
        </p>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }
  if (!w) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-hint" />
      </div>
    );
  }

  // Reabrir una cerrada es de administradores (el API tambien lo exige).
  const allowed =
    w.status === 'closed' && !isAdmin(me?.role) ? [] : WARRANTY_TRANSITIONS[w.status];
  const next = NEXT_STEP[w.status];
  const secondary = allowed.filter((s) => s !== next);

  return (
    <>
      {/* Cabecera */}
      <div className="border-b border-border">
        <div className="relative overflow-hidden px-4 pb-4 pt-4 md:px-5">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-10 left-0 h-32 w-full max-w-[420px] rounded-full bg-accent/[0.07] blur-3xl"
          />
          <div className="relative flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-semibold text-accent-ink">
                  {radicado(w.number)}
                </span>
                <WarrantyStatusBadge status={w.status} resolution={w.resolution} />
                <AgeChip
                  receivedAt={w.receivedAt}
                  closedAt={w.closedAt}
                  closed={w.status === 'closed'}
                />
              </div>
              <h2 className="mt-1.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em]">
                {titleCaseName(w.customerName)}
              </h2>
              <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                {w.brand} {w.model}
                <span className="mx-1.5 text-border">•</span>
                <span className="font-mono text-[11.5px]">{w.serial}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative mt-4">
            <WarrantyStepper status={w.status} events={w.events} />
          </div>

          {allowed.length > 0 ? (
            <div className="relative mt-4 flex flex-wrap items-center gap-2">
              {next && allowed.includes(next) ? (
                <Button size="sm" onClick={() => setTransition(next)}>
                  {(() => {
                    const Icon = TRANSITION_COPY[next].icon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                  {TRANSITION_COPY[next].action}
                </Button>
              ) : null}
              {secondary.map((s) => {
                const reopen = w.status === 'closed' && s === 'received';
                const Icon = reopen ? RotateCcw : TRANSITION_COPY[s].icon;
                return (
                  <Button key={s} size="sm" variant="outline" onClick={() => setTransition(s)}>
                    <Icon className="h-4 w-4" />
                    {reopen
                      ? 'Reabrir'
                      : s === 'at_supplier' && w.status === 'ready'
                        ? 'Devolver a proveedor'
                        : TRANSITION_COPY[s].action}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Pestañas */}
        <div className="flex gap-1 px-3 md:px-4">
          {(
            [
              { id: 'conversacion', label: 'Conversación', icon: MessageSquare },
              { id: 'detalle', label: 'Detalle', icon: Info },
              { id: 'actividad', label: 'Actividad', icon: History },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors',
                tab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.id === 'conversacion' && w.fileCount > 0 ? (
                <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                  {w.fileCount}
                </span>
              ) : null}
              {tab === t.id ? (
                <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido: las pestañas quedan montadas (borradores y scroll se conservan). */}
      <div className="relative min-h-0 flex-1">
        <div
          className={cn('absolute inset-0 flex flex-col', tab !== 'conversacion' && 'invisible')}
        >
          <Conversation
            warranty={w}
            messages={messages}
            loading={loadingMessages}
            meId={me?.id ?? ''}
          />
        </div>
        <div className={cn('absolute inset-0 overflow-y-auto', tab !== 'detalle' && 'invisible')}>
          <DetailTab warranty={w} messages={messages} onEdit={() => setEditing(true)} />
        </div>
        <div className={cn('absolute inset-0 overflow-y-auto', tab !== 'actividad' && 'invisible')}>
          <ActivityTab events={w.events} />
        </div>
      </div>

      {transition ? (
        <StatusDialog
          warranty={w}
          to={transition}
          onClose={() => setTransition(null)}
          onDone={() => {
            setTransition(null);
            void qc.invalidateQueries({ queryKey: ['warranty', id] });
            void qc.invalidateQueries({ queryKey: ['warranty-messages', id] });
            void qc.invalidateQueries({ queryKey: ['warranties'] });
          }}
        />
      ) : null}
      {editing ? (
        <WarrantyFormDialog
          initial={w}
          onClose={() => setEditing(false)}
          onSaved={(detail) => {
            setEditing(false);
            qc.setQueryData(['warranty', id], detail);
            void qc.invalidateQueries({ queryKey: ['warranties'] });
            void qc.invalidateQueries({ queryKey: ['warranty-messages', id] });
          }}
        />
      ) : null}
    </>
  );
}

// === Cambio de estado ===

/** Que archivo se pide en cada paso (va a la conversacion con esa etiqueta). */
const TRANSITION_TAG: Partial<Record<WarrantyStatus, WarrantyFileTag>> = {
  at_supplier: 'proveedor',
  ready: 'proveedor',
  closed: 'cierre',
};

function StatusDialog({
  warranty,
  to,
  onClose,
  onDone,
}: {
  warranty: WarrantyDetail;
  to: WarrantyStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const reopen = warranty.status === 'closed' && to === 'received';
  const copy = TRANSITION_COPY[to];
  const [supplier, setSupplier] = useState(warranty.supplier ?? '');
  const [sentAt, setSentAt] = useState(todayIso());
  const [resolution, setResolution] = useState<WarrantyResolution | null>(warranty.resolution);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tag = TRANSITION_TAG[to] ?? null;

  const { data: suggestions } = useQuery({
    queryKey: ['warranty-suggestions'],
    queryFn: () => api.get<WarrantySuggestions>('/v1/warranties/suggestions'),
    staleTime: 5 * 60_000,
  });

  const needsResolution = to === 'ready' || to === 'closed';
  const needsNote = to === 'closed' || to === 'received';
  const canSubmit =
    (to !== 'at_supplier' || supplier.trim().length > 0) &&
    (!needsResolution || resolution !== null) &&
    (!needsNote || note.trim().length > 0);

  const submit = useMutation({
    mutationFn: async () => {
      await api.post(`/v1/warranties/${warranty.id}/status`, {
        to,
        supplier: to === 'at_supplier' ? supplier.trim() : null,
        supplierSentAt: to === 'at_supplier' ? sentAt : null,
        resolution: needsResolution ? resolution : null,
        note: note.trim() || null,
      });
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        setProgress(`Subiendo ${i + 1} de ${files.length}…`);
        try {
          await uploadWarrantyFile(warranty.id, files[i]!, tag);
        } catch {
          failed++;
        }
      }
      setProgress(null);
      if (failed > 0)
        toast.error(`${failed} archivo(s) no se subieron: súbelos en la conversación.`);
    },
    onSuccess: () => {
      toast.success(
        reopen ? 'Garantía reabierta' : `Garantía: ${WARRANTY_STATUS_LABEL[to].toLowerCase()}`,
      );
      onDone();
    },
    onError: (err) => {
      setProgress(null);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado');
    },
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={submit.isPending ? undefined : onClose}
    >
      <div
        className="shadow-pop flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            {reopen ? <RotateCcw className="h-4 w-4" /> : <copy.icon className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight">
              {reopen ? 'Reabrir garantía' : copy.title}
            </h3>
            <p className="text-[11.5px] text-muted-foreground">
              {reopen ? 'Vuelve a quedar en trámite como Recibida.' : copy.hint}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {to === 'at_supplier' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Proveedor</Label>
                <Input
                  list="wd-suppliers"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="TECNOCELL"
                  autoComplete="off"
                />
                <datalist id="wd-suppliers">
                  {(suggestions?.suppliers ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de entrega</Label>
                <Input
                  type="date"
                  value={sentAt}
                  max={todayIso()}
                  onChange={(e) => setSentAt(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {needsResolution ? (
            <div className="space-y-1.5">
              <Label>¿Cómo se resolvió?</Label>
              <div className="flex flex-wrap gap-1.5">
                {RESOLUTIONS.map((r) => (
                  <Pill key={r} active={resolution === r} onClick={() => setResolution(r)}>
                    {WARRANTY_RESOLUTION_LABEL[r]}
                  </Pill>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>
              {to === 'closed'
                ? 'Nota de cierre'
                : to === 'received'
                  ? 'Motivo'
                  : 'Nota (opcional)'}
            </Label>
            <TextArea
              value={note}
              onChange={setNote}
              rows={3}
              placeholder={
                to === 'closed'
                  ? 'Se realiza cambio de dispositivo, IMEI nuevo 353754681052374'
                  : to === 'received'
                    ? 'El proveedor devolvió el equipo sin revisar'
                    : 'Guía o radicado del proveedor, observaciones…'
              }
            />
          </div>

          {tag ? (
            <div className="space-y-1.5">
              <Label>{WARRANTY_FILE_TAG_LABEL[tag]} (opcional)</Label>
              {files.length > 0 ? (
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12.5px]"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${f.name}`}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground transition hover:border-accent/50 hover:bg-accent/5 hover:text-foreground"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Adjuntar fotos, videos o PDF
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files;
                  if (list) setFiles((prev) => [...prev, ...Array.from(list)]);
                  e.target.value = '';
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-[11.5px] text-muted-foreground">{progress ?? ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submit.isPending}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => submit.mutate()}
              loading={submit.isPending}
              disabled={!canSubmit || submit.isPending}
            >
              {reopen ? 'Reabrir' : copy.action}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// === Conversacion ===

interface Pending {
  key: string;
  name: string;
  pct: number;
}

function Conversation({
  warranty,
  messages,
  loading,
  meId,
}: {
  warranty: WarrantyDetail;
  messages: WarrantyMessage[];
  loading: boolean;
  meId: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [tag, setTag] = useState<WarrantyFileTag | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const images = useMemo(
    () =>
      messages
        .filter((m) => m.attachmentUrl && m.attachmentMime?.startsWith('image/'))
        .map((m) => ({ id: m.id, url: m.attachmentUrl!, name: m.attachmentName, caption: m.body })),
    [messages],
  );

  // Siempre al final cuando llega algo nuevo (como un chat).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['warranty-messages', warranty.id] });
    void qc.invalidateQueries({ queryKey: ['warranty', warranty.id] });
    void qc.invalidateQueries({ queryKey: ['warranties'] });
  };

  const send = useMutation({
    mutationFn: (body: string) =>
      api.post<WarrantyMessage>(`/v1/warranties/${warranty.id}/messages`, { body }),
    onSuccess: (msg) => {
      setText('');
      qc.setQueryData<WarrantyMessage[]>(['warranty-messages', warranty.id], (old) =>
        old ? [...old, msg] : [msg],
      );
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar'),
  });

  /** Varios archivos de una: se suben en orden, cada uno con su barra. */
  const uploadAll = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const items = Array.from(list).map((file, i) => ({
      key: `${Date.now()}-${i}`,
      file,
    }));
    setPending((prev) => [
      ...prev,
      ...items.map((it) => ({ key: it.key, name: it.file.name, pct: 0 })),
    ]);
    let failed = 0;
    for (const it of items) {
      try {
        const msg = await uploadWarrantyFile(warranty.id, it.file, tag, (pct) =>
          setPending((prev) => prev.map((p) => (p.key === it.key ? { ...p, pct } : p))),
        );
        qc.setQueryData<WarrantyMessage[]>(['warranty-messages', warranty.id], (old) =>
          old ? [...old, msg] : [msg],
        );
      } catch {
        failed++;
      }
      setPending((prev) => prev.filter((p) => p.key !== it.key));
    }
    if (failed > 0) toast.error(`${failed} archivo(s) no se pudieron subir`);
    refresh();
  };

  const submitText = () => {
    const body = text.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  return (
    <>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-hint" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin mensajes todavía.</p>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              mine={m.authorId === meId}
              onOpenImage={(msgId) => setLightbox(images.findIndex((x) => x.id === msgId))}
            />
          ))
        )}
        {pending.map((p) => (
          <div key={p.key} className="flex justify-end">
            <div className="w-[230px] rounded-[14px] rounded-br-sm bg-accent/10 px-3 py-2.5">
              <p className="truncate text-[12.5px] font-medium">{p.name}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-accent/15">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${p.pct}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compositor */}
      <div className="border-t border-border px-3 pb-3 pt-2 md:px-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Los archivos van como:</span>
          <TagChip active={tag === null} onClick={() => setTag(null)}>
            General
          </TagChip>
          {(['recepcion', 'proveedor', 'cierre'] as const).map((t) => (
            <TagChip key={t} active={tag === t} onClick={() => setTag(t)}>
              {WARRANTY_FILE_TAG_LABEL[t]}
            </TagChip>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="Adjuntar fotos, videos o archivos"
            title="Adjuntar fotos, videos o archivos (varios a la vez)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Paperclip className="h-[18px] w-[18px]" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              void uploadAll(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
            rows={1}
            placeholder="Escribe una nota…"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={submitText}
            disabled={!text.trim() || send.isPending}
            aria-label="Enviar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm transition hover:brightness-110 disabled:opacity-40"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {lightbox !== null && lightbox >= 0 ? (
        <ImageLightbox
          images={images}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
        />
      ) : null}
    </>
  );
}

function TagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function MessageRow({
  message: m,
  mine,
  onOpenImage,
}: {
  message: WarrantyMessage;
  mine: boolean;
  onOpenImage: (messageId: string) => void;
}) {
  if (m.kind === 'system') {
    const [first, ...rest] = (m.body ?? '').split('\n');
    return (
      <div className="flex justify-center">
        <div className="max-w-[88%] rounded-xl border border-border bg-muted/40 px-3 py-2 text-center">
          <p className="text-[12px] font-medium text-foreground/85">{first}</p>
          {rest.length > 0 ? (
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-muted-foreground">
              {rest.join('\n')}
            </p>
          ) : null}
          <p className="mt-1 text-[10.5px] text-muted-foreground/80">
            {m.authorName} · {formatMoment(m.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {!mine ? (
        <span className="mb-0.5 px-1 text-[11px] font-medium text-muted-foreground">
          {m.authorName}
        </span>
      ) : null}
      {m.kind === 'file' ? (
        <FileBubble message={m} mine={mine} onOpenImage={onOpenImage} />
      ) : (
        <div
          className={cn(
            'max-w-[82%] whitespace-pre-wrap break-words rounded-[14px] px-3 py-2 text-[13.5px] leading-snug',
            mine
              ? 'rounded-br-sm bg-accent text-accent-foreground'
              : 'rounded-bl-sm bg-muted text-foreground',
          )}
        >
          {m.body}
        </div>
      )}
      <span className="mt-0.5 px-1 text-[10.5px] text-muted-foreground/80">
        {formatMoment(m.createdAt)}
      </span>
    </div>
  );
}

function FileBubble({
  message: m,
  mine,
  onOpenImage,
}: {
  message: WarrantyMessage;
  mine: boolean;
  onOpenImage: (messageId: string) => void;
}) {
  const mime = m.attachmentMime ?? '';
  const tone = mine
    ? 'rounded-br-sm bg-accent text-accent-foreground'
    : 'rounded-bl-sm bg-muted text-foreground';
  const tagLabel = m.tag ? WARRANTY_FILE_TAG_LABEL[m.tag] : null;
  const caption = m.body ? (
    <p className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-snug">{m.body}</p>
  ) : null;
  const tagChip = tagLabel ? (
    <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
      {tagLabel}
    </span>
  ) : null;

  if (m.attachmentUrl && mime.startsWith('image/')) {
    return (
      <div className={cn('w-[230px] max-w-full overflow-hidden rounded-[14px]', tone)}>
        <button
          type="button"
          onClick={() => onOpenImage(m.id)}
          className="relative block w-full cursor-zoom-in bg-muted"
          title={m.attachmentName ?? undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.attachmentUrl}
            alt={m.attachmentName ?? 'Foto'}
            decoding="async"
            className="h-auto max-h-64 w-full object-cover"
          />
          {tagChip}
        </button>
        {caption}
      </div>
    );
  }
  if (m.attachmentUrl && mime.startsWith('video/')) {
    return (
      <div className={cn('relative w-[230px] max-w-full overflow-hidden rounded-[14px]', tone)}>
        <video
          src={m.attachmentUrl}
          controls
          preload="metadata"
          className="max-h-64 w-full bg-black"
        />
        {tagChip}
        {caption}
      </div>
    );
  }
  const name = m.attachmentName ?? 'archivo';
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? 'file').toUpperCase();
  return (
    <div className={cn('w-[230px] max-w-full overflow-hidden rounded-[14px]', tone)}>
      <a
        href={m.attachmentUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 px-3 py-2.5"
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[9px] font-bold tracking-wide',
            mine ? 'bg-accent-foreground/20' : 'bg-muted-foreground/15 text-muted-foreground',
          )}
        >
          {ext.slice(0, 4)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p
            className={cn(
              'text-[11px]',
              mine ? 'text-accent-foreground/70' : 'text-muted-foreground',
            )}
          >
            {tagLabel ?? 'Toca para abrir'}
          </p>
        </div>
        <Download className="h-4 w-4 shrink-0 opacity-80" />
      </a>
      {caption}
    </div>
  );
}

// === Detalle ===

function DetailTab({
  warranty: w,
  messages,
  onEdit,
}: {
  warranty: WarrantyDetail;
  messages: WarrantyMessage[];
  onEdit: () => void;
}) {
  const files = messages.filter((m) => m.kind === 'file');
  const [lightbox, setLightbox] = useState<number | null>(null);
  const images = files
    .filter((m) => m.attachmentUrl && m.attachmentMime?.startsWith('image/'))
    .map((m) => ({ id: m.id, url: m.attachmentUrl!, name: m.attachmentName, caption: m.body }));

  return (
    <div className="space-y-6 px-4 py-5 md:px-5">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Editar datos
        </Button>
      </div>

      <DetailSection title="Recepción">
        <Item label="Radicado" value={radicado(w.number)} mono />
        <Item label="Fecha de recepción" value={formatDay(w.receivedAt)} />
        <Item label="Tienda" value={w.store} />
        <Item label="Radicó" value={w.createdByName} />
      </DetailSection>

      <DetailSection title="Cliente">
        <Item label="Nombre" value={titleCaseName(w.customerName)} />
        <Item label="Documento" value={w.customerDocument} mono />
        <Item label="Teléfono" value={w.customerPhone} mono />
        <Item label="Correo" value={w.customerEmail} />
        <Item label="Ciudad" value={w.city} />
      </DetailSection>

      <DetailSection title="Equipo">
        <Item label="Tipo" value={WARRANTY_DEVICE_LABEL[w.deviceType]} />
        <Item label="Marca" value={w.brand} />
        <Item label="Referencia" value={w.model} />
        <Item label="IMEI / serial" value={w.serial} mono />
        <Item label="Fecha de compra" value={w.purchaseDate ? formatDay(w.purchaseDate) : null} />
        <Item label="Factura No." value={w.invoiceNumber} mono />
      </DetailSection>

      <DetailSection title="Cómo llegó">
        <Item label="Motivo de la garantía" value={w.reason} wide />
        <Item label="Estado físico al recibir" value={w.physicalCondition} wide />
        <Item
          label="Incluye accesorios"
          value={
            w.accessories.length > 0
              ? w.accessories.map((a) => WARRANTY_ACCESSORY_LABEL[a]).join(', ')
              : 'Ninguno'
          }
          wide
        />
        <Item label="Comentarios" value={w.comments} wide />
      </DetailSection>

      <DetailSection title="Seguimiento">
        <Item label="Estado" value={WARRANTY_STATUS_LABEL[w.status]} />
        <Item label="Responsable" value={w.assigneeName} />
        <Item label="Proveedor" value={w.supplier} />
        <Item
          label="Entrega a proveedor"
          value={w.supplierSentAt ? formatDay(w.supplierSentAt) : null}
        />
        <Item
          label="Resolución"
          value={w.resolution ? WARRANTY_RESOLUTION_LABEL[w.resolution] : null}
        />
        <Item label="Nota de cierre" value={w.closureNote} wide />
      </DetailSection>

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Archivos ({files.length})
        </h3>
        {files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
            Sin archivos. Súbelos desde la conversación.
          </p>
        ) : (
          (['recepcion', 'proveedor', 'cierre', null] as const).map((t) => {
            const group = files.filter((f) => f.tag === t);
            if (group.length === 0) return null;
            return (
              <div key={t ?? 'general'} className="space-y-1.5">
                <p className="text-[12px] font-medium text-foreground/80">
                  {t ? WARRANTY_FILE_TAG_LABEL[t] : 'Otros'}{' '}
                  <span className="text-muted-foreground">· {group.length}</span>
                </p>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                  {group.map((f) =>
                    f.attachmentMime?.startsWith('image/') && f.attachmentUrl ? (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setLightbox(images.findIndex((x) => x.id === f.id))}
                        className="aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={f.attachmentUrl}
                          alt={f.attachmentName ?? ''}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <a
                        key={f.id}
                        href={f.attachmentUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted px-1.5 text-center text-muted-foreground hover:text-foreground"
                        title={f.attachmentName ?? undefined}
                      >
                        <FileText className="h-4 w-4" />
                        <span className="line-clamp-2 break-all text-[9.5px]">
                          {f.attachmentName}
                        </span>
                      </a>
                    ),
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {lightbox !== null && lightbox >= 0 ? (
        <ImageLightbox
          images={images}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
        />
      ) : null}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-3.5">
        {children}
      </dl>
    </section>
  );
}

function Item({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 whitespace-pre-wrap break-words text-[13px]',
          mono && 'font-mono text-[12.5px]',
          !value && 'text-muted-foreground/60',
        )}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

// === Actividad ===

const FIELD_LABEL: Record<string, string> = {
  receivedAt: 'Fecha de recepción',
  store: 'Tienda',
  customerName: 'Nombre',
  customerDocument: 'Documento',
  customerPhone: 'Teléfono',
  customerEmail: 'Correo',
  city: 'Ciudad',
  deviceType: 'Tipo de equipo',
  brand: 'Marca',
  model: 'Referencia',
  serial: 'IMEI / serial',
  purchaseDate: 'Fecha de compra',
  invoiceNumber: 'Factura',
  physicalCondition: 'Estado físico',
  reason: 'Motivo',
  accessories: 'Accesorios',
  comments: 'Comentarios',
  assigneeName: 'Responsable',
  supplier: 'Proveedor',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

function ActivityTab({ events }: { events: WarrantyEvent[] }) {
  const ordered = [...events].reverse();
  return (
    <ol className="space-y-0 px-4 py-5 md:px-5">
      {ordered.map((e, i) => {
        const last = i === ordered.length - 1;
        let title: string;
        if (e.type === 'created') title = 'Garantía radicada';
        else if (e.type === 'status')
          title =
            e.fromStatus === 'closed'
              ? 'Reabierta'
              : `${e.fromStatus ? WARRANTY_STATUS_LABEL[e.fromStatus] : '—'} → ${
                  e.toStatus ? WARRANTY_STATUS_LABEL[e.toStatus] : '—'
                }`;
        else title = 'Datos editados';
        const changes =
          e.type === 'updated' && e.data
            ? Object.entries(e.data as Record<string, [unknown, unknown]>)
            : [];
        const resolution =
          e.type === 'status' && e.data && typeof e.data.resolution === 'string'
            ? WARRANTY_RESOLUTION_LABEL[e.data.resolution as WarrantyResolution]
            : null;
        return (
          <li key={e.id} className="relative flex gap-3 pb-5">
            {!last ? (
              <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-border" />
            ) : null}
            <span className="relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border border-border bg-card">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  e.type === 'updated' ? 'bg-muted-foreground/50' : 'bg-accent',
                )}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {title}
                {resolution ? <span className="text-muted-foreground"> · {resolution}</span> : null}
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                {e.actorName} · {formatMoment(e.createdAt)}
              </p>
              {e.note ? (
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/50 px-2.5 py-1.5 text-[12.5px]">
                  {e.note}
                </p>
              ) : null}
              {changes.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {changes.map(([field, [before, after]]) => (
                    <li key={field} className="text-[12px]">
                      <span className="text-muted-foreground">{FIELD_LABEL[field] ?? field}:</span>{' '}
                      <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                        {show(before)}
                      </span>{' '}
                      → <span className="font-medium">{show(after)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
