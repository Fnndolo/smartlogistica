import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ChevronRight, Clock, Link2, User } from 'lucide-react';
import {
  AI_PROVIDER_LABELS,
  type AiConnectionSummary,
  type Dialog360ConnectionSummary,
  type OrdersDashboard,
  type SkydropxConnectionSummary,
  type VtexConnectionSummary,
  type WarehouseSummary,
} from '@smartlogistica/shared';

import { canManageConnections, canManageOrders } from '@/lib/rbac';
import { getSessionUser, getWarehouses, serverFetch, serverFetchResult } from '@/lib/server-api';

import { SyncButton } from '../connections/sync-button';

export const metadata: Metadata = {
  title: 'Resumen',
};

interface StatsResponse {
  readyForHandling: number;
  handling: number;
  connections: number;
}

/**
 * `undefined` = no se pudo preguntar (API caido o 403). NO es lo mismo que
 * "no hay conexion configurada" (null): una cosa se muestra como "Sin datos"
 * y la otra como "Sin conectar".
 */
type Maybe<T> = T | undefined;

async function fetchStats(): Promise<StatsResponse> {
  return (
    (await serverFetch<StatsResponse>('/v1/orders/stats')) ?? {
      readyForHandling: 0,
      handling: 0,
      connections: 0,
    }
  );
}

/** Lee un dato opcional: `undefined` si el API no respondio (o no dio permiso). */
async function fetchOptional<T>(path: string): Promise<Maybe<T>> {
  const res = await serverFetchResult<T>(path);
  return res.ok ? res.data : undefined;
}

