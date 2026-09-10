'use client';

import { format } from 'date-fns/format';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { isToday } from 'date-fns/isToday';
import { isYesterday } from 'date-fns/isYesterday';
import { es } from 'date-fns/locale/es';

import { cn } from '@/lib/utils';

/**
 * Piezas compartidas por las dos pestañas de Chats (la bandeja y las
 * menciones). Viven aparte para que las dos listas se vean IGUAL: son la misma
 * pantalla, y si cada una tuviera su propio separador de dia o su propia
 * marca de tiempo se notaria al cambiar de pestaña.
 */

/** Separador de dia: "Hoy" / "Ayer" / la fecha en español. */
export function dayLabel(date: Date): string {
  if (isToday(date)) return 'Hoy';
  if (isYesterday(date)) return 'Ayer';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "EEEE d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: es });
}

/**
 * Marca de tiempo de la fila. Lo de HOY se lee mejor en relativo ("hace 5
 * minutos"); de "Ayer" hacia atras el relativo pierde precision y se cambia por
 * la hora de reloj — que es lo que le da sentido al separador de dia.
 */
export function whenLabel(date: Date): string {
  if (isToday(date)) return formatDistanceToNow(date, { locale: es, addSuffix: true });
  if (isYesterday(date)) return format(date, "'ayer a las' h:mm aaaa", { locale: es });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "d MMM 'a las' h:mm aaaa" : "d MMM yyyy 'a las' h:mm aaaa", {
    locale: es,
  });
}

/**
 * Corta una lista YA ordenada (mas nueva primero) en grupos por dia. No
 * reordena nada: solo abre un grupo cada vez que cambia la fecha, asi que el
 * orden que decide el servidor se respeta tal cual.
 */
export function groupByDay<T>(rows: T[], dateOf: (row: T) => string): Array<{
  key: string;
  label: string;
  rows: T[];
}> {
  const out: Array<{ key: string; label: string; rows: T[] }> = [];
  for (const it of rows) {
    const date = new Date(dateOf(it));
    const key = date.toDateString();
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(it);
    else out.push({ key, label: dayLabel(date), rows: [it] });
  }
  return out;
}

export function FilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-[13px] py-[5px] text-[12.5px] font-bold transition-colors [transition-duration:130ms]',
        selected
          ? 'border-accent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--ring))]'
          : 'border-input bg-card text-muted-foreground hover:border-accent hover:text-accent-ink',
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

/** El marco de la lista: las dos pestañas comparten tarjeta y respiracion. */
export function ListCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[14px] border border-border bg-card p-[6px_8px]">{children}</div>;
}

export function DayHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 pb-[7px] pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-hint">
      {children}
    </p>
  );
}

/** Mientras carga: la MISMA forma de la lista, para que nada salte al llegar. */
export function ListSkeleton() {
  return (
    <ListCard>
      <div className="my-3.5 h-3 w-16 animate-pulse rounded bg-muted/60 px-0.5" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3 p-[12px_14px]">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted/70" />
            <div className="h-3 w-80 max-w-full animate-pulse rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </ListCard>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-input bg-card py-16 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-wash text-accent">
        {icon}
      </span>
      <p className="text-[13.5px] font-bold">{title}</p>
      <p className="max-w-[52ch] px-6 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}
