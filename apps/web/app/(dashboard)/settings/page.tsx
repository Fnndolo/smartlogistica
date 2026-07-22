import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, Link2, Mail, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { serverFetchResult } from '@/lib/server-api';

import { ChangePasswordCard } from './change-password-card';
import { ConfirmationLogCard } from './confirmation-log-card';

export const metadata: Metadata = { title: 'Ajustes' };

interface Me {
  id: string;
  email: string;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: string | null;
}

export default async function SettingsPage() {
  const res = await serverFetchResult<Me>('/v1/auth/me');
  const me = res.ok ? res.data : null;
  const isOwner = me?.role === 'OWNER';

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
                  <Badge variant={isOwner ? 'success' : 'outline'}>
                    {isOwner ? 'Propietario' : 'Operador'}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isOwner
                  ? 'Ves y gestionas todo: sedes, conexiones, equipo y facturacion.'
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

        <SettingsLink
          href="/settings/team"
          icon={<Users className="h-4 w-4" />}
          title="Equipo"
          description="Agrega personas y decide que sedes ve cada quien."
        />
        <SettingsLink
          href="/connections"
          icon={<Link2 className="h-4 w-4" />}
          title="Conexiones"
          description="VTEX/Addi e inteligencia artificial. Alegra, Coordinadora y el certificado se configuran dentro de cada sede."
        />
      </section>

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
