'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, ImagePlus, Loader2, ShieldPlus, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  WARRANTY_ACCESSORY_LABEL,
  WARRANTY_DEVICE_LABEL,
  warrantyAccessorySchema,
  warrantyDeviceTypeSchema,
  type MemberSummary,
  type WarrantyAccessory,
  type WarrantyDetail,
  type WarrantyDeviceType,
  type WarrantyFileTag,
  type WarrantyMessage,
  type WarrantySuggestions,
} from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { radicado, todayIso } from './warranty-ui';

/** Tiendas y marcas de la hoja: se sugieren aunque todavia no haya garantias. */
const DEFAULT_STORES = ['SMART MEDELLIN', 'SMART PASTO', 'SMART PEREIRA', 'SMART ARMENIA'];
const DEFAULT_BRANDS = [
  'APPLE',
  'SAMSUNG',
  'XIAOMI',
  'MOTOROLA',
  'INFINIX',
  'OPPO',
  'HONOR',
  'LENOVO',
  'TECNO',
  'VIVO',
  'ZTE',
];

const DEVICE_TYPES = warrantyDeviceTypeSchema.options;
const ACCESSORIES = warrantyAccessorySchema.options;

interface FormState {
  receivedAt: string;
  store: string;
  customerName: string;
  customerDocument: string;
  customerPhone: string;
  customerEmail: string;
  city: string;
  deviceType: WarrantyDeviceType;
  brand: string;
  model: string;
  serial: string;
  purchaseDate: string;
  invoiceNumber: string;
  physicalCondition: string;
  reason: string;
  accessories: WarrantyAccessory[];
  comments: string;
  assigneeId: string;
  supplier: string;
}

function emptyForm(meId: string): FormState {
  return {
    receivedAt: todayIso(),
    store: '',
    customerName: '',
    customerDocument: '',
    customerPhone: '',
    customerEmail: '',
    city: '',
    deviceType: 'celular',
    brand: '',
    model: '',
    serial: '',
    purchaseDate: '',
    invoiceNumber: '',
    physicalCondition: '',
    reason: '',
    accessories: [],
    comments: '',
    assigneeId: meId,
    supplier: '',
  };
}

function fromDetail(d: WarrantyDetail): FormState {
  return {
    receivedAt: d.receivedAt,
    store: d.store,
    customerName: d.customerName,
    customerDocument: d.customerDocument,
    customerPhone: d.customerPhone,
    customerEmail: d.customerEmail ?? '',
    city: d.city,
    deviceType: d.deviceType,
    brand: d.brand,
    model: d.model,
    serial: d.serial,
    purchaseDate: d.purchaseDate ?? '',
    invoiceNumber: d.invoiceNumber ?? '',
    physicalCondition: d.physicalCondition,
    reason: d.reason,
    accessories: d.accessories,
    comments: d.comments ?? '',
    assigneeId: d.assigneeId ?? '',
    supplier: d.supplier ?? '',
  };
}

/** Archivo elegido en el formulario (se sube cuando la garantia ya existe). */
interface PickedFile {
  key: string;
  file: File;
  preview: string | null;
}

/**
 * "NUEVA GARANTIA" (y editar una existente): los mismos campos de la hoja de
 * calculo, por secciones. Las fotos y videos de recepcion se eligen aqui (los
 * que sean) y se suben a la conversacion de la garantia al radicarla.
 */
