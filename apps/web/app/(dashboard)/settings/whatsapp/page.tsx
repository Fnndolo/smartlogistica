import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { WaConfigOverview } from '@smartlogistica/shared';

import { isAdmin } from '@/lib/rbac';
import { getSessionUser, serverFetch } from '@/lib/server-api';

import { BackToSettings } from '../back-to-settings';
import { WhatsappConfig } from './whatsapp-config';

export const metadata: Metadata = { title: 'WhatsApp' };

/**
 * CONFIGURACION DE WHATSAPP: los numeros conectados y los mensajes que salen
 * solos. Antes esto no existia en ninguna parte: los cuatro mensajes
 * automaticos estaban cableados en codigo y no habia forma de apagar uno sin
 * desconectar WhatsApp entero.
 */
export default async function WhatsappSettingsPage() {
  // Esconder el enlace no basta: sin esto se llega escribiendo la URL.
  const me = await getSessionUser();
  if (!isAdmin(me?.role)) redirect('/settings');

  // null = el API no respondio (no es lo mismo que "no hay nada"): el cliente
  // lo resuelve con reintentos en vez de mentir con un estado vacio.
  const initial = await serverFetch<WaConfigOverview>('/v1/whatsapp/config');

  return (
    <div>
      <BackToSettings />
      <WhatsappConfig initial={initial ?? undefined} />
    </div>
  );
}
