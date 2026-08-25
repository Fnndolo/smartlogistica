import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { canManageConnections } from '@/lib/rbac';
import { getSessionUser } from '@/lib/server-api';

import { VtexConnectWizard } from './vtex-connect-wizard';

export const metadata: Metadata = { title: 'Conectar VTEX' };

export default async function VtexConnectPage() {
  // Conectar un marketplace es configuracion: solo administradores.
  const me = await getSessionUser();
  if (me && !canManageConnections(me.role)) redirect('/settings');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/connections"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a conexiones
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Conectar VTEX / Addi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Genera unas credenciales de API en VTEX y conectalas en menos de un minuto.
        </p>
      </div>

      <VtexConnectWizard />
    </div>
  );
}
