'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AlegraItem,
  CatalogMatch,
  GuidePreview,
  InvoicePreview,
  InvoiceResult,
  ProcessAllResult,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

interface Line {
  key: string;
  // Codigos de la foto (dual-SIM = varios), separados por coma. Van a la descripcion.
  codesText: string;
  itemId: string | null;
  productName: string | null;
  price: string;
  quantity: number;
}

export function InvoicePanel({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [result, setResult] = useState<InvoiceResult | null>(null);

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invoice-preview', orderId],
    queryFn: () => api.get<InvoicePreview>(`/v1/orders/${orderId}/invoice-preview`),
    retry: false,
  });

  useEffect(() => {
    if (preview && lines === null) {
      setLines(
        preview.lines.map((l, i) => ({
          key: `${l.codes.join('-')}-${i}`,
          codesText: l.codes.join(', '),
          itemId: l.itemId,
          productName: l.productName,
          price: l.suggestedPrice ?? '',
          quantity: 1,
        })),
      );
    }
  }, [preview, lines]);

  const patch = (key: string, p: Partial<Line>) =>
    setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines((ls) => (ls ?? []).filter((l) => l.key !== key));
  const addLine = () =>
    setLines((ls) => [
      ...(ls ?? []),
      { key: `m-${Date.now()}`, codesText: '', itemId: null, productName: null, price: '', quantity: 1 },
    ]);

  const current = lines ?? [];
  const total = current.reduce((s, l) => s + (Number(l.price) || 0) * l.quantity, 0);
  const canInvoice =
    current.length > 0 && current.every((l) => l.itemId && Number(l.price) > 0 && l.quantity >= 1);

  /** Lineas listas para el API. Descripcion = solo el/los codigo(s), uno por linea. */
  const buildLines = () =>
    current.map((l) => {
      const codes = l.codesText.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
      return {
        itemId: l.itemId!,
        price: Number(l.price),
        quantity: l.quantity,
        description: codes.length ? codes.join('\n') : undefined,
      };
    });

  const refreshOrder = () => {
    qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
    qc.invalidateQueries({ queryKey: ['order-events', orderId] });
    qc.invalidateQueries({ queryKey: ['invoice-preview', orderId] });
  };

  const invoice = useMutation({
    mutationFn: () => api.post<InvoiceResult>(`/v1/orders/${orderId}/invoice`, { lines: buildLines() }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Factura ${r.number} emitida`);
      refreshOrder();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo facturar'),
  });

  // Preview de la guia: se carga aqui para que "Hacer todo" pueda mandar el
  // destinatario/paquete sin un viaje extra al pulsar.
  const { data: guidePrev } = useQuery({
    queryKey: ['guide-preview', orderId],
    queryFn: () => api.get<GuidePreview>(`/v1/orders/${orderId}/guide-preview`),
    retry: false,
    staleTime: 30_000,
  });

  const recip = guidePrev?.recipient;
  // El flujo de un paso usa la direccion TAL CUAL viene de VTEX. Si falta algun
  // dato obligatorio hay que pasar por la pestana Guia y completarlo/verificarlo.
  const guideReady = Boolean(
    recip &&
      recip.name.trim().length >= 2 &&
      recip.address.trim().length >= 3 &&
      recip.document &&
      recip.cityCode &&
      recip.phone,
  );

  const processAll = useMutation({
    mutationFn: () =>
      api.post<ProcessAllResult>(`/v1/orders/${orderId}/process-all`, {
        invoice: { lines: buildLines() },
        guide: {
          recipient: {
            name: recip!.name,
            document: recip!.document!,
            address: recip!.address,
            cityCode: recip!.cityCode!,
            phone: recip!.phone!,
          },
          package: guidePrev!.package,
          rotuloId: guidePrev!.rotuloId,
        },
      }),
    onSuccess: (res) => {
      setResult(res.invoice);
      toast.success(`Listo: factura ${res.invoice.number} + guia ${res.guide.number} + MKT`);
      refreshOrder();
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo completar el proceso'),
  });

  const busy = invoice.isPending || processAll.isPending;

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
          {error instanceof ApiError ? error.message : 'No se pudo preparar la factura.'}
        </p>
      </div>
    );
  }
  // Si ya se facturo (en esta sesion o antes), no se puede volver a facturar.
  const emitted = result ?? preview?.invoice ?? null;
  if (emitted) return <InvoicedView invoice={emitted} />;

  return (
    <div className="space-y-4 p-5">
      <div className="space-y-0.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cliente</p>
        <p className="font-medium">{preview?.client.name}</p>
        {preview?.client.identification ? (
          <p className="text-xs text-muted-foreground">CC {preview.client.identification}</p>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">Sin cedula (se usara consumidor final)</p>
        )}
        {preview?.client.email ? (
          <p className="text-xs text-muted-foreground">{preview.client.email}</p>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">Sin correo</p>
        )}
        {preview?.client.phone ? (
          <p className="text-xs text-muted-foreground">{preview.client.phone}</p>
        ) : null}
        {preview?.client.address ? (
          <p className="text-xs text-muted-foreground">{preview.client.address}</p>
        ) : null}
        <p className="pt-1 text-[10px] text-muted-foreground">
          Si el cliente aun no existe en Alegra, su direccion se convierte a nomenclatura DIAN al
          crearlo.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Productos a facturar
          </h3>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Agregar
          </button>
        </div>

        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sube fotos de IMEI/serial en el chat, o agrega productos manualmente.
          </p>
        ) : (
          current.map((l) => (
            <LineRow
              key={l.key}
              orderId={orderId}
              line={l}
              onPatch={(p) => patch(l.key, p)}
              onRemove={() => remove(l.key)}
            />
          ))
        )}
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-lg font-semibold tabular-nums">{formatCOP(total)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => processAll.mutate()}
            loading={processAll.isPending}
            disabled={!canInvoice || !guideReady || busy}
            title={
              guideReady
                ? 'Factura + guia + MKT en un solo paso, con la direccion tal cual viene de VTEX'
                : 'Faltan datos del destinatario: verificalos en la pestana Guia'
            }
          >
            <Zap className="h-4 w-4" />
            Hacer todo
          </Button>
          <Button
            onClick={() => invoice.mutate()}
            loading={invoice.isPending}
            disabled={!canInvoice || busy}
          >
            <ReceiptText className="h-4 w-4" />
            Facturar en Alegra
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Se emite pagada con la cuenta &laquo;MARKETPLACE ADDI&raquo; y queda cerrada/cobrada.{' '}
        <span className="text-foreground/70">
          &laquo;Hacer todo&raquo; encadena factura + guia + MKT usando la direccion tal cual viene de
          VTEX
          {guidePrev?.recipient.cityName ? ` (${guidePrev.recipient.cityName})` : ''}. Si necesitas
          corregirla, usa la pestana Guia.
        </span>
      </p>
    </div>
  );
}

function LineRow({
  orderId,
  line,
  onPatch,
  onRemove,
}: {
  orderId: string;
  line: Line;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Al editar los codigos, re-buscar el producto con el primero (los de una foto
  // son el mismo equipo). Los codigos de una misma foto van juntos en la descripcion.
  const relookup = async () => {
    const first = line.codesText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)[0];
    if (!first) {
      onPatch({ itemId: null, productName: null });
      return;
    }
    setResolving(true);
    try {
      const matches = await api.post<CatalogMatch[]>(`/v1/orders/${orderId}/catalog-lookup`, {
        codes: [first],
      });
      const m = matches[0];
      if (m?.itemId) onPatch({ itemId: m.itemId, productName: m.productName });
      else onPatch({ itemId: null, productName: null });
    } catch {
      /* dejar como esta */
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={line.codesText}
          onChange={(e) => onPatch({ codesText: e.target.value })}
          onBlur={relookup}
          placeholder="IMEI(s) / serial (varios = dual-SIM, sep. por coma)"
          className="h-8 flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label="Quitar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Producto */}
      {line.itemId ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="break-words font-medium leading-snug">{line.productName}</span>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {resolving ? 'Buscando producto...' : 'Elegir producto de Alegra'}
        </button>
      )}

      {pickerOpen ? (
        <ItemPicker
          orderId={orderId}
          onPick={(item) => {
            onPatch({
              itemId: item.id,
              productName: item.name,
              price: item.price ?? line.price,
            });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {/* Precio + cantidad */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Precio venta</label>
          <Input
            type="number"
            inputMode="numeric"
            value={line.price}
            onChange={(e) => onPatch({ price: e.target.value })}
            placeholder="0"
            className="h-8 tabular-nums"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cant.</label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={line.quantity}
            onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 tabular-nums"
          />
        </div>
      </div>
    </div>
  );
}

function ItemPicker({
  orderId,
  onPick,
  onClose,
}: {
  orderId: string;
  onPick: (item: AlegraItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const { data: items = [], isFetching } = useQuery({
    queryKey: ['alegra-items', orderId, q.trim()],
    queryFn: () => api.get<AlegraItem[]>(`/v1/orders/${orderId}/alegra-items?q=${encodeURIComponent(q.trim())}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto en Alegra..."
          className="h-8 flex-1 bg-transparent text-sm outline-none"
        />
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cerrar
        </button>
      </div>
      {q.trim().length >= 2 ? (
        <ul className="mt-1 max-h-56 overflow-auto">
          {isFetching ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">Buscando...</li>
          ) : items.length === 0 ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">Sin resultados.</li>
          ) : (
            items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onPick(it)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="break-words leading-snug">{it.name}</span>
                  {it.price ? (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatCOP(Number(it.price))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="mt-1 px-2 py-1 text-[11px] text-muted-foreground">Escribe al menos 2 letras.</p>
      )}
    </div>
  );
}

/** Pedido ya facturado: se muestra la factura emitida; NO se puede re-facturar. */
function InvoicedView({ invoice }: { invoice: { number: string; total: string; status: string } }) {
  const paid = invoice.status === 'closed';
  return (
    <div className="p-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <h3 className="mt-3 text-base font-semibold">Factura {invoice.number} emitida</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Total {formatCOP(Number(invoice.total))}
          {paid ? ' · Cerrada / cobrada' : ` · Estado: ${invoice.status}`}
        </p>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Este pedido ya fue facturado; el PDF esta en la conversacion. Para volver a facturar, anula
        primero la factura en Alegra.
      </p>
    </div>
  );
}

function formatCOP(value: number): string {
  if (Number.isNaN(value)) return '$0';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toLocaleString('es-CO')}`;
  }
}
