import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { AiConnectionSummary, VtexConnectionSummary } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { serverFetchResult } from '@/lib/server-api';

import { AiConnectionCard } from './ai-connection-card';
import { ConnectionsList } from './connections-list';

export const metadata: Metadata = { title: 'Conexiones' };

/**
 * Datos iniciales para pintar de una. Si el API no responde devolvemos
 * `undefined` — NO una lista vacia ni null: eso significaria "no hay
 * conexiones" y seria mentira. Con undefined, el componente cliente lo
 * resuelve con reintentos y, si de verdad falla, muestra el error.
 */
async function initialConnections(): Promise<VtexConnectionSummary[] | undefined> {
  const res = await serverFetchResult<VtexConnectionSummary[]>('/v1/connections');
  return res.ok ? res.data : undefined;
}

async function initialAiConnection(): Promise<AiConnectionSummary | null | undefined> {
  const res = await serverFetchResult<AiConnectionSummary | null>('/v1/connections/ai');
  return res.ok ? res.data : undefined;
}

export default async function ConnectionsPage() {
  const [connections, aiConnection] = await Promise.all([initialConnections(), initialAiConnection()]);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conexiones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecta cada marketplace una vez. Los pedidos llegan automaticamente.
          </p>
        </div>
        <Button asChild>
          <Link href="/connections/vtex/new">
            <Plus className="h-4 w-4" />
            Conectar VTEX
          </Link>
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Marketplaces
        </h2>
        <ConnectionsList initial={connections} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Servicios
        </h2>
        <AiConnectionCard initial={aiConnection} />
      </section>
    </div>
  );
}
