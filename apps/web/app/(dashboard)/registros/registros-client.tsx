'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  ChevronDown,
  FileX,
  Layers,
  Loader2,
  LogIn,
  MessageCircle,
  PackageCheck,
  PackagePlus,
  PackageX,
  Pencil,
  PlusCircle,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  Truck,
  Undo2,
  UserMinus,
  UserPlus,
  UserRoundCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AuditCategory, AuditEntry, AuditPage, MemberSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn, replaceUrlParams, titleCaseName } from '@/lib/utils';

import { DateRangeFilter } from '../orders/date-range-filter';

/* ------------------------------ vocabulario ------------------------------ */

const CATEGORIES: { value: AuditCategory | ''; label: string; icon: LucideIcon }[] = [
  { value: '', label: 'Todo', icon: Layers },
  { value: 'acceso', label: 'Ingresos', icon: LogIn },
  { value: 'pedidos', label: 'Pedidos', icon: ArrowRightLeft },
  { value: 'facturas', label: 'Facturas', icon: ReceiptText },
  { value: 'guias', label: 'Guías', icon: Truck },
  { value: 'mensajes', label: 'Mensajes', icon: MessageCircle },
  { value: 'equipo', label: 'Equipo', icon: Users },
  { value: 'sedes', label: 'Sedes', icon: Building2 },
];
const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value).filter(Boolean));

type Tone = 'cobalt' | 'sky' | 'emerald' | 'amber' | 'red' | 'violet' | 'muted';

const TONE_CLS: Record<Tone, string> = {
  cobalt: 'bg-wash text-accent-ink',
  sky: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  red: 'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  muted: 'bg-muted text-muted-foreground',
};

/** Icono y color de cada accion: se reconoce el tipo de un vistazo, sin leer. */
function lookOf(action: string): { icon: LucideIcon; tone: Tone } {
  switch (action) {
    case 'user.login':
      return { icon: LogIn, tone: 'sky' };
    case 'user.login.failed':
      return { icon: ShieldAlert, tone: 'amber' };
    case 'assigned':
      return { icon: PlusCircle, tone: 'cobalt' };
    case 'transferred':
      return { icon: ArrowRightLeft, tone: 'cobalt' };
    case 'returned':
      return { icon: Undo2, tone: 'cobalt' };
    case 'created':
      return { icon: PackagePlus, tone: 'cobalt' };
    case 'packed':
      return { icon: PackageCheck, tone: 'emerald' };
    case 'unpacked':
      return { icon: PackageX, tone: 'muted' };
    case 'manual_completed':
    case 'vtex_invoiced':
      return { icon: BadgeCheck, tone: 'emerald' };
    case 'invoiced':
      return { icon: ReceiptText, tone: 'emerald' };
    case 'vtex_invoiced_external':
      return { icon: ReceiptText, tone: 'amber' };
    case 'guide_generated':
      return { icon: Truck, tone: 'amber' };
    case 'order.deleted':
      return { icon: FileX, tone: 'red' };
    case 'chat.message_deleted':
    case 'wa.message_deleted':
    case 'wa.chat_cleared':
    case 'wa.chat_deleted':
      return { icon: Trash2, tone: 'red' };
    case 'chat.message_edited':
    case 'wa.message_edited':
      return { icon: Pencil, tone: 'violet' };
    case 'member.created':
      return { icon: UserPlus, tone: 'violet' };
    case 'member.updated':
      return { icon: UserRoundCog, tone: 'violet' };
    case 'member.removed':
      return { icon: UserMinus, tone: 'red' };
    case 'warehouse.archived':
      return { icon: Archive, tone: 'muted' };
    case 'warehouse.created':
    case 'warehouse.updated':
      return { icon: Building2, tone: 'muted' };
    default:
      return { icon: ScrollText, tone: 'muted' };
  }
}

/**
 * Acciones que llegan EN TANDA (asignar 30 pedidos de un clic): se pintan como
 * una sola fila "Asignó 30 pedidos a PASTO" que se despliega, en vez de 30
 * filas iguales que tapan todo lo demas.
 */
const BATCHABLE = new Set(['assigned', 'transferred', 'returned', 'packed', 'unpacked']);
const BATCH_WINDOW_MS = 90_000;

interface Row {
  key: string;
  first: AuditEntry;
  /** Las entradas de la tanda (1 si no es tanda). */
  entries: AuditEntry[];
}

