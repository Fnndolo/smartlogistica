'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  User,
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
import { cn } from '@/lib/utils';

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

/** Foco de teclado visible sobre las superficies cobalto (mismo anillo que la
 *  pestana Guia: 2px de cobalto separados 2px de la superficie). */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card';
/** Boton primario del mockup (.btn-primary): degradado cobalto -> cobalto
 *  profundo, halo de color y el reflejo interno del borde superior. */
const BTN_PRIMARY_CLS =
  'h-auto max-w-full whitespace-normal rounded-[11px] bg-[linear-gradient(to_bottom,hsl(var(--accent)),hsl(var(--accent-deep)))] px-[18px] py-2.5 text-center text-[13.5px] font-extrabold tracking-[0.01em] text-accent-foreground shadow-[0_6px_18px_-6px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,background] [transition-duration:120ms] hover:-translate-y-px hover:shadow-[0_10px_24px_-8px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 max-sm:w-full [&_svg]:size-[15px]';
/** Boton secundario del mockup (.btn-ghost): texto --ink-2 y el mismo
 *  interletrado de .btn (.01em). */
const BTN_GHOST_CLS =
  'h-auto max-w-full whitespace-normal rounded-[11px] border-input bg-card px-[18px] py-2.5 text-center text-[13.5px] font-extrabold tracking-[0.01em] text-muted-foreground !shadow-none transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-sm:w-full [&_svg]:size-[15px]';

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
        text
          .split(/[\s,]+/)
          .map((c) => c.trim())
          .filter(Boolean);
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
      const changed = missing.length > 0 || enriched.some((p, i) => p !== prev[i]);
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
      {
        key: `m-${Date.now()}`,
        codesText: '',
        itemId: null,
        productName: null,
        price: '',
        quantity: 1,
      },
    ]);

  const current = lines ?? [];
  const total = current.reduce((s, l) => s + (Number(l.price) || 0) * l.quantity, 0);

  // Codigos que llegaron por FOTO del chat: el preview arma UNA linea por foto,
  // asi que su presencia aqui dice (SOLO al pintar) si la linea nacio de una foto
  // y el paso 1 del recorrido puede marcarse cumplido. Sin fetch ni estado nuevo.
  const photoCodes = new Set((preview?.lines ?? []).flatMap((l) => l.codes));

  // Pagos (montados a mano): filas con datos completos; la suma no puede pasar
  // el total. Si queda saldo, la factura sale ABIERTA por el resto (p. ej.
  // recaudo contraentrega).
  const filledPayments = payments.filter((p) => p.accountId && Number(p.amount) > 0);
  const paidTotal = filledPayments.reduce((s, p) => s + Number(p.amount), 0);
  const paymentsValid =
    !manual ||
    (payments.every(
      (p) => (!p.accountId && !(Number(p.amount) > 0)) || (p.accountId && Number(p.amount) > 0),
    ) &&
      paidTotal <= total + 0.01);

  const canInvoice =
    current.length > 0 &&
    current.every((l) => l.itemId && Number(l.price) > 0 && l.quantity >= 1) &&
    paymentsValid;

  /** Lineas listas para el API. Descripcion = solo el/los codigo(s), uno por linea. */
  const buildLines = () =>
    current.map((l) => {
      const codes = l.codesText
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
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
      toast.success(`Listo: factura ${res.invoice.number} + guía ${res.guide.number} + MKT`);
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
      <div className="flex justify-center py-14">
        <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-[22px]">
        <p className="flex items-start gap-2.5 rounded-xl bg-destructive/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-destructive">
          <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" />
          <span className="min-w-0 break-words">
            {error instanceof ApiError ? error.message : 'No se pudo preparar la factura.'}
          </span>
        </p>
      </div>
    );
  }
  // Si ya se facturo (en esta sesion o antes), no se puede volver a facturar.
  const emitted = result ?? preview?.invoice ?? null;
  if (emitted) return <InvoicedView invoice={emitted} />;

  return (
    <div className="space-y-5 p-[22px]">
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-wash text-accent">
            <User className="h-4 w-4" />
          </span>
          <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">Cliente</h3>
          <span className="ml-auto min-w-0 break-words text-right text-xs text-hint">
            si no existe en Alegra, la dirección se convierte a nomenclatura DIAN
          </span>
        </div>
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5 text-[13.5px]">
          {/* .kv del mockup. En un panel angosto la columna fija de 130px deja
              al valor sin aire: por debajo de ~400px cada par se APILA (la
              etiqueta arriba, el valor debajo) en vez de desbordarse. */}
          <dl className="grid grid-cols-1 [&>dd:last-of-type]:pb-0 [&>dd]:pb-2.5 min-[400px]:grid-cols-[110px_minmax(0,1fr)] min-[400px]:gap-y-[9px] min-[400px]:[&>dd]:pb-0 md:grid-cols-[130px_minmax(0,1fr)]">
            <dt className="min-w-0 self-start break-words font-semibold text-hint">Facturar a</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
              {preview?.client.name}
            </dd>

            <dt className="min-w-0 self-start break-words font-semibold text-hint">Cédula</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
              {preview?.client.identification ? (
                <span>
                  CC{' '}
                  <span className="font-mono text-[0.92em] tracking-[0.02em]">
                    {preview.client.identification}
                  </span>
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-[3px] text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
                    Sin cédula
                  </span>
                  <span className="min-w-0 break-words text-[11.5px] font-normal text-hint">
                    se usará consumidor final
                  </span>
                </>
              )}
            </dd>

            <dt className="min-w-0 self-start break-words font-semibold text-hint">Correo</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
              {preview?.client.email ? (
                <span className="break-all">{preview.client.email}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-[3px] text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
                  Sin correo
                </span>
              )}
            </dd>

            {preview?.client.phone ? (
              <>
                <dt className="min-w-0 self-start break-words font-semibold text-hint">Teléfono</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
                  {preview.client.phone}
                </dd>
              </>
            ) : null}
            {preview?.client.address ? (
              <>
                <dt className="min-w-0 self-start break-words font-semibold text-hint">
                  Dirección
                </dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
                  {preview.client.address}
                </dd>
              </>
            ) : null}
          </dl>

          {/* La sede factura a un CLIENTE FIJO: hay que decirlo aqui o el
              operador no entiende por que la factura de Alegra sale a otro
              nombre. El documento del chat si va al del comprador. */}
          {preview?.billedTo ? (
            <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                En Alegra se factura a <b>{preview.billedTo.name}</b>
                {preview.billedTo.identification ? ` (${preview.billedTo.identification})` : ''}. El
                documento que se envía al chat sí lleva el nombre del comprador.
              </span>
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-wash text-accent">
            <ReceiptText className="h-4 w-4" />
          </span>
          <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">
            Del IMEI a la factura
          </h3>
          <button
            type="button"
            onClick={addLine}
            className={cn(
              'ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-input bg-card px-2.5 py-1 text-[11.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-md:min-h-[40px] max-md:px-3.5',
              FOCUS_RING,
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </button>
        </div>

        {current.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-input bg-surface px-4 py-3.5 text-[13.5px] text-muted-foreground">
            Sube fotos de IMEI/serial en el chat, o agrega productos manualmente.
          </p>
        ) : (
          current.map((l) => (
            <LineRow
              key={l.key}
              orderId={orderId}
              line={l}
              fromPhoto={splitCodes(l.codesText).some((c) => photoCodes.has(c))}
              onPatch={(p) => patch(l.key, p)}
              onRemove={() => remove(l.key)}
            />
          ))
        )}

        {/* Total del pedido: cierra la seccion de productos (.total-row del mockup). */}
        <div className="!mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3 text-[15px]">
          <span className="text-muted-foreground">Total del pedido</span>
          <b className="text-[17px] font-extrabold tracking-[-0.01em] tabular-nums">
            {formatCOP(total)}
          </b>
        </div>
      </section>

      {/* Medios de pago (solo pedidos MONTADOS a mano): como en Alegra, hasta 3
          cuentas distintas. Si la suma no llega al total, la factura queda
          ABIERTA por el resto (p. ej. lo que se recauda contraentrega). */}
      {manual ? (
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CreditCard className="h-4 w-4" />
            </span>
            <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">
              Medios de pago
            </h3>
            <span className="ml-auto min-w-0 break-words text-right text-xs text-hint">
              solo pedidos montados a mano · hasta 3 pagos
            </span>
            {payments.length < 3 ? (
              <button
                type="button"
                onClick={() => setPayments((ps) => [...ps, emptyPayment()])}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-input bg-card px-2.5 py-1 text-[11.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-md:min-h-[40px] max-md:px-3.5',
                  FOCUS_RING,
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar pago
              </button>
            ) : null}
          </div>

          <div className="space-y-3 rounded-[14px] border border-border bg-surface px-4 py-3.5">
            {payments.map((p, i) => (
              <div
                key={p.key}
                className={cn('space-y-2.5', i > 0 && 'border-t border-dashed border-input pt-3')}
              >
                <div className="flex items-end gap-2.5">
                  <div className="min-w-0 flex-1">
                    {i === 0 ? (
                      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
                        Cuenta
                      </span>
                    ) : null}
                    <div className="relative">
                      <select
                        aria-label="Cuenta de Alegra"
                        value={p.accountId}
                        onChange={(e) =>
                          setPayments((ps) =>
                            ps.map((x) =>
                              x.key === p.key ? { ...x, accountId: e.target.value } : x,
                            ),
                          )
                        }
                        className="h-[38px] w-full min-w-0 max-w-full appearance-none rounded-[10px] border border-input bg-card px-3 pr-8 text-[13.5px] text-foreground outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-md:h-[42px]"
                      >
                        <option value="">Cuenta de Alegra...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hint" />
                    </div>
                  </div>
                  <div className="w-24 shrink-0 min-[400px]:w-28">
                    {i === 0 ? (
                      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
                        Valor
                      </span>
                    ) : null}
                    <Input
                      aria-label="Valor del pago"
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
                      className="h-[38px] rounded-[10px] border-input bg-card text-[13.5px] font-semibold tabular-nums shadow-none transition-colors placeholder:text-hint hover:border-accent motion-reduce:transition-none max-md:h-[42px]"
                    />
                  </div>
                  {payments.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
                      className={cn(
                        'grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] border border-input bg-card text-hint transition-colors hover:border-destructive hover:text-destructive motion-reduce:transition-none max-md:h-[42px] max-md:w-[42px]',
                        FOCUS_RING,
                      )}
                      aria-label="Quitar pago"
                    >
                      <Trash2 className="h-[15px] w-[15px]" />
                    </button>
                  ) : null}
                </div>

                <div>
                  {i === 0 ? (
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
                      Medio
                    </span>
                  ) : null}
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Medio de pago">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        aria-pressed={p.method === m.value}
                        onClick={() =>
                          setPayments((ps) =>
                            ps.map((x) => (x.key === p.key ? { ...x, method: m.value } : x)),
                          )
                        }
                        className={cn(
                          'rounded-full border px-[15px] py-[7px] text-[12.5px] font-bold transition-all [transition-duration:130ms] motion-reduce:transition-none max-md:min-h-[40px] max-md:px-4',
                          FOCUS_RING,
                          p.method === m.value
                            ? 'border-accent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.35)]'
                            : 'border-input bg-card text-muted-foreground hover:border-accent hover:text-accent',
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {paidTotal > total + 0.01 ? (
              <p className="flex items-start gap-2.5 rounded-xl bg-destructive/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] tabular-nums text-destructive">
                <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" />
                <span>
                  Los pagos ({formatCOP(paidTotal)}) superan el total ({formatCOP(total)}).
                </span>
              </p>
            ) : total - paidTotal > 0.01 ? (
              <p className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] tabular-nums text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" />
                <span>
                  Pagado {formatCOP(paidTotal)} de {formatCOP(total)} · quedan{' '}
                  <b className="font-extrabold">{formatCOP(total - paidTotal)}</b> — la factura sale
                  abierta por ese saldo (ej. recaudo contraentrega).
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2.5 rounded-xl bg-emerald-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] tabular-nums text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mt-px h-[15px] w-[15px] shrink-0" />
                <span>
                  Pagado {formatCOP(paidTotal)} de {formatCOP(total)} · queda cerrada/cobrada.
                </span>
              </p>
            )}
          </div>
        </section>
      ) : null}

      <div className="!mt-1.5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={() => invoice.mutate()}
          loading={invoicing}
          disabled={!canInvoice || busy}
          className={BTN_PRIMARY_CLS}
        >
          <CheckCircle2 className="h-[15px] w-[15px]" />
          Facturar en Alegra
        </Button>
        {/* "Hacer todo" solo en pedidos de marketplace: en los montados a mano
            la guia tiene decision propia (recaudo contraentrega) -> por pasos. */}
        {!manual ? (
          <Button
            variant="outline"
            onClick={() => processAll.mutate()}
            loading={doingAll}
            disabled={!canInvoice || !guideReady || busy}
            className={BTN_GHOST_CLS}
            title={
              guideReady
                ? 'Factura + guía + MKT en un solo paso, con la dirección tal cual viene de VTEX'
                : 'Faltan datos del destinatario: verifícalos en la pestaña Guía'
            }
          >
            <Zap className="h-[15px] w-[15px]" />
            Hacer todo
          </Button>
        ) : null}
        {manual ? (
          <span className="min-w-[min(100%,220px)] flex-1 text-xs leading-[1.45] text-hint">
            Pedido montado a mano: la factura sale con los medios de pago que elijas (hasta 3, como
            en Alegra).{' '}
            <span className="font-bold text-muted-foreground">
              Luego genera la guía en la pestaña Guía — ahí decides si va normal o con recaudo
              contraentrega. Este pedido no genera MKT.
            </span>
          </span>
        ) : (
          <span className="min-w-[min(100%,220px)] flex-1 text-xs leading-[1.45] text-hint">
            Se emite pagada con la cuenta &laquo;MARKETPLACE ADDI&raquo; y queda cerrada/cobrada.{' '}
            <span className="font-bold text-muted-foreground">
              &laquo;Hacer todo&raquo; encadena factura + guía + MKT usando la dirección tal cual
              viene de VTEX
              {guidePrev?.recipient.cityName ? ` (${guidePrev.recipient.cityName})` : ''}. Si
              necesitas corregirla, usa la pestaña Guía.
            </span>
          </span>
        )}
      </div>
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

/** Codigos sueltos de un texto ("356..., 357...") — solo para pintar. */
function splitCodes(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Un paso del recorrido de la linea (.step del mockup): pastilla redonda de 28px
 * unida a la siguiente por una linea de 2px que se pinta en cobalto cuando el
 * paso ya esta cumplido.
 */
function Step({
  n,
  title,
  desc,
  done,
  last = false,
  action,
  children,
}: {
  n: number;
  title: string;
  desc: ReactNode;
  done: boolean;
  last?: boolean;
  /** Control de la esquina (alineado con el titulo del paso). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn('relative flex gap-3.5', last ? 'pb-0' : 'pb-[18px]')}>
      {last ? null : (
        <span
          aria-hidden
          className={cn(
            'absolute bottom-0.5 left-[13px] top-[30px] w-0.5 rounded-sm',
            done ? 'bg-accent' : 'bg-input',
          )}
        />
      )}
      <span
        className={cn(
          'relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12.5px] font-extrabold',
          done
            ? 'border-accent bg-accent text-accent-foreground'
            : 'border-input bg-wash text-accent-ink',
        )}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="min-w-0 break-words pt-1 text-[13.5px] font-extrabold">{title}</div>
            <div className="mt-0.5 min-w-0 break-words text-[12.5px] leading-[1.45] text-muted-foreground">
              {desc}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function LineRow({
  orderId,
  line,
  fromPhoto,
  onPatch,
  onRemove,
}: {
  orderId: string;
  line: Line;
  /** La linea nacio de una FOTO del chat (paso 1 cumplido). */
  fromPhoto: boolean;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Al editar los codigos, re-buscar el producto con el primero (los de una foto
  // son el mismo equipo). Los codigos de una misma foto van juntos en la descripcion.
  const relookup = async () => {
    const first = line.codesText
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
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

  const hasCode = splitCodes(line.codesText).length > 0;
  const hasProduct = Boolean(line.itemId);

  return (
    <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
      {/* Paso 1 — la foto del chat: cumplido solo si esta linea nacio de una.
          En su esquina va el boton que quita la linea entera. */}
      <Step
        n={1}
        done={fromPhoto}
        title="Foto del IMEI"
        action={
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              'grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-input bg-card text-hint transition-colors hover:border-destructive hover:text-destructive motion-reduce:transition-none max-md:h-[42px] max-md:w-[42px]',
              FOCUS_RING,
            )}
            aria-label="Quitar"
          >
            <Trash2 className="h-[15px] w-[15px]" />
          </button>
        }
        desc={
          fromPhoto
            ? 'Llegó por la conversación del pedido — el código se lee automáticamente.'
            : 'Sube la foto de la caja en la conversación y el código se lee solo; también puedes escribirlo abajo.'
        }
      >
        {fromPhoto ? (
          <span className="mt-[9px] inline-flex max-w-full items-center gap-2.5 rounded-[11px] border border-input bg-card p-[7px_12px_7px_7px]">
            <span
              aria-hidden
              className="relative h-[38px] w-[38px] shrink-0 overflow-hidden rounded-lg bg-[linear-gradient(160deg,#33415c_20%,#1f2a44_60%,#33415c)]"
            >
              <span className="absolute inset-x-[18%] inset-y-[30%] rounded-[3px] bg-[repeating-linear-gradient(90deg,#dfe6f5_0_2px,transparent_2px_5px)]" />
            </span>
            <span className="min-w-0">
              <b className="block min-w-0 break-words text-[12.5px] font-bold leading-tight">
                Foto del equipo
              </b>
              <span className="mt-0.5 block min-w-0 break-words text-[11px] leading-tight text-hint">
                conversación del pedido
              </span>
            </span>
          </span>
        ) : null}
      </Step>

      {/* Paso 2 — el codigo leido (editable). */}
      <Step
        n={2}
        done={hasCode}
        title="IMEI leído"
        desc="Varios códigos = dual-SIM: sepáralos con coma."
      >
        <div className="mt-[9px]">
          <Input
            aria-label="IMEI o serial"
            value={line.codesText}
            onChange={(e) => onPatch({ codesText: e.target.value })}
            onBlur={relookup}
            placeholder="Escribe o pega el IMEI"
            className="h-[38px] rounded-[10px] border-input bg-card font-mono text-[12.5px] tracking-[0.02em] shadow-none transition-colors placeholder:font-sans placeholder:text-hint hover:border-accent motion-reduce:transition-none max-md:h-[42px]"
          />
        </div>
      </Step>

      {/* Paso 3 — el producto de Alegra + su precio y cantidad. */}
      <Step
        n={3}
        done={hasProduct}
        last
        title="Producto en Alegra"
        desc="Se busca por el IMEI en el espejo local de compras."
      >
        {line.itemId ? (
          <div className="mt-[9px] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-input bg-card px-3.5 py-2.5">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-emerald-500/10 text-[15px] font-extrabold text-emerald-600 dark:text-emerald-400">
              A
            </span>
            <span className="min-w-[min(100%,110px)] flex-1">
              <span className="block min-w-0 break-words text-[13px] font-bold leading-tight">
                {line.productName}
              </span>
              {Number(line.price) > 0 ? (
                <span className="mt-0.5 block text-[11.5px] tabular-nums text-hint">
                  {line.quantity} × {formatCOP(Number(line.price))}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className={cn(
                'ml-auto shrink-0 whitespace-nowrap rounded-[9px] border border-input bg-card px-2.5 py-1 text-[11.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-md:min-h-[40px] max-md:px-3.5',
                FOCUS_RING,
              )}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              'mt-[9px] flex min-h-[38px] w-full items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 py-2.5 text-left text-[13.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-md:min-h-[42px]',
              FOCUS_RING,
            )}
          >
            {resolving ? (
              <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <Search className="h-[15px] w-[15px] shrink-0" />
            )}
            {resolving ? 'Buscando producto...' : 'Elegir producto de Alegra'}
          </button>
        )}

        {pickerOpen ? (
          <div className="mt-[9px]">
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
          </div>
        ) : null}

        {/* AVISO de la IA (experta en celulares): el IMEI leido trae una compra
            que NO corresponde al producto del pedido. Solo avisa, no bloquea. */}
        {line.mismatch ? (
          <div className="mt-[9px] flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" />
            <span className="min-w-0 break-words">
              <b>Aviso de la IA:</b> el IMEI corresponde a «{line.mismatch.found}» y el pedido dice
              «{line.mismatch.expected}».{line.mismatch.note ? ` ${line.mismatch.note}.` : ''}{' '}
              Verifica antes de facturar (puedes facturar igual).
            </span>
          </div>
        ) : null}

        {/* Precio + cantidad */}
        <div className="mt-[9px] flex items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
              Precio
            </span>
            <Input
              type="number"
              inputMode="numeric"
              value={line.price}
              onChange={(e) => onPatch({ price: e.target.value })}
              placeholder="0"
              className="h-[38px] rounded-[10px] border-input bg-card text-[13.5px] font-semibold tabular-nums shadow-none transition-colors placeholder:text-hint hover:border-accent motion-reduce:transition-none max-md:h-[42px]"
            />
          </label>
          <label className="w-20 shrink-0">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-hint">
              Cant.
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={line.quantity}
              onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
              className="h-[38px] rounded-[10px] border-input bg-card text-[13.5px] font-semibold tabular-nums shadow-none transition-colors hover:border-accent motion-reduce:transition-none max-md:h-[42px]"
            />
          </label>
        </div>
      </Step>
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
    queryFn: () =>
      api.get<AlegraItem[]>(`/v1/orders/${orderId}/alegra-items?q=${encodeURIComponent(q.trim())}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

  return (
    <div className="rounded-xl border border-input bg-card p-2 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <div className="flex min-h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-input bg-card px-3 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent hover:border-accent motion-reduce:transition-none max-md:min-h-[42px]">
          <Search className="h-[15px] w-[15px] shrink-0 text-hint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto en Alegra..."
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-hint"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-[9px] border border-input bg-card px-2.5 py-1 text-[11.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent motion-reduce:transition-none max-md:min-h-[42px] max-md:px-3.5',
            FOCUS_RING,
          )}
        >
          Cerrar
        </button>
      </div>
      {q.trim().length >= 2 ? (
        <ul className="mt-1 max-h-56 overflow-auto">
          {isFetching ? (
            <li className="px-3 py-2 text-[12.5px] text-hint">Buscando...</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-[12.5px] text-hint">Sin resultados.</li>
          ) : (
            items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onPick(it)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-[13.5px] transition-colors hover:bg-wash hover:text-accent-ink motion-reduce:transition-none',
                    FOCUS_RING,
                  )}
                >
                  <span className="min-w-0 break-words leading-snug">{it.name}</span>
                  {it.price ? (
                    <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-hint">
                      {formatCOP(Number(it.price))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="mt-1 px-3 py-2 text-[12.5px] text-hint">Escribe al menos 2 letras.</p>
      )}
    </div>
  );
}

/** Pedido ya facturado: se muestra la factura emitida; NO se puede re-facturar. */
function InvoicedView({ invoice }: { invoice: { number: string; total: string; status: string } }) {
  const paid = invoice.status === 'closed';
  return (
    <div className="p-[22px]">
      <div className="rounded-[14px] border border-emerald-500/20 bg-emerald-500/10 p-6 text-center shadow-[var(--shadow-card)]">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-[13px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <h3 className="mt-3 break-words text-base font-extrabold tracking-[-0.01em]">
          Factura{' '}
          <span className="break-all font-mono text-[0.92em] tracking-[0.02em]">
            {invoice.number}
          </span>{' '}
          emitida
        </h3>
        <p className="mt-1.5 text-[13.5px] tabular-nums text-muted-foreground">
          Total {formatCOP(Number(invoice.total))}
        </p>
        <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-[3px] text-[11.5px] font-bold text-emerald-600 dark:text-emerald-400">
          {paid ? 'Cerrada / cobrada' : `Estado: ${invoice.status}`}
        </span>
      </div>
      <p className="mt-4 text-center text-xs leading-[1.45] text-hint">
        Este pedido ya fue facturado; el PDF está en la conversación. Para volver a facturar, anula
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
