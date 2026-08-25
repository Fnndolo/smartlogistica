import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { MemberSummary } from '@smartlogistica/shared';

import { canManageMembers } from '@/lib/rbac';
import { getSessionUser, serverFetchResult } from '@/lib/server-api';

import { TeamList } from './team-list';

export const metadata: Metadata = { title: 'Equipo' };

/** `undefined` = no se pudo preguntar (lo resuelve el cliente); nunca una lista vacia inventada. */
async function initialMembers(): Promise<MemberSummary[] | undefined> {
  const res = await serverFetchResult<MemberSummary[]>('/v1/members');
  return res.ok ? res.data : undefined;
}

export default async function TeamPage() {
  // Esconder el enlace no basta: sin esto un GESTOR llegaba al roster
  // completo escribiendo /settings/team en la barra de direcciones.
  const me = await getSessionUser();
  if (!canManageMembers(me?.role)) redirect('/settings');
  const members = await initialMembers();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quien tiene acceso a este workspace y que sedes ve cada quien.
        </p>
      </header>

      <TeamList initial={members} />
    </div>
  );
}