function batchRows(items: AuditEntry[]): Row[] {
  const rows: Row[] = [];
  for (const e of items) {
    const last = rows[rows.length - 1];
    const prev = last?.entries[last.entries.length - 1];
    if (
      last &&
      prev &&
      BATCHABLE.has(e.action) &&
      e.action === prev.action &&
      e.actorId === prev.actorId &&
      e.summary === prev.summary &&
      dayKey(e.createdAt) === dayKey(prev.createdAt) &&
      Math.abs(Date.parse(prev.createdAt) - Date.parse(e.createdAt)) <= BATCH_WINDOW_MS
    ) {
      last.entries.push(e);
      continue;
    }
    rows.push({ key: e.id, first: e, entries: [e] });
  }
  return rows;
}

const dayKey = (iso: string): string => format(new Date(iso), 'yyyy-MM-dd');

function dayTitle(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoy';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ayer';
  const label = format(d, "EEEE d 'de' MMMM", { locale: es });
  const withYear =
    d.getFullYear() === today.getFullYear() ? label : `${label} de ${d.getFullYear()}`;
  return withYear.charAt(0).toUpperCase() + withYear.slice(1);
}

/** "Asignó el pedido a PASTO" -> "Asignó 30 pedidos a PASTO". */
function batchSummary(summary: string, n: number): string {
  if (n <= 1) return summary;
  return summary.includes('el pedido')
    ? summary.replace('el pedido', `${n} pedidos`)
    : `${summary} · ${n} pedidos`;
}

/* -------------------------------- pagina -------------------------------- */

