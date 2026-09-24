'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PackagePlus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AlegraItem, CoordinadoraCity, OrderSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { CityPicker } from '@/components/city-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { BADGE_COLOR_CLASSES, usePlatforms } from './platform-badge';

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
/**
 * Una linea del pedido. Precio y cantidad viven como TEXTO porque son campos a
 * medio escribir: pasarlos a numero aqui convierte un "" en 0 y el usuario ve
 * un cero que el no puso.
 */
interface Line {
  item: AlegraItem;
  price: string;
  quantity: string;
}

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
  const [platformId, setPlatformId] = useState('');
  const [name, setName] = useState('');
  const [cedula, setCedula] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState<CoordinadoraCity | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const addLine = (it: AlegraItem): void => {
    setLines((prev) =>
      // Repetir el mismo producto es subir la cantidad, no abrir otra linea:
      // en la factura serian dos renglones identicos.
      prev.some((l) => l.item.id === it.id)
        ? prev.map((l) =>
            l.item.id === it.id ? { ...l, quantity: String(Number(l.quantity || '1') + 1) } : l,
          )
        : [...prev, { item: it, price: it.price ?? '', quantity: '1' }],
    );
  };
  const patchLine = (id: string, patch: Partial<Line>): void =>
    setLines((prev) => prev.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string): void => setLines((prev) => prev.filter((l) => l.item.id !== id));

  // Plataformas elegibles (VTEX no: esos pedidos llegan solos por la integracion).
  const platformsQuery = usePlatforms();
  const platforms = (platformsQuery.data ?? []).filter((p) => p.id !== 'vtex');

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

  const qtyOf = (l: Line): number => Math.max(1, Number(l.quantity) || 1);
  const total = lines.reduce((s, l) => s + (Number(l.price) || 0) * qtyOf(l), 0);
  const canSubmit =
    platformId.length > 0 &&
    name.trim().length >= 2 &&
    cedula.trim().length >= 3 &&
    phone.trim().length >= 5 &&
    address.trim().length >= 3 &&
    city !== null &&
    lines.length > 0 &&
    // Todas las lineas con precio: una en cero pasaria a la factura en cero.
    lines.every((l) => Number(l.price) > 0);

  const create = useMutation({
    mutationFn: () =>
      api.post<OrderSummary>('/v1/orders/manual', {
        warehouseId,
        platformId,
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
        products: lines.map((l) => ({
          itemId: l.item.id,
          name: l.item.name,
          price: Number(l.price),
          quantity: qtyOf(l),
        })),
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
          {/* Plataforma de origen: pills con el color real de su badge. */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Plataforma
            </h3>
            {platformsQuery.isPending ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                Cargando plataformas...
              </p>
            ) : platformsQuery.isError ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                No se pudieron cargar las plataformas.{' '}
                <button
                  type="button"
                  onClick={() => platformsQuery.refetch()}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Reintentar
                </button>
              </p>
            ) : platforms.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                No hay plataformas creadas. Un administrador puede crearlas en Ajustes.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {platforms.map((p) => {
                  const active = platformId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatformId(p.id)}
                      className={cn(
                        'inline-flex items-center gap-[6px] rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-all',
                        BADGE_COLOR_CLASSES[p.color],
                        active
                          ? 'ring-2 ring-accent ring-offset-2 ring-offset-card'
                          : 'opacity-60 hover:opacity-100',
                      )}
                    >
                      <span
                        aria-hidden
                        className="h-[6px] w-[6px] shrink-0 rounded-full bg-current"
                      />
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Cliente
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Herik Santiago Gómez"
                />
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
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Productos (del catálogo de Alegra)
              </h3>
              {lines.length > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                  {lines.length}
                </span>
              ) : null}
            </div>

            {lines.map((l) => (
              <div key={l.item.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
                    {l.item.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(l.item.id)}
                    aria-label={`Quitar ${l.item.name}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="Precio de venta (COP)">
                    <Input
                      inputMode="numeric"
                      value={l.price}
                      onChange={(e) =>
                        patchLine(l.item.id, { price: e.target.value.replace(/[^\d.]/g, '') })
                      }
                      placeholder="1600000"
                      className="tabular-nums"
                    />
                  </Field>
                  <Field label="Cantidad">
                    <Input
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) =>
                        patchLine(l.item.id, { quantity: e.target.value.replace(/\D/g, '') })
                      }
                      className="tabular-nums"
                    />
                  </Field>
                </div>
              </div>
            ))}

            <WarehouseItemPicker
              warehouseId={warehouseId}
              hasLines={lines.length > 0}
              onPick={addLine}
            />
          </section>
        </div>

        {/* Pie: total + crear */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums leading-tight">{formatCOP(total)}</p>
          </div>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!canSubmit || create.isPending}
          >
            <PackagePlus className="h-4 w-4" />
            Montar pedido
          </Button>
        </div>
      </div>
    </div>,
    window.document.body,
  );
}

/**
 * Buscador de items del catalogo de Alegra de la SEDE (sin pedido de por medio).
 * AGREGA a la lista: se queda abierto tras elegir, porque el caso que existe es
 * el de varios productos seguidos.
 */
function WarehouseItemPicker({
  warehouseId,
  hasLines,
  onPick,
}: {
  warehouseId: string;
  hasLines: boolean;
  onPick: (item: AlegraItem) => void;
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
          placeholder={hasLines ? 'Agregar otro producto...' : 'Buscar producto en Alegra...'}
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
                  onClick={() => {
                    onPick(it);
                    // Se limpia el texto pero NO se cierra: lo normal es seguir
                    // agregando, y volver a abrir el buscador cada vez estorba.
                    setQ('');
                  }}
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
