'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PackagePlus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraItem, CoordinadoraCity, OrderSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { CityPicker } from '@/components/city-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

/**
 * "MONTAR PEDIDO": pedido EXTERNO a las plataformas escrito a mano en la sede
 * (recompras Krediya, ventas directas...). Reemplaza el mensaje kilometrico que
 * antes se escribia en Google Chat: nombre, cedula, telefono, correo, direccion,
 * ciudad (catalogo DANE), producto (catalogo de Alegra) y precio.
 *
 * Estos pedidos NO generan MKT (no existen en VTEX): solo factura y guia. En la
 * factura se eligen los medios de pago (hasta 3, de Alegra) y en la guia se
 * puede pedir recaudo contraentrega.
 */
export function MountOrderDialog({
  warehouseId,
  warehouseName,
  onClose,
  onCreated,
}: {
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
  onCreated: (order: OrderSummary) => void;
}) {
  const [name, setName] = useState('');
  const [cedula, setCedula] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState<CoordinadoraCity | null>(null);
  const [item, setItem] = useState<AlegraItem | null>(null);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');

  // Esc cierra + scroll del fondo bloqueado mientras el dialogo esta abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.document.body.style.overflow = prev;
    };
  }, [onClose]);

  const qty = Math.max(1, Number(quantity) || 1);
  const total = (Number(price) || 0) * qty;
  const canSubmit =
    name.trim().length >= 2 &&
    cedula.trim().length >= 3 &&
    phone.trim().length >= 5 &&
    address.trim().length >= 3 &&
    city !== null &&
    item !== null &&
    Number(price) > 0;

  const create = useMutation({
    mutationFn: () =>
      api.post<OrderSummary>('/v1/orders/manual', {
        warehouseId,
        customer: {
          name: name.trim(),
          document: cedula.trim(),
          phone: phone.trim(),
          email: email.trim() ? email.trim() : null,
          address: address.trim(),
          cityCode: city!.code,
          cityName: city!.name,
          cityDepartment: city!.department || null,
        },
        product: {
          itemId: item!.id,
          name: item!.name,
          price: Number(price),
          quantity: qty,
        },
      }),
    onSuccess: (order) => {
      toast.success(`Pedido ${order.externalId} montado`);
      onCreated(order);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo montar el pedido'),
  });

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        className="shadow-pop flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <PackagePlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight">Montar pedido</h2>
            <p className="truncate text-[11.5px] text-muted-foreground">
              Externo a las plataformas · {warehouseName} · solo factura y guía (sin MKT)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Formulario */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-5">
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Cliente
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Herik Santiago Gómez" />
              </Field>
              <Field label="Cédula">
                <Input
                  inputMode="numeric"
                  value={cedula}
                  onChange={(e) => setCedula(e.target.value)}
                  placeholder="1000692683"
                />
              </Field>
              <Field label="Teléfono">
                <Input
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="3138764163"
                />
              </Field>
              <Field label="Correo (opcional)">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@gmail.com"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Dirección (incluye punto de referencia si aplica)">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Carrera 7A #12-C10, Conjunto San Telmo casa 33"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Ciudad">
                  <CityPicker
                    value={city ? `${city.name} — ${city.department}` : ''}
                    onPick={setCity}
                    search={(q) =>
                      api.get<CoordinadoraCity[]>(
                        `/v1/warehouses/${warehouseId}/coordinadora/city-search?q=${encodeURIComponent(q)}`,
                      )
                    }
                    queryKey={`mount-${warehouseId}`}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Producto (del catálogo de Alegra)
            </h3>
            <WarehouseItemPicker
              warehouseId={warehouseId}
              item={item}
              onPick={(it) => {
                setItem(it);
                if (it.price && !price) setPrice(it.price);
              }}
              onClear={() => setItem(null)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio de venta (COP)">
                <Input
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="1600000"
                  className="tabular-nums"
                />
              </Field>
              <Field label="Cantidad">
                <Input
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
                  className="tabular-nums"
                />
              </Field>
            </div>
          </section>
        </div>

        {/* Pie: total + crear */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums leading-tight">{formatCOP(total)}</p>
          </div>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!canSubmit || create.isPending}>
            <PackagePlus className="h-4 w-4" />
            Montar pedido
          </Button>
        </div>
      </div>
    </div>,
    window.document.body,
  );
}

/** Buscador de items del catalogo de Alegra de la SEDE (sin pedido de por medio). */
function WarehouseItemPicker({
  warehouseId,
  item,
  onPick,
  onClear,
}: {
  warehouseId: string;
  item: AlegraItem | null;
  onPick: (item: AlegraItem) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data: items = [], isFetching } = useQuery({
    queryKey: ['wh-alegra-items', warehouseId, q.trim()],
    queryFn: () =>
      api.get<AlegraItem[]>(
        `/v1/warehouses/${warehouseId}/alegra/items?q=${encodeURIComponent(q.trim())}`,
      ),
    enabled: open && q.trim().length >= 2,
    staleTime: 30_000,
  });

  if (item) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <span className="break-words font-medium leading-snug">{item.name}</span>
        <button
          type="button"
          onClick={() => {
            onClear();
            setOpen(true);
          }}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder="Buscar producto en Alegra..."
          className="h-8 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {q.trim().length >= 2 ? (
        <ul className="mt-1 max-h-48 overflow-auto">
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
        <p className="mt-1 px-2 py-1 text-[11px] text-muted-foreground">
          Escribe al menos 2 letras (ej. «TV HYUNDAI 50»).
        </p>
      )}
    </div>
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