export function RegistrosClient() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawCat = searchParams.get('cat') ?? '';
  const category = CATEGORY_VALUES.has(rawCat as AuditCategory) ? (rawCat as AuditCategory) : '';
  const actor = searchParams.get('actor') ?? '';
  const q = searchParams.get('q') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    replaceUrlParams(pathname, params);
  };

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 60_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['audit', { category, actor, q, from, to }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      if (category) params.set('category', category);
      if (actor) params.set('actor', actor);
      if (q) params.set('q', q);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get<AuditPage>(`/v1/audit?${params.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const rows = useMemo(() => batchRows(items), [items]);

  // Scroll infinito: al asomarse el final, la siguiente pagina.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filtered = Boolean(category || actor || q || from || to);

  return (
    <div>
      {/* Encabezado: mismo lenguaje que las vistas de pedidos. */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-0 h-40 w-full max-w-[540px] rounded-full bg-accent/[0.07] blur-3xl"
        />
        <nav className="relative mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="font-medium">Workspace</span>
          <span aria-hidden>·</span>
          <span>Registros</span>
        </nav>
        <div className="relative flex flex-wrap items-center gap-3">
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">Registros</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <ShieldAlert className="h-3 w-3" />
            Solo lo ves tú
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void feed.refetch()}
            className="ml-auto h-[30px] rounded-lg text-xs"
            disabled={feed.isRefetching}
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                feed.isRefetching &&
                  !isFetchingNextPage &&
                  'animate-spin motion-reduce:animate-none',
              )}
            />
            Actualizar
          </Button>
        </div>
        <p className="relative mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
          Cada movimiento que deja rastro: ingresos, facturas, guías, movidas de sede, mensajes
          eliminados o editados y cambios del equipo.
        </p>
      </div>

      {/* Filtros */}
      <div className="mt-5 space-y-2.5">
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = category === c.value;
            return (
              <button
                key={c.value || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setParam('cat', c.value)}
                className={cn(
                  'inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors [transition-duration:130ms]',
                  on
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={(v) => setParam('q', v)} />
          <ActorPicker members={members} value={actor} onChange={(v) => setParam('actor', v)} />
          <DateRangeFilter />
          {filtered ? (
            <button
              type="button"
              onClick={() => replaceUrlParams(pathname, new URLSearchParams())}
              className="inline-flex h-[34px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </div>

      {/* Bitacora */}
      <div className="mt-5">
        {feed.isPending ? (
          <FeedSkeleton />
        ) : feed.isError ? (
          <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/5 px-4 py-8 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-amber-600 dark:text-amber-400" />
            <p className="mt-2 text-[13.5px] font-semibold">No se pudieron cargar los registros</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {feed.error instanceof ApiError ? feed.error.message : 'El servidor no respondió.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void feed.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reintentar
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 py-14 text-center">
            <ScrollText className="mx-auto h-6 w-6 text-hint" />
            <p className="mt-2 text-[13.5px] font-semibold">
              {filtered ? 'Nada coincide con estos filtros' : 'Todavía no hay registros'}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {filtered
                ? 'Prueba con otra categoría, persona o rango de fechas.'
                : 'Aquí aparece cada movimiento en cuanto pasa.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupByDay(rows).map(([day, dayRows]) => (
              <section key={day}>
                <h2 className="sticky top-[52px] z-[5] -mx-1 mb-2 flex items-center gap-2.5 bg-background/90 px-1 py-1.5 backdrop-blur md:top-0">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint">
                    {dayTitle(dayRows[0]!.first.createdAt)}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="font-mono text-[10.5px] tabular-nums text-hint">
                    {dayRows.reduce((n, r) => n + r.entries.length, 0)}
                  </span>
                </h2>
                <ol className="shadow-card divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {dayRows.map((r) => (
                    <AuditRow key={r.key} row={r} />
                  ))}
                </ol>
              </section>
            ))}
            <div ref={sentinelRef} className="flex justify-center py-2">
              {isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin text-hint motion-reduce:animate-none" />
              ) : hasNextPage ? (
                <Button variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                  Cargar más
                </Button>
              ) : (
                <span className="text-[11.5px] text-hint">No hay más registros</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function groupByDay(rows: Row[]): Array<[string, Row[]]> {
  const out: Array<[string, Row[]]> = [];
  for (const r of rows) {
    const k = dayKey(r.first.createdAt);
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1].push(r);
    else out.push([k, [r]]);
  }
  return out;
}

/* --------------------------------- fila --------------------------------- */

function AuditRow({ row }: { row: Row }) {
  const { first, entries } = row;
  const [open, setOpen] = useState(false);
  const look = lookOf(first.action);
  const Icon = look.icon;
  const many = entries.length > 1;
  const orders = entries
    .map((e) => e.order)
    .filter((o): o is NonNullable<AuditEntry['order']> => o !== null);
  const shown = many && !open ? orders.slice(0, 3) : orders;

  return (
    <li className="flex gap-3 px-3.5 py-3 transition-colors hover:bg-accent/[0.03] sm:px-4">
      <time
        dateTime={first.createdAt}
        className="hidden w-[52px] shrink-0 pt-[5px] font-mono text-[11.5px] tabular-nums text-muted-foreground sm:block"
        title={format(new Date(first.createdAt), "d MMM yyyy '·' HH:mm:ss", { locale: es })}
      >
        {format(new Date(first.createdAt), 'HH:mm')}
      </time>
      <span
        className={cn(
          'grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[9px]',
          TONE_CLS[look.tone],
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug">
          {/* Con autor: "Ana asignó el pedido…". Sin autor (lo hizo el sistema o
              el celular): la frase sola, que ya dice quien fue. */}
          {first.actorName ? (
            <>
              <span className="font-semibold text-foreground">{first.actorName}</span>{' '}
              <span className="text-foreground/80">
                {lowerFirst(batchSummary(first.summary, entries.length))}
              </span>
            </>
          ) : (
            <>
              <span className="text-foreground/80">
                {batchSummary(first.summary, entries.length)}
              </span>
              <span className="ml-1.5 rounded-[5px] bg-muted px-1.5 py-px align-[1px] text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Automático
              </span>
            </>
          )}
          <span className="ml-1.5 font-mono text-[11px] tabular-nums text-hint sm:hidden">
            {format(new Date(first.createdAt), 'HH:mm')}
          </span>
        </p>

        {orders.length > 0 || first.phone ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {shown.map((o, i) => (
              <OrderChip key={`${o.id}-${i}`} order={o} />
            ))}
            {many && orders.length > 3 ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-[24px] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold text-accent-ink hover:bg-accent/10"
              >
                {open ? 'Ver menos' : `+${orders.length - 3} más`}
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </button>
            ) : null}
            {first.phone ? (
              <Link
                href={`/whatsapp?chat=${encodeURIComponent(first.phone)}`}
                className="inline-flex h-[24px] items-center gap-1 rounded-md border border-border bg-surface px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
              >
                <MessageCircle className="h-3 w-3" />
                {first.phone}
              </Link>
            ) : null}
          </div>
        ) : null}

        {first.detail ? <Detail action={first.action} text={first.detail} /> : null}
        {first.ip ? <p className="mt-1 font-mono text-[10.5px] text-hint">IP {first.ip}</p> : null}
      </div>
    </li>
  );
}

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function OrderChip({ order }: { order: NonNullable<AuditEntry['order']> }) {
  const href = order.warehouseId
    ? `/warehouses/${order.warehouseId}?order=${order.id}`
    : `/orders?order=${order.id}`;
  return (
    <Link
      href={href}
      title="Abrir el pedido"
      className="inline-flex h-[24px] max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11.5px] transition-colors hover:border-accent/50 hover:bg-accent/[0.06]"
    >
      <span className="font-mono text-[11px] text-muted-foreground">{order.externalId}</span>
      {order.customerName ? (
        <span className="truncate font-medium text-foreground">
          {titleCaseName(order.customerName)}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Texto extra de la fila. Lo borrado va en un bloque rojo (lo que decia); los
 * cambios "Campo: antes → despues" se leen como pares etiqueta/valor.
 */
function Detail({ action, text }: { action: string; text: string }) {
  const removed = action.endsWith('_deleted') || action === 'member.removed';
  const lines = text.split('\n').filter(Boolean);
  const labeled = lines.map((l) => {
    const m = /^(Antes|Ahora|Rol|Nombre|Sedes|Prefijo de factura): ([\s\S]*)$/.exec(l);
    return m ? { label: m[1]!, value: m[2]! } : { label: null, value: l };
  });
  return (
    <div
      className={cn(
        'mt-2 max-w-[78ch] rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
        removed
          ? 'border-red-500/25 bg-red-500/[0.05] text-red-800 dark:text-red-200'
          : 'border-border bg-surface text-muted-foreground',
      )}
    >
      {removed && action.endsWith('_deleted') ? (
        <span className="mb-0.5 block text-[10.5px] font-bold uppercase tracking-[0.07em] text-red-600/80 dark:text-red-300/80">
          Decía
        </span>
      ) : null}
      {labeled.map((l, i) => (
        <Fragment key={i}>
          {l.label ? (
            <span className="flex gap-2">
              <span
                className={cn(
                  'w-[58px] shrink-0 text-[10.5px] font-bold uppercase leading-[20px] tracking-[0.06em]',
                  l.label === 'Ahora' ? 'text-accent-ink' : 'text-hint',
                )}
              >
                {l.label}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-foreground/85">
                {l.value}
              </span>
            </span>
          ) : (
            <span className="block whitespace-pre-wrap break-words">{l.value}</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ------------------------------- controles ------------------------------- */

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [term, setTerm] = useState(value);
  // El padre recrea onChange en cada render: por ref, para que el debounce no
  // se reinicie cada vez que llega una pagina.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // La URL manda (limpiar filtros, atras/adelante).
  useEffect(() => setTerm(value), [value]);
  useEffect(() => {
    if (term.trim() === value) return;
    const t = setTimeout(() => onChangeRef.current(term.trim()), 350);
    return () => clearTimeout(t);
  }, [term, value]);

  return (
    <label className="relative flex h-[34px] w-full items-center sm:w-[280px]">
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        maxLength={120}
        placeholder="Pedido, cliente o persona…"
        className="h-full w-full rounded-lg border border-input bg-card pl-8 pr-8 text-[16px] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/60 md:text-[13px]"
      />
      {term ? (
        <button
          type="button"
          onClick={() => setTerm('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-1.5 grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </label>
  );
}

function ActorPicker({
  members,
  value,
  onChange,
}: {
  members: MemberSummary[];
  value: string;
  onChange: (v: string) => void;
}) {
  const sorted = [...members].sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'),
  );
  return (
    <label className="relative inline-flex h-[34px] items-center">
      <Users className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/70" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filtrar por persona"
        className={cn(
          'h-full max-w-[230px] appearance-none truncate rounded-lg border bg-card pl-8 pr-7 text-[16px] outline-none transition-colors focus:border-accent/60 md:text-xs',
          value
            ? 'border-accent/40 font-semibold text-foreground'
            : 'border-input text-muted-foreground',
        )}
      >
        <option value="">Todas las personas</option>
        {sorted.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name ?? m.email}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground/70" />
    </label>
  );
}

function FeedSkeleton() {
  return (
    <div className="shadow-card divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="hidden h-3 w-10 animate-pulse rounded bg-muted sm:block" />
          <div className="h-7 w-7 animate-pulse rounded-[9px] bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div
              className="h-3 w-2/3 animate-pulse rounded bg-muted"
              style={{ width: `${45 + ((i * 17) % 40)}%` }}
            />
            <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