export function WarrantyFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: WarrantyDetail;
  onClose: () => void;
  onSaved: (detail: WarrantyDetail) => void;
}) {
  const me = useCurrentUser();
  const editing = Boolean(initial);
  const [form, setForm] = useState<FormState>(() =>
    initial ? fromDetail(initial) : emptyForm(me?.id ?? ''),
  );
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [uploading, setUploading] = useState<{ done: number; total: number; pct: number } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const { data: suggestions } = useQuery({
    queryKey: ['warranty-suggestions'],
    queryFn: () => api.get<WarrantySuggestions>('/v1/warranties/suggestions'),
    staleTime: 5 * 60_000,
  });
  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 60_000,
  });

  const stores = useMemo(
    () => mergeOptions(suggestions?.stores ?? [], DEFAULT_STORES),
    [suggestions?.stores],
  );
  const brands = useMemo(
    () => mergeOptions(suggestions?.brands ?? [], DEFAULT_BRANDS),
    [suggestions?.brands],
  );

  // Esc cierra + scroll del fondo bloqueado mientras el dialogo esta abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, uploading]);

  // Las vistas previas de las fotos se liberan al cerrar.
  useEffect(
    () => () => {
      for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const missing = requiredMissing(form);
  const canSubmit = missing.length === 0;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        receivedAt: form.receivedAt,
        store: form.store.trim(),
        customerName: form.customerName.trim(),
        customerDocument: form.customerDocument.trim(),
        customerPhone: form.customerPhone.trim(),
        customerEmail: form.customerEmail.trim() || null,
        city: form.city.trim(),
        deviceType: form.deviceType,
        brand: form.brand.trim(),
        model: form.model.trim(),
        serial: form.serial.trim(),
        purchaseDate: form.purchaseDate || null,
        invoiceNumber: form.invoiceNumber.trim() || null,
        physicalCondition: form.physicalCondition.trim(),
        reason: form.reason.trim(),
        accessories: form.accessories,
        comments: form.comments.trim() || null,
        assigneeId: form.assigneeId || null,
        supplier: form.supplier.trim() || null,
      };
      const detail = initial
        ? await api.patch<WarrantyDetail>(`/v1/warranties/${initial.id}`, body)
        : await api.post<WarrantyDetail>('/v1/warranties', body);

      // Los archivos de RECEPCION, uno por uno (videos pesados: con progreso).
      if (files.length > 0) {
        let done = 0;
        let failed = 0;
        for (const f of files) {
          setUploading({ done, total: files.length, pct: 0 });
          try {
            await uploadWarrantyFile(detail.id, f.file, 'recepcion', (pct) =>
              setUploading({ done, total: files.length, pct }),
            );
          } catch {
            failed++;
          }
          done++;
        }
        setUploading(null);
        if (failed > 0) {
          toast.error(
            `${failed} archivo${failed === 1 ? '' : 's'} no se pudo subir: súbelo desde la conversación.`,
          );
        }
      }
      return detail;
    },
    onSuccess: (detail) => {
      toast.success(
        editing ? 'Garantía actualizada' : `Garantía ${radicado(detail.number)} radicada`,
      );
      onSaved(detail);
    },
    onError: (err) => {
      setUploading(null);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar la garantía');
    },
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setFiles((prev) => [...prev, ...picked]);
  };
  const removeFile = (key: string) =>
    setFiles((prev) => {
      const gone = prev.find((f) => f.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((f) => f.key !== key);
    });

  if (typeof window === 'undefined') return null;
  const busy = save.isPending;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="shadow-pop flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <ShieldPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight">
              {initial ? `Editar garantía ${radicado(initial.number)}` : 'Nueva garantía'}
            </h2>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {initial
                ? 'Corrige los datos de la recepción. Cada cambio queda en la actividad.'
                : 'Radica el equipo que el cliente trae a la tienda.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-5">
          <Section title="Recepción">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fecha de recepción">
                <Input
                  type="date"
                  value={form.receivedAt}
                  max={todayIso()}
                  onChange={(e) => set('receivedAt', e.target.value)}
                />
              </Field>
              <Field label="Tienda">
                <ComboInput
                  value={form.store}
                  onChange={(v) => set('store', v)}
                  options={stores}
                  placeholder="SMART MEDELLIN"
                  id="wf-stores"
                />
              </Field>
            </div>
          </Section>

          <Section title="Cliente">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo">
                <Input
                  value={form.customerName}
                  onChange={(e) => set('customerName', e.target.value)}
                  placeholder="Juliana Benítez Londoño"
                />
              </Field>
              <Field label="Documento de identidad">
                <Input
                  inputMode="numeric"
                  value={form.customerDocument}
                  onChange={(e) => set('customerDocument', e.target.value)}
                  placeholder="1020407471"
                />
              </Field>
              <Field label="Teléfono">
                <Input
                  inputMode="tel"
                  value={form.customerPhone}
                  onChange={(e) => set('customerPhone', e.target.value)}
                  placeholder="3188156528"
                />
              </Field>
              <Field label="Correo (opcional)">
                <Input
                  type="email"
                  value={form.customerEmail}
                  onChange={(e) => set('customerEmail', e.target.value)}
                  placeholder="cliente@gmail.com"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Ciudad">
                  <ComboInput
                    value={form.city}
                    onChange={(v) => set('city', v)}
                    options={suggestions?.cities ?? []}
                    placeholder="Pasto"
                    id="wf-cities"
                  />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Equipo">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {DEVICE_TYPES.map((t) => (
                  <Pill key={t} active={form.deviceType === t} onClick={() => set('deviceType', t)}>
                    {WARRANTY_DEVICE_LABEL[t]}
                  </Pill>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Marca">
                  <ComboInput
                    value={form.brand}
                    onChange={(v) => set('brand', v)}
                    options={brands}
                    placeholder="APPLE"
                    id="wf-brands"
                  />
                </Field>
                <Field label="Referencia">
                  <Input
                    value={form.model}
                    onChange={(e) => set('model', e.target.value)}
                    placeholder="iPhone 13 Pro 128GB"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="IMEI / serial">
                    <Input
                      value={form.serial}
                      onChange={(e) => set('serial', e.target.value)}
                      placeholder="353501497426528"
                      className="font-mono"
                    />
                  </Field>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Compra">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fecha de compra">
                <Input
                  type="date"
                  value={form.purchaseDate}
                  max={todayIso()}
                  onChange={(e) => set('purchaseDate', e.target.value)}
                />
              </Field>
              <Field label="Factura No.">
                <Input
                  value={form.invoiceNumber}
                  onChange={(e) => set('invoiceNumber', e.target.value)}
                  placeholder="FEV7170"
                  className="font-mono"
                />
              </Field>
            </div>
          </Section>

          <Section title="Cómo llega">
            <div className="space-y-3">
              <Field label="Motivo de la garantía">
                <TextArea
                  value={form.reason}
                  onChange={(v) => set('reason', v)}
                  placeholder="La batería sube hasta el 80% y se descarga muy rápido"
                />
              </Field>
              <Field label="Estado físico al recibir">
                <TextArea
                  value={form.physicalCondition}
                  onChange={(v) => set('physicalCondition', v)}
                  placeholder="10/10 sin rayones ni golpes"
                  rows={2}
                />
              </Field>
              <div className="space-y-1.5">
                <Label>Incluye accesorios</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESSORIES.map((a) => {
                    const on = form.accessories.includes(a);
                    return (
                      <Pill
                        key={a}
                        active={on}
                        onClick={() =>
                          set(
                            'accessories',
                            on ? form.accessories.filter((x) => x !== a) : [...form.accessories, a],
                          )
                        }
                      >
                        {WARRANTY_ACCESSORY_LABEL[a]}
                      </Pill>
                    );
                  })}
                </div>
              </div>
              <Field label="Comentarios (opcional)">
                <TextArea
                  value={form.comments}
                  onChange={(v) => set('comments', v)}
                  placeholder="El equipo se recibe en su caja original"
                  rows={2}
                />
              </Field>
            </div>
          </Section>

          <Section title="Seguimiento">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Responsable">
                <select
                  value={form.assigneeId}
                  onChange={(e) => set('assigneeId', e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Sin responsable</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name?.trim() || m.email}
                      {m.isYou ? ' (tú)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Proveedor (si ya se sabe)">
                <ComboInput
                  value={form.supplier}
                  onChange={(v) => set('supplier', v)}
                  options={suggestions?.suppliers ?? []}
                  placeholder="TECNOCELL"
                  id="wf-suppliers"
                />
              </Field>
            </div>
          </Section>

          {!editing ? (
            <Section title="Fotos y videos de recepción">
              <div className="space-y-2.5">
                {files.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {files.map((f) => (
                      <div
                        key={f.key}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                      >
                        {f.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.preview}
                            alt={f.file.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-muted-foreground">
                            {f.file.type.startsWith('video/') ? (
                              <Video className="h-5 w-5" />
                            ) : (
                              <FileText className="h-5 w-5" />
                            )}
                            <span className="line-clamp-2 break-all text-[10px]">
                              {f.file.name}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(f.key)}
                          disabled={busy}
                          aria-label={`Quitar ${f.file.name}`}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-sm text-muted-foreground transition hover:border-accent/50 hover:bg-accent/5 hover:text-foreground"
                >
                  <ImagePlus className="h-4 w-4" />
                  {files.length > 0
                    ? 'Agregar más fotos o videos'
                    : 'Toca o arrastra las fotos y videos del equipo'}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/*,video/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
            </Section>
          ) : null}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
          <p className="min-w-0 text-[11.5px] text-muted-foreground">
            {uploading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Subiendo {uploading.done + 1} de {uploading.total} · {uploading.pct}%
              </span>
            ) : missing.length > 0 ? (
              <span className="line-clamp-2">Falta: {missing.join(', ')}</span>
            ) : !editing && files.length > 0 ? (
              `${files.length} archivo${files.length === 1 ? '' : 's'} de recepción`
            ) : (
              'Listo para guardar'
            )}
          </p>
          <Button onClick={() => save.mutate()} loading={busy} disabled={!canSubmit || busy}>
            <ShieldPlus className="h-4 w-4" />
            {editing ? 'Guardar cambios' : 'Radicar garantía'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Sube un archivo a la conversacion de la garantia con su etiqueta. */
export function uploadWarrantyFile(
  warrantyId: string,
  file: File,
  tag: WarrantyFileTag | null,
  onProgress?: (pct: number) => void,
  caption?: string,
): Promise<WarrantyMessage> {
  const fd = new FormData();
  fd.append('file', file);
  if (tag) fd.append('tag', tag);
  if (caption) fd.append('caption', caption);
  return api.uploadWithProgress<WarrantyMessage>(
    `/v1/warranties/${warrantyId}/attachments`,
    fd,
    onProgress,
  );
}

function requiredMissing(f: FormState): string[] {
  const out: string[] = [];
  if (!f.receivedAt) out.push('fecha de recepción');
  if (f.store.trim().length < 2) out.push('tienda');
  if (f.customerName.trim().length < 2) out.push('nombre');
  if (f.customerDocument.trim().length < 3) out.push('documento');
  if (f.customerPhone.trim().length < 5) out.push('teléfono');
  if (f.city.trim().length < 2) out.push('ciudad');
  if (!f.brand.trim()) out.push('marca');
  if (!f.model.trim()) out.push('referencia');
  if (f.serial.trim().length < 3) out.push('IMEI/serial');
  if (f.reason.trim().length < 3) out.push('motivo');
  if (f.physicalCondition.trim().length < 2) out.push('estado físico');
  return out;
}

/** Lo que ya existe primero (mas usado), luego los de la hoja que falten. */
function mergeOptions(fromDb: string[], defaults: string[]): string[] {
  const seen = new Set(fromDb.map((v) => v.toUpperCase()));
  return [...fromDb, ...defaults.filter((d) => !seen.has(d.toUpperCase()))];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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

/** Campo de texto con sugerencias (datalist): se puede elegir o escribir uno nuevo. */
function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  id: string;
}) {
  return (
    <>
      <Input
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    />
  );
}

export function Pill({
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
        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all',
        active
          ? 'border-accent bg-accent text-accent-foreground shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
