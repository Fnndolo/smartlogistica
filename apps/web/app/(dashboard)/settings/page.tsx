import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Building2, Link2, Mail, Package, Users } from 'lucide-react';
import type { Platform, SessionUser, VtexFees } from '@smartlogistica/shared';

import {
  canManageConnections,
  canManageMembers,
  canSeeAllWarehouses,
  isAdmin,
  ROLE_LABEL,
} from '@/lib/rbac';
import { serverFetch, serverFetchResult } from '@/lib/server-api';
import { cn } from '@/lib/utils';

import { ChangePasswordCard } from './change-password-card';
import { PlatformsCard } from './platforms-card';
import {
  CARD_CLS,
  CardHead,
  PageHead,
  Pill,
  SectionHead,
  SET_CARD_CLS,
  SET_ROW_CLS,
  SettingsRowBody,
} from './settings-ui';
import { VtexFeesCard } from './vtex-fees-card';

export const metadata: Metadata = { title: 'Ajustes' };

export default async function SettingsPage() {
  const res = await serverFetchResult<SessionUser>('/v1/auth/me');
  const me = res.ok ? res.data : null;
  // TODA la configuracion del workspace es de administradores: el gestor entra
  // a Ajustes solo por "Tu cuenta" (cambiar su clave).
  const isOwner = isAdmin(me?.role);
  // null = la lectura fallo (API caida/reiniciando). NUNCA se cae a defaults:
  // las cards guardan con PUT de reemplazo total y unos defaults sembrados a
  // ciegas pisarian la configuracion personalizada al primer "Guardar".
  const platforms = isOwner ? await serverFetch<Platform[]>('/v1/platforms') : null;
  const vtexFees = isOwner ? await serverFetch<VtexFees>('/v1/vtex-fees') : null;

  return (
    <div>
      <PageHead title="Ajustes" description="Tu cuenta y la configuración general del workspace." />

      <div className="space-y-[22px]">
        <section className="space-y-2.5">
          <SectionHead>Tu cuenta</SectionHead>

          <div className={CARD_CLS}>
            <CardHead
              icon={<Mail />}
              tone="cobalt"
              title={me?.email ?? 'No disponible'}
              badge={
                me?.role ? (
                  <Pill
                    tone={
                      me.role === 'OWNER'
                        ? 'ok'
                        : me.role === 'ADMIN'
                          ? 'violet'
                          : me.role === 'GESTOR'
                            ? 'cobalt'
                            : 'muted'
                    }
                  >
                    {ROLE_LABEL[me.role]}
                  </Pill>
                ) : null
              }
              description={
                isOwner
                  ? 'Ves y gestionas todo: sedes, conexiones, equipo y facturación.'
                  : canSeeAllWarehouses(me?.role)
                    ? 'Trabajas los pedidos de todas las sedes: facturas y generas guías.'
                    : 'Ves únicamente las sedes que te asignaron.'
              }
            />
          </div>

          <ChangePasswordCard />
        </section>

        <section className="space-y-2.5">
          <SectionHead>Workspace</SectionHead>

          <div className={CARD_CLS}>
            <CardHead
              icon={<Building2 />}
              mono
              title={me?.activeTenantSlug ?? 'Sin workspace activo'}
              description="Cada workspace tiene su propia base de datos aislada. Los datos sensibles (claves de Alegra, VTEX y Coordinadora) se guardan cifrados."
            />
          </div>

          {canManageMembers(me?.role) ? (
            <SettingsLink
              href="/settings/team"
              icon={<Users />}
              title="Equipo"
              description="Agrega personas y decide qué sedes ve cada quien."
            />
          ) : null}
          {canManageConnections(me?.role) ? (
            <SettingsLink
              href="/connections"
              icon={<Link2 />}
              title="Conexiones"
              description="VTEX/Addi e inteligencia artificial. Alegra, Coordinadora y el certificado se configuran dentro de cada sede."
            />
          ) : null}
        </section>

        {isOwner ? (
          <section className="space-y-2.5">
            <SectionHead>Pedidos</SectionHead>
            {/* Punto de quiebre del mockup (.g2 cae a una columna en 820px):
                con xl la pareja se veia en fila unica en cualquier portatil. */}
            <div className="grid gap-2.5 min-[820px]:grid-cols-2">
              <PlatformsCard initial={platforms} />
              <VtexFeesCard initial={vtexFees} />
            </div>
          </section>
        ) : null}

        {isOwner ? (
          <section className="space-y-2.5">
            <SectionHead>Envíos</SectionHead>
            {/* Los paquetes NO se editan aqui: cada catalogo tiene su propia
                pagina, que es donde caben en condiciones. Los dos catalogos son
                HERMANOS -> van en la misma fila, con el mismo punto de quiebre
                que la pareja de "Pedidos" (a una columna en 820px). */}
            <div className="grid gap-2.5 min-[820px]:grid-cols-2">
              <SettingsLink
                href="/settings/paquetes-guia"
                icon={<Package />}
                title="Paquetes de guía"
                description="Como los empaques del portal de Coordinadora: al generar una guía los eliges y llenan medidas y peso de un clic. Aplican a todas las sedes."
              />
              <SettingsLink
                href="/settings/paquetes-skydropx"
                icon={<Boxes />}
                title="Paquetes Skydropx"
                description="Como los «Mis paquetes» de tu panel de Skydropx (su API no los deja traer): al generar en modo Skydropx los eliges y llenan medidas y peso de un clic. Independientes de los paquetes de Coordinadora."
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Fila navegable del mockup (.set): casilla + titulo + bajada + chevron. */
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
    <Link href={href} className={cn(SET_CARD_CLS, SET_ROW_CLS)}>
      <SettingsRowBody icon={icon} title={title} description={description} />
    </Link>
  );
}
