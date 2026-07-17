'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  coordinadoraRotuloOptions,
  type CoordinadoraCity,
  type Guide,
  type GuidePreview,
  type GuideTracking,
} from '@smartlogistica/shared';

import { CityPicker } from '@/components/city-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

interface Recipient {
  name: string;
  document: string;
  address: string;
  cityCode: string;
  cityName: string;
  phone: string;
}
interface Pkg {
  weight: string;
  height: string;
  width: string;
  length: string;
  units: string;
  content: string;
  declaredValue: string;
}

export function GuidePanel({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [rotuloId, setRotuloId] = useState<number | null>(null);
  const [result, setResult] = useState<Guide | null>(null);

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['guide-preview', orderId],
    queryFn: () => api.get<GuidePreview>(`/v1/orders/${orderId}/guide-preview`),
    retry: false,
  });

  useEffect(() => {
    if (preview && recipient === null) {
      setRecipient({
        name: preview.recipient.name ?? '',
        document: preview.recipient.document ?? '',
        address: preview.recipient.address ?? '',
        cityCode: preview.recipient.cityCode ?? '',
        cityName: preview.recipient.cityName ?? '',
        phone: preview.recipient.phone ?? '',
      });
      setPkg({
        weight: String(preview.package.weight),
        height: String(preview.package.height),
        width: String(preview.package.width),
        length: String(preview.package.length),
        units: String(preview.package.units),
        content: preview.package.content,
        declaredValue: String(preview.package.declaredValue),
      });
      setRotuloId(preview.rotuloId);
    }
  }, [preview, recipient]);

  const generate = useMutation({
    mutationFn: () =>
      api.post<Guide>(`/v1/orders/${orderId}/guide`, {
        recipient: {
          name: recipient!.name.trim(),
          document: recipient!.document.trim(),
          address: recipient!.address.trim(),
          cityCode: recipient!.cityCode.trim(),
          phone: recipient!.phone.trim(),
        },
        package: {
          weight: Number(pkg!.weight),
          height: Number(pkg!.height),
          width: Number(pkg!.width),
          length: Number(pkg!.length),
          units: Math.max(1, Number(pkg!.units) || 1),
          content: pkg!.content.trim(),
          declaredValue: Number(pkg!.declaredValue) || 0,
        },
        ...(rotuloId ? { rotuloId } : {}),
      }),
    onSuccess: (g) => {
      setResult(g);
      toast.success(`Guia ${g.number} generada`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['order-events', orderId] });
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo generar la guia'),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-5">
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : 'No se pudo preparar la guia.'}
        </p>
      </div>
    );
  }

  const emitted = result ?? preview?.guide ?? null;
  if (emitted) return <GuideDoneView orderId={orderId} guide={emitted} />;
  if (!recipient || !pkg || !preview) return null;

  const canGenerate =
    recipient.name.trim().length >= 2 &&
    recipient.document.trim().length >= 3 &&
    recipient.address.trim().length >= 3 &&
    recipient.cityCode.trim().length >= 4 &&
    recipient.phone.trim().length >= 5 &&
    Number(pkg.weight) > 0 &&
    pkg.content.trim().length >= 1;

  const patchR = (p: Partial<Recipient>) => setRecipient((r) => (r ? { ...r, ...p } : r));
  const patchP = (p: Partial<Pkg>) => setPkg((v) => (v ? { ...v, ...p } : v));

  return (
    <div className="space-y-5 p-5">
      {/* Remitente (de la sede) */}
      <section className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Remitente (origen)</p>
        <p className="mt-0.5 font-medium">{preview.sender.name}</p>
        <p className="text-xs text-muted-foreground">
          {preview.sender.address}
          {preview.sender.cityName ? ` · ${preview.sender.cityName}` : ''} · {preview.sender.phone}
        </p>
      </section>

      {/* Destinatario (de VTEX, editable) */}
      <section className="space-y-3">
        <SectionTitle>Destinatario</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <Input value={recipient.name} onChange={(e) => patchR({ name: e.target.value })} />
          </Field>
          <Field label="Documento (cedula/NIT)">
            <Input value={recipient.document} onChange={(e) => patchR({ document: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Direccion">
              <Input value={recipient.address} onChange={(e) => patchR({ address: e.target.value })} />
            </Field>
          </div>
          <Field label="Ciudad de destino">
            <CityPicker
              value={recipient.cityName || recipient.cityCode}
              onPick={(c: CoordinadoraCity) =>
                patchR({ cityCode: c.code, cityName: `${c.name} — ${c.department}` })
              }
              search={(q) =>
                api.get<CoordinadoraCity[]>(
                  `/v1/orders/${orderId}/guide-cities?q=${encodeURIComponent(q)}`,
                )
              }
              queryKey={`dest-${orderId}`}
            />
          </Field>
          <Field label="Telefono">
            <Input value={recipient.phone} onChange={(e) => patchR({ phone: e.target.value })} />
          </Field>
        </div>
        {!recipient.cityCode ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No se reconocio la ciudad de VTEX — selecciona la ciudad de destino.
          </p>
        ) : null}
      </section>

      {/* Paquete */}
      <section className="space-y-3">
        <SectionTitle>Paquete</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contenido">
            <Input value={pkg.content} onChange={(e) => patchP({ content: e.target.value })} />
          </Field>
          <Field label="Valor declarado (COP)">
            <Input
              inputMode="numeric"
              value={pkg.declaredValue}
              onChange={(e) => patchP({ declaredValue: e.target.value.replace(/[^\d.]/g, '') })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Peso (kg)">
            <Input inputMode="decimal" value={pkg.weight} onChange={(e) => patchP({ weight: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Alto (cm)">
            <Input inputMode="decimal" value={pkg.height} onChange={(e) => patchP({ height: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Ancho (cm)">
            <Input inputMode="decimal" value={pkg.width} onChange={(e) => patchP({ width: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Largo (cm)">
            <Input inputMode="decimal" value={pkg.length} onChange={(e) => patchP({ length: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="w-24">
            <Field label="Unidades">
              <Input inputMode="numeric" value={pkg.units} onChange={(e) => patchP({ units: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <Field label="Formato de rotulo">
            <select
              value={rotuloId ?? ''}
              onChange={(e) => setRotuloId(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {coordinadoraRotuloOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <p className="text-[11px] text-muted-foreground">
          El rotulo se adjunta al chat al generar la guia.
        </p>
        <Button onClick={() => generate.mutate()} loading={generate.isPending} disabled={!canGenerate}>
          <Truck className="h-4 w-4" />
          Generar guia
        </Button>
      </div>
    </div>
  );
}

function GuideDoneView({ orderId, guide }: { orderId: string; guide: Guide }) {
  return (
    <div className="space-y-4 p-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
        <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        <h3 className="mt-2 text-base font-semibold">Guia {guide.number} generada</h3>
        <p className="mt-0.5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          Coordinadora
        </p>
      </div>

      <TrackingTimeline orderId={orderId} />

      <p className="text-center text-[11px] text-muted-foreground">
        El rotulo esta en la conversacion. Para generar otra guia, anulala primero en Coordinadora.
      </p>
    </div>
  );
}

/** Seguimiento detallado del envio (rastreo Coordinadora): estado, novedades y timeline. */
function TrackingTimeline({ orderId }: { orderId: string }) {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['order-tracking', orderId],
    queryFn: () => api.get<GuideTracking | null>(`/v1/orders/${orderId}/tracking`),
    staleTime: 60_000,
  });

  const delivered = Boolean(data?.fechaEntrega?.trim());
  const hasMovements = (data?.estados.length ?? 0) > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="h-4 w-4" />
          Seguimiento del envio
        </h4>
        <div className="flex items-center gap-3">
          {data?.trackingUrl ? (
            <a
              href={data.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
            >
              <ExternalLink className="h-3 w-3" />
              Coordinadora
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => refetch()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Actualizar seguimiento"
            title="Actualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo consultar el seguimiento.</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Este pedido aun no tiene guia para rastrear.</p>
        ) : (
          <>
            {delivered ? (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Entregado {data.fechaEntrega}
                {data.horaEntrega ? ` · ${data.horaEntrega}` : ''}
              </div>
            ) : data.descripcionEstado ? (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-700 dark:text-sky-400">
                <MapPin className="h-4 w-4 shrink-0" />
                {data.descripcionEstado}
              </div>
            ) : null}

            {data.novedades.length > 0 ? (
              <div className="mb-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Novedades
                </p>
                {data.novedades.map((n, i) => (
                  <p key={i} className="text-xs">
                    {n.descripcion}
                    <span className="text-muted-foreground">
                      {n.fecha ? ` · ${n.fecha}` : ''}
                      {n.hora ? ` ${n.hora}` : ''}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}

            {hasMovements ? (
              <ol>
                {data.estados.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-foreground' : 'bg-foreground/40'}`}
                      />
                      {i < data.estados.length - 1 ? <span className="my-0.5 w-px flex-1 bg-border" /> : null}
                    </div>
                    <div className="pb-3">
                      <p className="text-sm leading-snug">{e.descripcion}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.fecha}
                        {e.hora ? ` · ${e.hora}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aun sin movimientos registrados. Coordinadora los actualiza al recoger y mover el paquete.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
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
