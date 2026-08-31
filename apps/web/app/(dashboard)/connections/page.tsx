import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import type {
  AiConnectionSummary,
  Dialog360ConnectionSummary,
  SkydropxConnectionSummary,
  VtexConnectionSummary,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { canManageConnections } from '@/lib/rbac';
import { getSessionUser, serverFetchResult } from '@/lib/server-api';
import { cn } from '@/lib/utils';

import { AiConnectionCard } from './ai-connection-card';
import { BTN_PRIMARY, BTN_SM, SectionHeading } from './connection-ui';
import { ConnectionsList } from './connections-list';
import { Dialog360ConnectionCard } from './dialog360-connection-card';
import { SkydropxConnectionCard } from './skydropx-connection-card';

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

async function initialDialog360(): Promise<Dialog360ConnectionSummary | null | undefined> {
  const res = await serverFetchResult<Dialog360ConnectionSummary | null>('/v1/connections/dialog360');
  return res.ok ? res.data : undefined;
}

async function initialSkydropx(): Promise<SkydropxConnectionSummary | null | undefined> {
  const res = await serverFetchResult<SkydropxConnectionSummary | null>('/v1/skydropx/connection');
  return res.ok ? res.data : undefined;
}

export default async function ConnectionsPage() {
  // Conexiones es SOLO de administradores: quitarlo del menu no basta, la URL
  // sigue siendo navegable. Si el rol no se pudo leer (API caido) no se expulsa
  // a nadie: cada lectura de abajo la bloquea el API igual.
  const me = await getSessionUser();
  if (me && !canManageConnections(me.role)) redirect('/settings');

  const [connections, aiConnection, dialog360, skydropx] = await Promise.all([
    initialConnections(),
    initialAiConnection(),
    initialDialog360(),
    initialSkydropx(),
  ]);

  return (
    <div>
      <header className="mb-[18px] flex flex-wrap items-start gap-3.5 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">Conexiones</h1>
          <p className="mt-0.5 max-w-[62ch] text-[13px] text-muted-foreground">
            Conecta cada marketplace una vez. Los pedidos llegan automáticamente.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {/* Las acciones de la cabecera van en la medida compacta del mockup. */}
          <Button asChild className={cn(BTN_PRIMARY, BTN_SM)}>
            <Link href="/connections/vtex/new">
              <Plus />
              Conectar VTEX
            </Link>
          </Button>
        </div>
      </header>

      <section className="space-y-[10px]">
        <SectionHeading>Marketplaces</SectionHeading>
        <ConnectionsList initial={connections} />
      </section>

      <section className="mt-[22px] space-y-[10px]">
        <SectionHeading>Servicios</SectionHeading>
        <AiConnectionCard initial={aiConnection} />
        <Dialog360ConnectionCard initial={dialog360} />
        <SkydropxConnectionCard initial={skydropx} />
      </section>

      <p className="mt-3.5 text-[12px] text-hint">
        Alegra, Coordinadora y el Certificado de Garantía se configuran{' '}
        <b className="font-bold text-muted-foreground">dentro de cada sede</b>, porque cada una tiene
        sus propias credenciales.
      </p>
    </div>
  );
}
