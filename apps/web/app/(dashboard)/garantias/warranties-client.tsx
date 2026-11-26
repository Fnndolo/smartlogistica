'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Paperclip, Search, ShieldPlus, X } from 'lucide-react';
import {
  WARRANTY_STATUS_LABEL,
  warrantyListFilterSchema,
  type WarrantyListFilter,
  type WarrantyListResponse,
  type WarrantyStatus,
  type WarrantySummary,
} from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { cn, replaceUrlParams, titleCaseName } from '@/lib/utils';

import { ClaimChip } from '../orders/claim-chip';
import { useOrdersStream } from '../orders/use-orders-stream';
import { WarrantyDrawer } from './warranty-drawer';
import { WarrantyFormDialog } from './warranty-form';
import { AgeChip, STATUS_ICON, WarrantyStatusBadge, formatDay, radicado } from './warranty-ui';

const PAGE_SIZE = 50;

/** Las tarjetas de arriba: cada estado del ciclo (y filtran la lista). */
const STAGES: { status: WarrantyStatus; sub: string; tint: string }[] = [
  { status: 'received', sub: 'en la tienda', tint: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  {
    status: 'at_supplier',
    sub: 'por fuera',
    tint: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  },
  {
    status: 'ready',
    sub: 'para entregar',
    tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  { status: 'closed', sub: 'resueltas', tint: 'bg-muted text-muted-foreground' },
];

const FILTERS: { id: WarrantyListFilter; label: string }[] = [
  { id: 'open', label: 'En trámite' },
  { id: 'all', label: 'Todas' },
];

/**
 * GARANTIAS: la hoja de calculo hecha vista. Arriba el pulso por estado (que
 * filtra), la busqueda por cliente/cedula/IMEI/factura/radicado y la lista de
 * las que estan en tramite, de la mas vieja a la mas nueva: la que lleva mas
 * dias es la que hay que mover primero.
 */
export function WarrantiesClient() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const me = useCurrentUser();

  const parsedStatus = warrantyListFilterSchema.safeParse(searchParams.get('estado') ?? 'open');
  const status: WarrantyListFilter = parsedStatus.success ? parsedStatus.data : 'open';
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const openId = searchParams.get('g');
  const [creating, setCreating] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      replaceUrlParams(pathname, params);
    },
    [pathname, searchParams],
  );

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['warranties', status, q, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      if (q) p.set('q', q);
      return api.get<WarrantyListResponse>(`/v1/warranties?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  // En vivo: otra persona radica, cambia un estado o sube un archivo.
  useOrdersStream(
    useCallback(
      (event) => {
        if (event?.kind !== 'warranty.changed') return;
        void qc.invalidateQueries({ queryKey: ['warranties'] });
        const wid = typeof event.warrantyId === 'string' ? event.warrantyId : null;
        if (wid) {
          void qc.invalidateQueries({ queryKey: ['warranty', wid] });
          void qc.invalidateQueries({ queryKey: ['warranty-messages', wid] });
        }
      },
      [qc],
    ),
  );

  const items = data?.items ?? [];
  const counts = data?.counts;
  const openCount = counts ? counts.received + counts.at_supplier + counts.ready : null;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-0 h-40 w-full max-w-[540px] rounded-full bg-accent/[0.07] blur-3xl"
        />
        <nav className="relative mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="font-medium">Garantías</span>
          <span aria-hidden>·</span>
          <span>
            {status === 'open'
              ? 'En trámite'
              : status === 'all'
                ? 'Todas'
                : WARRANTY_STATUS_LABEL[status as WarrantyStatus]}
          </span>
        </nav>
        <div className="relative flex flex-wrap items-center gap-3">
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">Garantías</h1>
          {openCount !== null ? (
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
              {openCount} en trámite
            </span>
          ) : null}
          <div className="ml-auto">
            <Button onClick={() => setCreating(true)}>
              <ShieldPlus className="h-4 w-4" />
              Nueva garantía
            </Button>
          </div>
        </div>
      </div>

      {/* Pulso por estado (filtra) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STAGES.map((s) => {
          const Icon = STATUS_ICON[s.status];
          const active = status === s.status;
          const v = counts ? counts[s.status] : null;
          return (
            <button
              key={s.status}
              type="button"
              onClick={() => setParams({ estado: active ? null : s.status, page: null })}
              className={cn(
                'shadow-card flex flex-col items-center gap-1.5 rounded-xl border bg-card px-3 py-3 text-center transition-all hover:-translate-y-px hover:shadow-float',
                active ? 'border-accent ring-2 ring-accent/20' : 'border-border',
              )}
            >
              <div className="flex items-center justify-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', s.tint)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {s.status === 'ready' ? 'Listas' : WARRANTY_STATUS_LABEL[s.status]}
              </div>
              {v === null ? (
                <div className="h-7 w-10 animate-pulse rounded bg-muted" />
              ) : (
                <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
                  {v}
                </div>
              )}
              <div className="text-[11.5px] text-muted-foreground">{s.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Filtros + busqueda */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setParams({ estado: f.id === 'open' ? null : f.id, page: null })}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                status === f.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SearchBox value={q} onChange={(v) => setParams({ q: v || null, page: null })} />
      </div>

      {/* Lista */}
      <div className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState searching={Boolean(q)} onCreate={() => setCreating(true)} />
        ) : (
          <>
            <div className="shadow-card hidden overflow-hidden rounded-xl border border-border bg-card md:block">
              <table className="w-full text-left">
                <thead className="border-b border-border bg-muted/30 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Radicado</th>
                    <th className="px-3 py-2.5">Cliente</th>
                    <th className="px-3 py-2.5">Equipo</th>
                    <th className="px-3 py-2.5">Motivo</th>
                    <th className="px-3 py-2.5">Tienda</th>
                    <th className="px-3 py-2.5">Estado</th>
                    <th className="px-4 py-2.5 text-right">Días</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w) => (
                    <Row
                      key={w.id}
                      w={w}
                      meId={me?.id ?? ''}
                      onOpen={() => setParams({ g: w.id })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {items.map((w) => (
                <Card key={w.id} w={w} onOpen={() => setParams({ g: w.id })} />
              ))}
            </div>
          </>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[12.5px] text-muted-foreground">
          <span className="font-mono">
            {page} / {totalPages}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setParams({ page: page - 1 > 1 ? String(page - 1) : null })}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setParams({ page: String(page + 1) })}
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {creating ? (
        <WarrantyFormDialog
          onClose={() => setCreating(false)}
          onSaved={(detail) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['warranties'] });
            void qc.invalidateQueries({ queryKey: ['warranty-suggestions'] });
            setParams({ g: detail.id });
          }}
        />
      ) : null}
      {openId ? <WarrantyDrawer id={openId} onClose={() => setParams({ g: null })} /> : null}
    </div>
  );
}

function Row({ w, meId, onOpen }: { w: WarrantySummary; meId: string; onOpen: () => void }) {
  return (
    <tr
      onClick={onOpen}
      className="group cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-accent/[0.04]"
    >
      <td className="px-4 py-3 align-top">
        <span className="font-mono text-[12px] font-semibold text-accent-ink">
          {radicado(w.number)}
        </span>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDay(w.receivedAt, false)}</p>
      </td>
      <td className="max-w-[200px] px-3 py-3 align-top">
        <p className="truncate text-[13px] font-medium">{titleCaseName(w.customerName)}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{w.customerDocument}</p>
      </td>
      <td className="max-w-[220px] px-3 py-3 align-top">
        <p className="truncate text-[13px]">
          {w.brand} {w.model}
        </p>
        <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
          {w.serial}
          {w.fileCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 font-sans"
              title={`${w.fileCount} archivos`}
            >
              <Paperclip className="h-3 w-3" />
              {w.fileCount}
            </span>
          ) : null}
        </p>
      </td>
      <td className="max-w-[260px] px-3 py-3 align-top">
        <p className="line-clamp-2 text-[12.5px] text-foreground/85">{w.reason}</p>
      </td>
      <td className="px-3 py-3 align-top text-[12.5px] text-muted-foreground">
        {titleCaseName(w.store)}
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex items-center gap-2">
          {w.assigneeId && w.assigneeName ? (
            <ClaimChip userId={w.assigneeId} name={w.assigneeName} mine={w.assigneeId === meId} />
          ) : null}
          <WarrantyStatusBadge status={w.status} resolution={w.resolution} />
        </div>
        {w.status === 'at_supplier' && w.supplier ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{w.supplier}</p>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right align-top">
        <AgeChip receivedAt={w.receivedAt} closedAt={w.closedAt} closed={w.status === 'closed'} />
      </td>
    </tr>
  );
}

function Card({ w, onOpen }: { w: WarrantySummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="shadow-card w-full rounded-xl border border-border bg-card p-3.5 text-left transition active:scale-[0.99]"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-accent-ink">
          {radicado(w.number)}
        </span>
        <WarrantyStatusBadge status={w.status} resolution={w.resolution} />
        <span className="ml-auto">
          <AgeChip receivedAt={w.receivedAt} closedAt={w.closedAt} closed={w.status === 'closed'} />
        </span>
      </div>
      <p className="mt-2 truncate text-[14px] font-medium">{titleCaseName(w.customerName)}</p>
      <p className="truncate text-[12.5px] text-muted-foreground">
        {w.brand} {w.model} · <span className="font-mono">{w.serial}</span>
      </p>
      <p className="mt-1.5 line-clamp-2 text-[12.5px] text-foreground/80">{w.reason}</p>
    </button>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Si la URL cambia por fuera (atras/adelante), el campo la sigue.
  useEffect(() => setText(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v.trim()), 300);
        }}
        placeholder="Cliente, cédula, IMEI, factura o radicado…"
        className="h-9 flex-1 bg-transparent text-sm outline-none"
      />
      {text ? (
        <button
          type="button"
          onClick={() => {
            setText('');
            onChange('');
          }}
          aria-label="Limpiar búsqueda"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ searching, onCreate }: { searching: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <ShieldPlus className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[14px] font-medium">
          {searching ? 'Ninguna garantía coincide' : 'No hay garantías aquí'}
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {searching
            ? 'Prueba con otra cédula, IMEI o número de radicado.'
            : 'Cuando un cliente traiga un equipo, radícalo aquí.'}
        </p>
      </div>
      {!searching ? (
        <Button variant="outline" onClick={onCreate}>
          <ShieldPlus className="h-4 w-4" />
          Nueva garantía
        </Button>
      ) : null}
    </div>
  );
}
