import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, Link2, Mail, Users } from 'lucide-react';
import type { PackagePreset, Platform, SessionUser, VtexFees } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { canManageConnections, canManageMembers, canSeeAllWarehouses, isAdmin, ROLE_LABEL } from '@/lib/rbac';
import { serverFetch, serverFetchResult } from '@/lib/server-api';

import { ChangePasswordCard } from './change-password-card';
import { ConfirmationLogCard } from './confirmation-log-card';
import { PackagePresetsCard } from './package-presets-card';
import { PlatformsCard } from './platforms-card';
import { SkydropxPackagesCard } from './skydropx-packages-card';
import { VtexFeesCard } from './vtex-fees-card';

export const metadata: Metadata = { title: 'Ajustes' };

export default async function SettingsPage() {
  const res = await serverFetchResult<SessionUser>('/v1/auth/me');
  const me = res.ok ? res.data : null;
  // TODA la configuracion del workspace es de administradores: el gestor entra
  // a Ajustes solo por "Tu cuenta" (cambiar su clave).
  const isOwner = isAdmin(me?.role);
  const packagePresets = isOwner
    ? ((await serverFetch<PackagePreset[]>('/v1/warehouses/package-presets')) ?? [])
    : [];
  // null = lectura fallida: la card bloquea el guardado (PUT de reemplazo total).
  const skydropxPackages = isOwner
    ? await serverFetch<PackagePreset[]>('/v1/skydropx/package-presets')
    : null;
  // null = la lectura fallo (API caida/reiniciando). NUNCA se cae a defaults:
  // las cards guardan con PUT de reemplazo total y unos defaults sembrados a
  // ciegas pisarian la configuracion personalizada al primer "Guardar".
  const platforms = isOwner ? await serverFetch<Platform[]>('/v1/platforms') : null;
  const vtexFees = isOwner ? await serverFetch<VtexFees>('/v1/vtex-fees') : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tu cuenta y la configuracion general del workspace.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tu cuenta</h2>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{me?.email ?? 'No disponible'}</h3>
                {me?.role ? (
                  <Badge
                    variant={isOwner ? 'success' : me.role === 'GESTOR' ? 'info' : 'outline'}
                  >
                    {ROLE_LABEL[me.role]}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isOwner
                  ? 'Ves y gestionas todo: sedes, conexiones, equipo y facturacion.'
                  : canSeeAllWarehouses(me?.role)
                    ? 'Trabajas los pedidos de todas las sedes: facturas y generas guías.'
                    : 'Ves unicamente las sedes que te asignaron.'}
              </p>
            </div>
          </div>
        </div>

        <ChangePasswordCard />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace</h2>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{me?.activeTenantSlug ?? 'Sin workspace activo'}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cada workspace tiene su propia base de datos aislada. Los datos sensibles (claves de
                Alegra, VTEX y Coordinadora) se guardan cifrados.
              </p>
            </div>
          </div>
        </div>

        {canManageMembers(me?.role) ? (
          <SettingsLink
            href="/settings/team"
            icon={<Users className="h-4 w-4" />}
            title="Equipo"
            description="Agrega personas y decide que sedes ve cada quien."
          />
        ) : null}
        {canManageConnections(me?.role) ? (
          <SettingsLink
            href="/connections"
            icon={<Link2 className="h-4 w-4" />}
            title="Conexiones"
            description="VTEX/Addi e inteligencia artificial. Alegra, Coordinadora y el certificado se configuran dentro de cada sede."
          />
        ) : null}
      </section>

      {isOwner ? (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pedidos
          </h2>
          <PlatformsCard initial={platforms} />
          <VtexFeesCard initial={vtexFees} />
        </section>
      ) : null}

      {isOwner ? (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Envíos
          </h2>
          <PackagePresetsCard initial={packagePresets} />
          <SkydropxPackagesCard initial={skydropxPackages} />
        </section>
      ) : null}

      {isOwner ? (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            WhatsApp
          </h2>
          <ConfirmationLogCard />
        </section>
      ) : null}
    </div>
  );
}

function SettingsLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