/** "Lunes 26 de agosto" en hora de Colombia (el dia operativo del negocio). */
function todayLabel(): string {
  const raw = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  }).format(new Date());
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default async function DashboardHomePage() {
  // El rol decide QUE se pide: el resumen de pedidos es de OWNER/ADMIN/GESTOR y
  // las conexiones solo de administradores. Si el rol no se pudo leer (API
  // caido) se intenta igual — quien bloquea de verdad es el API.
  const me = await getSessionUser();
  const canOrders = !me || canManageOrders(me.role);
  const canConnect = !me || canManageConnections(me.role);

  const [stats, dashboard, vtex, ai, whatsapp, skydropx, ownWarehouses] = await Promise.all([
    fetchStats(),
    canOrders ? serverFetch<OrdersDashboard>('/v1/orders/dashboard') : Promise.resolve(null),
    canConnect ? fetchOptional<VtexConnectionSummary[]>('/v1/connections') : undefined,
    canConnect ? fetchOptional<AiConnectionSummary | null>('/v1/connections/ai') : undefined,
    canConnect ? fetchOptional<Dialog360ConnectionSummary | null>('/v1/connections/dialog360') : undefined,
    canConnect ? fetchOptional<SkydropxConnectionSummary | null>('/v1/skydropx/connection') : undefined,
    // Un operador no pasa el gate del resumen: su carga por sede sale de sus
    // propias sedes (mismo conteo que el badge del sidebar).
    canOrders ? Promise.resolve<WarehouseSummary[]>([]) : getWarehouses(),
  ]);

  // Carga por sede: del resumen si lo hay; si no, las sedes del operador.
  const sedes: { id: string; name: string; pending: number }[] = dashboard
    ? dashboard.perWarehouse.map((w) => ({ id: w.id, name: w.name, pending: w.pending }))
    : ownWarehouses
        .filter((w) => !w.archived)
        .map((w) => ({ id: w.id, name: w.name, pending: w.orderCount }));

  // La barra de cada sede se mide contra la sede mas cargada (no contra el
  // total): asi se lee de un vistazo quien va mas apretado.
  const maxPending = sedes.reduce((m, s) => Math.max(m, s.pending), 0);

  // El CTA solo aparece cuando de verdad no hay ningun marketplace. `stats`
  // cuenta los CONECTADOS: si hay uno en error, la lista lo delata y no se
  // muestra el "aun no tienes marketplaces".
  const noMarketplaces = stats.connections === 0 && (vtex?.length ?? 0) === 0;

  // Unica accion de la portada: la MISMA sincronizacion de VTEX de Conexiones
  // (mismo POST, mismos toasts, mismo boton). Se apunta a la conexion activa —
  // y si ninguna lo esta, a la primera — porque el boton dispara UNA conexion.
  // El titulo dice cual, para que no sea ambiguo con varias cuentas.
  const syncTarget = vtex?.find((c) => c.status === 'connected') ?? vtex?.[0];

  return (
    <div>
      {/* ===== Encabezado de pagina ===== */}
      <header className="mb-[18px] flex flex-wrap items-start gap-3.5 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">Resumen</h1>
          <p className="mt-0.5 max-w-[62ch] text-[13px] text-muted-foreground">
            {todayLabel()} ·{' '}
            {stats.connections === 0
              ? 'Conecta tu primer marketplace para empezar a recibir pedidos.'
              : `${stats.connections} marketplace${stats.connections === 1 ? '' : 's'} conectado${stats.connections === 1 ? '' : 's'} · sincronizando pedidos en tiempo real`}
          </p>
        </div>
        {canConnect && syncTarget ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Con VARIAS cuentas hay que decir cual se sincroniza: el tooltip
                no existe en tactil, asi que va como texto visible. */}
            {(vtex?.length ?? 0) > 1 ? (
              <span className="text-[11.5px] text-hint">{syncTarget.accountName}</span>
            ) : null}
            <SyncButton connectionId={syncTarget.id} />
          </div>
        ) : null}
      </header>

      {canOrders && dashboard ? (
        <>
          {/* ===== 3 metricas ===== */}
          {/* 820px, no sm: con tres columnas antes de eso el numero de 34px y su
              pista quedan apretados (el mockup rompe la rejilla en 820). */}
          <div className="grid gap-3 min-[820px]:grid-cols-3">
            <Kpi
              bar="cobalt"
              label="Sin asignar"
              value={dashboard.unassigned}
              hint={
                <>
                  Esperando sede · <b className="font-bold text-foreground">{dashboard.unassignedOver24h}</b> hace
                  más de 24 h
                </>
              }
            />
            <Kpi
              bar="amber"
              label="Por preparar"
              value={dashboard.pending}
              hint={
                <>
                  {sedes.length > 0 ? <>{sedeScopeLabel(sedes.length)} · </> : null}
                  <b className="font-bold text-foreground">{dashboard.pendingInvoiced}</b> ya facturados
                </>
              }
            />
            <Kpi
              bar="emerald"
              label="Despachados hoy"
              value={dashboard.dispatchedToday}
              hint="Guía generada y en camino"
            />
          </div>

          {/* ===== Necesitan atencion ===== */}
          <SectionHeading>Necesitan atención</SectionHeading>
          <div className="divide-y divide-dashed divide-input rounded-[14px] border border-border bg-card px-4 py-[15px]">
            <Attention
              tone="red"
              icon={<AlertTriangle className="h-[15px] w-[15px]" />}
              title="Novedad en el envío"
              detail="La transportadora reportó un problema de entrega"
              count={dashboard.shippingIssues}
            />
            <Attention
              tone="amber"
              icon={<Clock className="h-[15px] w-[15px]" />}
              title="Sin confirmar dirección"
              detail="El cliente no ha respondido por WhatsApp"
              count={dashboard.addressPending}
              // SIN enlace a proposito: el conteo cubre generales Y sedes, pero
              // /orders?address=pending solo lista generales — el numero no
              // cuadraria con la tabla. Mejor un dato cierto sin enlace que un
              // enlace que muestre menos de lo que dice la tarjeta.
            />
            <Attention
              tone="cobalt"
              icon={<User className="h-[15px] w-[15px]" />}
              title="Sin tomar"
              detail="Nadie del equipo los ha reclamado"
              count={dashboard.unclaimed}
            />
          </div>
        </>
      ) : null}

      {canOrders && !dashboard ? (
        <div className="rounded-[14px] border border-border bg-card px-4 py-[15px] text-[12.5px] text-muted-foreground">
          No pudimos cargar las métricas del resumen. Vuelve a intentarlo en unos segundos.
        </div>
      ) : null}

      {/* ===== Carga por sede + estado de las conexiones ===== */}
      <div className={`mt-3 grid gap-3 ${canConnect ? 'lg:grid-cols-2' : ''}`}>
        <section className="min-w-0">
          <SectionHeading>Carga por sede</SectionHeading>
          <div className="rounded-[14px] border border-border bg-card px-4 py-[15px]">
            {sedes.length === 0 ? (
              <p className="py-[9px] text-[12.5px] text-muted-foreground">
                {canOrders && !dashboard
                  ? 'No pudimos cargar la carga por sede.'
                  : 'Todavía no hay sedes que mostrar.'}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {sedes.map((s) => (
                  <SedeRow key={s.id} sede={s} max={maxPending} />
                ))}
              </div>
            )}
          </div>
        </section>

        {canConnect ? (
          <section className="min-w-0">
            <SectionHeading>Estado de las conexiones</SectionHeading>
            <div className="rounded-[14px] border border-border bg-card px-4 py-[15px]">
              <div className="divide-y divide-border">
                {vtex === undefined ? (
                  <ConnRow name="VTEX" pill={<Pill tone="muted">Sin datos</Pill>} />
                ) : vtex.length === 0 ? (
                  <ConnRow name="VTEX" pill={<Pill tone="muted">Sin conectar</Pill>} />
                ) : (
                  vtex.map((c) => (
                    <ConnRow
                      key={c.id}
                      name={`VTEX · ${c.accountName}`}
                      pill={
                        c.status === 'connected' ? (
                          <Pill tone="ok">Activa</Pill>
                        ) : c.status === 'disabled' ? (
                          <Pill tone="muted">Desactivada</Pill>
                        ) : (
                          <Pill tone="bad">Con error</Pill>
                        )
                      }
                    />
                  ))
                )}
                <ConnRow
                  name={`WhatsApp · 360dialog${whatsapp ? ` · ${MODE_LABEL[whatsapp.mode]}` : ''}`}
                  pill={<StatusPill connection={whatsapp} />}
                />
                <ConnRow
                  name={`Skydropx${skydropx ? ` · ${MODE_LABEL[skydropx.mode]}` : ''}`}
                  pill={<StatusPill connection={skydropx} />}
                />
                <ConnRow
                  name={`Inteligencia Artificial${ai ? ` · ${AI_PROVIDER_LABELS[ai.provider]}` : ''}`}
                  pill={<StatusPill connection={ai} />}
                />
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {/* ===== CTA: solo cuando NO hay ningun marketplace ===== */}
      {canConnect && noMarketplaces ? (
        <section className="mt-3 rounded-[14px] border border-dashed border-input bg-card p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-[12px] bg-wash text-accent">
            <Link2 className="h-[18px] w-[18px]" />
          </div>
          <h2 className="mt-3.5 text-[15px] font-extrabold tracking-[-0.015em]">
            Aún no tienes marketplaces conectados
          </h2>
          <p className="mx-auto mt-1 max-w-[52ch] text-[12.5px] text-muted-foreground">
            Conecta VTEX/Addi en menos de un minuto y empieza a centralizar todos tus pedidos.
          </p>
          <Link
            href="/connections/vtex/new"
            className="mt-4 inline-flex items-center justify-center gap-[7px] rounded-[10px] bg-gradient-to-b from-accent to-accent-deep px-[15px] py-2 text-[13px] font-bold text-accent-foreground shadow-[0_6px_18px_-6px_hsl(var(--ring))] transition-transform [transition-duration:130ms] hover:-translate-y-px"
          >
            Conectar VTEX
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}
    </div>
  );
}

/** "En 1 sede" / "En las 3 sedes" — el alcance real de "por preparar". */
function sedeScopeLabel(count: number): string {
  return count === 1 ? 'En 1 sede' : `En las ${count} sedes`;
}

const MODE_LABEL: Record<'sandbox' | 'production', string> = {
  sandbox: 'Pruebas',
  production: 'Producción',
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-[22px] flex items-center gap-2.5">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint">{children}</h2>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const KPI_BAR: Record<'cobalt' | 'amber' | 'emerald', string> = {
  cobalt: 'bg-accent',
  amber: 'bg-amber-600 dark:bg-amber-400',
  emerald: 'bg-emerald-600 dark:bg-emerald-400',
};

function Kpi({
  bar,
  label,
  value,
  hint,
}: {
  bar: keyof typeof KPI_BAR;
  label: string;
  value: number;
  hint: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-[15px]">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-hint">{label}</p>
      <p className="mt-1.5 text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>
      <span className={`absolute inset-x-0 bottom-0 h-[3px] opacity-[0.85] ${KPI_BAR[bar]}`} />
    </div>
  );
}

const ATT_TONE: Record<'red' | 'amber' | 'cobalt', string> = {
  red: 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
  cobalt: 'bg-wash text-accent',
};

/**
 * Fila de "Necesitan atencion". Solo es enlace cuando la tabla de pedidos tiene
 * de verdad ese filtro: no se inventan rutas para que aparezca el chevron. Pero
 * el HUECO del chevron se reserva siempre (las filas sin enlace ponen un
 * espaciador del mismo tamaño), para que los tres numeros formen columna en vez
 * de que el de la fila enlazada se corra 27px a la izquierda.
 */
function Attention({
  tone,
  icon,
  title,
  detail,
  count,
  href,
}: {
  tone: keyof typeof ATT_TONE;
  icon: React.ReactNode;
  title: string;
  detail: string;
  count: number;
  href?: string;
}) {
  const body = (
    <>
      <span className={`grid h-8 w-8 flex-none place-items-center rounded-[9px] ${ATT_TONE[tone]}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold">{title}</span>
        <span className="block text-[11.5px] text-hint">{detail}</span>
      </span>
      <span
        className={`text-[19px] font-extrabold tracking-[-0.02em] tabular-nums ${count === 0 ? 'text-hint' : ''}`}
      >
        {count}
      </span>
      {href ? (
        <ChevronRight className="h-[15px] w-[15px] flex-none text-hint transition-colors [transition-duration:130ms] group-hover:text-accent" />
      ) : (
        <span aria-hidden className="h-[15px] w-[15px] flex-none" />
      )}
    </>
  );

  if (!href) {
    return <div className="flex items-center gap-3 py-[11px]">{body}</div>;
  }
  return (
    <Link href={href} className="group flex items-center gap-3 py-[11px] text-left">
      {body}
    </Link>
  );
}

function SedeRow({ sede, max }: { sede: { id: string; name: string; pending: number }; max: number }) {
  const pct = max > 0 ? Math.round((sede.pending / max) * 100) : 0;
  return (
    <Link href={`/warehouses/${sede.id}`} className="group flex items-center gap-[11px] py-[9px]">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold transition-colors [transition-duration:130ms] group-hover:text-accent-ink">
        {sede.name}
      </span>
      <span className="h-1.5 w-20 flex-none overflow-hidden rounded-[3px] bg-wash sm:w-[120px]">
        <span
          className="block h-full rounded-[3px] bg-gradient-to-r from-accent to-accent-deep"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`w-6 flex-none text-right text-[13px] font-extrabold tabular-nums ${sede.pending === 0 ? 'text-hint' : ''}`}
      >
        {sede.pending}
      </span>
    </Link>
  );
}

function ConnRow({ name, pill }: { name: string; pill: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[11px] py-[9px]">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
      {pill}
    </div>
  );
}

const PILL_TONE: Record<'ok' | 'warn' | 'bad' | 'muted', string> = {
  // MISMA receta que settings-ui.tsx / connection-ui.tsx: la pastilla de un
  // mismo estado tiene que verse igual en los tres modulos.
  ok: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-400',
  muted: 'border border-border bg-surface text-hint',
};

function Pill({ tone, children }: { tone: keyof typeof PILL_TONE; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-[5px] rounded-full px-[9px] py-0.5 text-[11px] font-bold ${PILL_TONE[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Pastilla de un servicio: sin datos / sin conectar / conectado / con error. */
function StatusPill({ connection }: { connection: Maybe<{ status: 'connected' | 'error' } | null> }) {
  if (connection === undefined) return <Pill tone="muted">Sin datos</Pill>;
  if (connection === null) return <Pill tone="muted">Sin conectar</Pill>;
  return connection.status === 'connected' ? (
    <Pill tone="ok">Conectado</Pill>
  ) : (
    <Pill tone="bad">Con error</Pill>
  );
}
