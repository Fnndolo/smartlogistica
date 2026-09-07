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
  // A la vez, igual que el catalogo hermano: el API valida la sesion en cada
  // lectura, asi que adelantar la peticion no expone nada.
  // null = la lectura fallo: la tarjeta BLOQUEA el guardado, porque el PUT es
  // de reemplazo total y guardar a ciegas borraria el catalogo real.
  const [me, presets] = await Promise.all([
    getSessionUser(),
    serverFetch<SkydropxPackagePreset[]>('/v1/skydropx/package-presets'),
  ]);
  if (!isAdmin(me?.role)) redirect('/settings');

  return (
    <div>
      <BackToSettings />
      <SkydropxPackagesCard initial={presets} standalone />
    </div>
  );
}
