import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { canSeeAudit } from '@/lib/rbac';
import { getSessionUser } from '@/lib/server-api';

import { RegistrosClient } from './registros-client';

export const metadata: Metadata = { title: 'Registros' };

export default async function RegistrosPage() {
  // Esconder el enlace no basta: la bitacora es del propietario y nadie mas
  // debe llegar escribiendo /registros (el API igual responde 403).
  const me = await getSessionUser();
  if (!canSeeAudit(me?.role)) redirect('/dashboard');
  return <RegistrosClient />;
}
