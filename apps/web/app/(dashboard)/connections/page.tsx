import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, MessageCircle, Plus } from 'lucide-react';
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
import { BTN_PRIMARY, BTN_SM, CONN_CARD, SectionHeading, Tile } from './connection-ui';
import { ConnectionsList } from './connections-list';
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
  const res = await serverFetchResult<Dialog360ConnectionSummary | null>(
    '/v1/connections/dialog360',
  );
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
        <SkydropxConnectionCard initial={skydropx} />
      </section>

      <section className="mt-[22px] space-y-[10px]">
        <SectionHeading>WhatsApp</SectionHeading>
        {/* Ya no hay una tarjeta de conectar/desconectar: con varios numeros no
            representaria nada. Los numeros se gestionan en su propia pantalla. */}
        <Link
          href="/whatsapp/ajustes"
          prefetch
          className={`${CONN_CARD} flex flex-wrap items-center gap-[13px] transition-colors hover:border-accent`}
        >
          <Tile tone="cobalt">
            <MessageCircle className="h-[18px] w-[18px]" />
          </Tile>
          <div className="min-w-0 flex-1">
            <b className="text-[13.5px] font-extrabold">Números de WhatsApp</b>
            <p className="mt-[3px] max-w-[64ch] text-[12px] text-muted-foreground">
              {dialog360
                ? 'Conectado. Aquí se agregan más números y se decide qué mensajes salen solos.'
                : 'Sin conectar. Conecta el primer número y configura los mensajes automáticos.'}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-hint" aria-hidden />
        </Link>
      </section>

      <p className="mt-3.5 text-[12px] text-hint">
        Alegra, Coordinadora y el Certificado de Garantía se configuran{' '}
        <b className="font-bold text-muted-foreground">dentro de cada sede</b>, porque cada una
        tiene sus propias credenciales.
      </p>
    </div>
  );
}
