'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
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
  AlegraPaymentAccount,
  CatalogMatch,
  GuidePreview,
  InvoicePaymentMethod,
  InvoicePreview,
  InvoiceResult,
  ProcessAllResult,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';

import { clearDraft, getDraft, setDraft } from './panel-drafts';

interface Line {
  key: string;
  // Codigos de la foto (dual-SIM = varios), separados por coma. Van a la descripcion.
  codesText: string;
  itemId: string | null;
  productName: string | null;
  price: string;
  quantity: number;
  // AVISO de la IA: el producto de la compra no corresponde al del pedido
  // (modelo/almacenamiento/RAM). Solo informa; se puede facturar igual.
  mismatch?: { expected: string; found: string; note: string } | null;
}

/** Un pago elegido (pedidos MONTADOS a mano): cuenta de Alegra + medio + valor. */
interface Payment {
  key: string;
  accountId: string;
  method: InvoicePaymentMethod;
  amount: string;
}

const PAYMENT_METHODS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Transferencia' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'debit-card', label: 'Tarjeta débito' },
  { value: 'credit-card', label: 'Tarjeta crédito' },
];

export function InvoicePanel({ orderId, manual = false }: { orderId: string; manual?: boolean }) {
  const qc = useQueryClient();
  // Items editados: arrancan del borrador si el usuario ya habia trabajado aqui
  // (cerro el drawer o navego y volvio); si no, se llenan desde el preview.
  const [lines, setLines] = useState<Line[] | null>(
    () => getDraft<Line[]>(`invoice:${orderId}`) ?? null,
  );
  // Pagos (solo pedidos montados a mano). Arranca con una fila vacia.
  const [payments, setPayments] = useState<Payment[]>(
    () => getDraft<Payment[]>(`invoice-pay:${orderId}`) ?? [emptyPayment()],
  );
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

  // Codigos que el usuario QUITO a mano: no se re-agregan al reconciliar.
  const removedCodes = useRef<Set<string>>(new Set());

  // Sembrar Y RECONCILIAR EN VIVO: si llega una foto IMEI nueva (el preview se
  // refetchea al leerla), su linea se AGREGA AL INSTANTE — sin pisar lo que el
  // usuario ya edito y sin resucitar lo que borro. Antes solo se sembraba una
  // vez y las fotos posteriores no aparecian hasta recargar la pagina.
  useEffect(() => {
    if (!preview) return;
    const fromPreview = preview.lines.map((l, i) => ({
      key: `${l.codes.join('-')}-${i}`,
      codesText: l.codes.join(', '),
      itemId: l.itemId,
      productName: l.productName,
      price: l.suggestedPrice ?? '',
      // Los montados a mano pueden traer mas de 1 unidad del producto elegido.
      quantity: l.quantity ?? 1,
      mismatch: l.mismatch ?? null,
    }));
    setLines((prev) => {
      if (prev === null) return fromPreview;
      const codesOf = (text: string) =>
        text.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
      const have = new Set(prev.flatMap((p) => codesOf(p.codesText)));
      // Lineas del preview cuyos codigos NO estan todavia (fotos nuevas).
      const missing = fromPreview.filter((l) => {
        const codes = codesOf(l.codesText);
        return (
          codes.length > 0 &&
          codes.every((c) => !have.has(c)) &&
          codes.some((c) => !removedCodes.current.has(c))
        );
      });
      // Enriquecer las existentes con el veredicto de la IA (llega despues).
      const enriched = prev.map((p) => {
        const match = fromPreview.find((f) => f.codesText === p.codesText);
        return match && match.mismatch !== p.mismatch ? { ...p, mismatch: match.mismatch } : p;
      });
      const changed =
        missing.length > 0 || enriched.some((p, i) => p !== prev[i]);
      return changed ? [...enriched, ...missing] : prev;
    });
  }, [preview]);

  // Persistir el borrador con cada edicion (sobrevive cierre del drawer).
  useEffect(() => {
    if (lines !== null) setDraft(`invoice:${orderId}`, lines);
  }, [lines, orderId]);
  useEffect(() => {
    if (manual) setDraft(`invoice-pay:${orderId}`, payments);
  }, [payments, orderId, manual]);

  // Cuentas de banco de Alegra (solo pedidos montados a mano).
  const { data: accounts = [] } = useQuery({
    queryKey: ['payment-accounts', orderId],
    queryFn: () => api.get<AlegraPaymentAccount[]>(`/v1/orders/${orderId}/payment-accounts`),
    enabled: manual,
    staleTime: 5 * 60_000,
  });

  const patch = (key: string, p: Partial<Line>) =>
    setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) =>
    setLines((ls) => {
      const target = (ls ?? []).find((l) => l.key === key);
      // Recordar los codigos quitados: el reconciliador no los re-agrega.
      for (const c of (target?.codesText ?? '').split(/[\s,]+/)) {
        if (c.trim()) removedCodes.current.add(c.trim());
      }
      return (ls ?? []).filter((l) => l.key !== key);
    });
  const addLine = () =>
    setLines((ls) => [
      ...(ls ?? []),
      { key: `m-${Date.now()}`, codesText: '', itemId: null, productName: null, price: '', quantity: 1 },
    ]);

  const current = lines ?? [];
  const total = current.reduce((s, l) => s + (Number(l.price) || 0) * l.quantity, 0);

  // Pagos (montados a mano): filas con datos completos; la suma no puede pasar
  // el total. Si queda saldo, la factura sale ABIERTA por el resto (p. ej.
  // recaudo contraentrega).
  const filledPayments = payments.filter((p) => p.accountId && Number(p.amount) > 0);
  const paidTotal = filledPayments.reduce((s, p) => s + Number(p.amount), 0);
  const paymentsValid =
    !manual ||
    (payments.every((p) => (!p.accountId && !(Number(p.amount) > 0)) || (p.accountId && Number(p.amount) > 0)) &&
      paidTotal <= total + 0.01);

  const canInvoice =
    current.length > 0 &&
    current.every((l) => l.itemId && Number(l.price) > 0 && l.quantity >= 1) &&
    paymentsValid;

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

  /** Pagos listos para el API (solo filas completas; siempre presente si es manual). */
  const buildPayments = () =>
    filledPayments.map((p) => ({
      accountId: p.accountId,
      amount: Number(p.amount),
      method: p.method,
    }));

  const invoice = useMutation({
    // Con clave: si el usuario cierra el drawer con la facturacion EN CURSO, al
    // volver el boton sigue "cargando" (useIsMutating) y no se puede re-enviar.
    mutationKey: ['op-invoice', orderId],
    mutationFn: () =>
      api.post<InvoiceResult>(`/v1/orders/${orderId}/invoice`, {
        lines: buildLines(),
        ...(manual ? { payments: buildPayments() } : {}),
      }),
    onSuccess: (r) => {
      setResult(r);
      clearDraft(`invoice:${orderId}`);
      clearDraft(`invoice-pay:${orderId}`);
      toast.success(`Factura ${r.number} emitida`);
      refreshOrder();
      // Montado a mano: si la guia ya estaba, el pedido queda COMPLETO -> la
      // lista de la sede cambia de seccion.
      if (manual) qc.invalidateQueries({ queryKey: ['orders'] });
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
    mutationKey: ['op-all', orderId],
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
      clearDraft(`invoice:${orderId}`);
      toast.success(`Listo: factura ${res.invoice.number} + guia ${res.guide.number} + MKT`);
      refreshOrder();
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo completar el proceso'),
  });

  // Pendientes GLOBALES (aunque este panel se haya remontado): cuenta las
  // mutaciones en vuelo con estas claves en todo el arbol.
  const invoicing = useIsMutating({ mutationKey: ['op-invoice', orderId] }) > 0;
  const doingAll = useIsMutating({ mutationKey: ['op-all', orderId] }) > 0;
  const busy = invoicing || doingAll;

  // Si la operacion la disparo una instancia YA desmontada (cerraron el drawer
  // mientras facturaba), sus onSuccess no corren aqui: al terminar (busy
  // true->false) se refresca para mostrar la factura emitida.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      refreshOrder();
      qc.invalidateQueries({ queryKey: ['guide-preview', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    }
    wasBusy.current = busy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

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

      {/* Medios de pago (solo pedidos MONTADOS a mano): como en Alegra, hasta 3
          cuentas distintas. Si la suma no llega al total, la factura queda
          ABIERTA por el resto (p. ej. lo que se recauda contraentrega). */}
      {manual ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Medios de pago
            </h3>
            {payments.length < 3 ? (
              <button
                type="button"
                onClick={() => setPayments((ps) => [...ps, emptyPayment()])}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Agregar pago
              </button>
            ) : null}
          </div>

          {payments.map((p) => (
            <div key={p.key} className="flex items-center gap-2">
              <select
                value={p.accountId}
                onChange={(e) =>
                  setPayments((ps) =>
                    ps.map((x) => (x.key === p.key ? { ...x, accountId: e.target.value } : x)),
                  )
                }
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Cuenta de Alegra...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={p.method}
                onChange={(e) =>
                  setPayments((ps) =>
                    ps.map((x) =>
                      x.key === p.key ? { ...x, method: e.target.value as Payment['method'] } : x,
                    ),
                  )
                }
                className="h-8 w-[118px] shrink-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Input
                inputMode="numeric"
                value={p.amount}
                onChange={(e) =>
                  setPayments((ps) =>
                    ps.map((x) =>
                      x.key === p.key
                        ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') }
                        : x,
                    ),
                  )
                }
                placeholder="Valor"
                className="h-8 w-24 shrink-0 tabular-nums"
              />
              {payments.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label="Quitar pago"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}

          {paidTotal > total + 0.01 ? (
            <p className="text-[11px] text-destructive">
              Los pagos ({formatCOP(paidTotal)}) superan el total ({formatCOP(total)}).
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Pagado {formatCOP(paidTotal)} de {formatCOP(total)}
              {total - paidTotal > 0.01 ? (
                <>
                  {' '}
                  · quedan <b className="text-foreground/80">{formatCOP(total - paidTotal)}</b> — la
                  factura sale abierta por ese saldo (ej. recaudo contraentrega).
                </>
              ) : (
                ' · queda cerrada/cobrada.'
              )}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-lg font-semibold tabular-nums">{formatCOP(total)}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* "Hacer todo" solo en pedidos de marketplace: en los montados a mano
              la guia tiene decision propia (recaudo contraentrega) -> por pasos. */}
          {!manual ? (
            <Button
              variant="outline"
              onClick={() => processAll.mutate()}
              loading={doingAll}
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
          ) : null}
          <Button
            onClick={() => invoice.mutate()}
            loading={invoicing}
            disabled={!canInvoice || busy}
          >
            <ReceiptText className="h-4 w-4" />
            Facturar en Alegra
          </Button>
        </div>
      </div>
      {manual ? (
        <p className="text-[11px] text-muted-foreground">
          Pedido montado a mano: la factura sale con los medios de pago que elijas (hasta 3, como en
          Alegra).{' '}
          <span className="text-foreground/70">
            Luego genera la guia en la pestana Guia — ahi decides si va normal o con recaudo
            contraentrega. Este pedido no genera MKT.
          </span>
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Se emite pagada con la cuenta &laquo;MARKETPLACE ADDI&raquo; y queda cerrada/cobrada.{' '}
          <span className="text-foreground/70">
            &laquo;Hacer todo&raquo; encadena factura + guia + MKT usando la direccion tal cual viene
            de VTEX
            {guidePrev?.recipient.cityName ? ` (${guidePrev.recipient.cityName})` : ''}. Si necesitas
            corregirla, usa la pestana Guia.
          </span>
        </p>
      )}
    </div>
  );
}

/** Fila de pago vacia (key unica para React). */
function emptyPayment(): Payment {
  return {
    key: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    accountId: '',
    method: 'transfer',
    amount: '',
  };
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
      {/* AVISO de la IA (experta en celulares): el IMEI leido trae una compra
          que NO corresponde al producto del pedido. Solo avisa, no bloquea. */}
      {line.mismatch ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[12px] leading-snug text-amber-800 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Aviso de la IA:</b> el IMEI corresponde a «{line.mismatch.found}» y el pedido dice «
            {line.mismatch.expected}».{line.mismatch.note ? ` ${line.mismatch.note}.` : ''} Verifica
            antes de facturar (puedes facturar igual).
          </span>
        </div>
      ) : null}
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
