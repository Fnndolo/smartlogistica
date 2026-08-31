import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SkydropxPackagePreset } from '@smartlogistica/shared';

import { isAdmin } from '@/lib/rbac';
import { getSessionUser, serverFetch } from '@/lib/server-api';

import { BackToSettings } from '../back-to-settings';
import { SkydropxPackagesCard } from '../skydropx-packages-card';

export const metadata: Metadata = { title: 'Paquetes Skydropx' };

/**
 * Catalogo de PAQUETES DE SKYDROPX, en su propia pagina (aparte del de
 * Coordinadora: "Coordinadora lo suyo, Skydropx lo suyo").
 */
export default async function PaquetesSkydropxPage() {
  const me = await getSessionUser();
  if (!isAdmin(me?.role)) redirect('/settings');
  // null = la lectura fallo: la tarjeta BLOQUEA el guardado, porque el PUT es
  // de reemplazo total y guardar a ciegas borraria el catalogo real.
  const presets = await serverFetch<SkydropxPackagePreset[]>('/v1/skydropx/package-presets');

  return (
    <div>
      <BackToSettings />
      <SkydropxPackagesCard initial={presets} standalone />
    </div>
  );
}
