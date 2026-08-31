import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { PackagePreset } from '@smartlogistica/shared';

import { isAdmin } from '@/lib/rbac';
import { getSessionUser, serverFetch } from '@/lib/server-api';

import { BackToSettings } from '../back-to-settings';
import { PackagePresetsCard } from '../package-presets-card';

export const metadata: Metadata = { title: 'Paquetes de guía' };

/**
 * Catalogo de PAQUETES DE GUIA (Coordinadora), en su propia pagina: en Ajustes
 * era una tarjeta apretada con la lista dentro. Aqui el catalogo tiene sitio
 * para crecer y Ajustes queda como indice.
 */
export default async function PaquetesGuiaPage() {
  // Esconder el enlace no basta: sin esto se llega escribiendo la URL.
  const me = await getSessionUser();
  if (!isAdmin(me?.role)) redirect('/settings');
  const presets = (await serverFetch<PackagePreset[]>('/v1/warehouses/package-presets')) ?? [];

  return (
    <div>
      <BackToSettings />
      {/* La cabecera y el boton primario viven DENTRO de la tarjeta: agregar
          abre un formulario en linea, que es estado de cliente. */}
      <PackagePresetsCard initial={presets} standalone />
    </div>
  );
}
