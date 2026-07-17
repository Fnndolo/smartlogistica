import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ArrowRight, Link2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Resumen',
};

const SESSION_COOKIE_NAME = 'smartlog_session';

interface StatsResponse {
  readyForHandling: number;
  handling: number;
  connections: number;
}

async function fetchStats(): Promise<StatsResponse> {
  const fallback: StatsResponse = { readyForHandling: 0, handling: 0, connections: 0 };
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  if (!session) return fallback;
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}/v1/orders/stats`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
      cache: 'no-store',
    });
    if (!res.ok) return fallback;
    return (await res.json()) as StatsResponse;
  } catch {
    return fallback;
  }
}

export default async function DashboardHomePage() {
  const stats = await fetchStats();
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
        <p className="text-sm text-muted-foreground">
          {stats.connections === 0
            ? 'Conecta tu primer marketplace para empezar a recibir pedidos.'
            : `${stats.connections} marketplace${stats.connections === 1 ? '' : 's'} conectado${stats.connections === 1 ? '' : 's'} · sincronizando pedidos en tiempo real`}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Listo para preparar" value={String(stats.readyForHandling)} hint="ready-for-handling" />
        <KpiCard label="Preparando" value={String(stats.handling)} hint="handling" />
        <KpiCard label="Conexiones" value={String(stats.connections)} hint="VTEX, Shopify, ML" />
      </div>

      <section className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Link2 className="h-5 w-5 text-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold">Aun no tienes marketplaces conectados</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecta VTEX/Addi en menos de un minuto y empieza a centralizar todos tus pedidos.
        </p>
        <Link
          href="/connections/vtex/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Conectar VTEX
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
