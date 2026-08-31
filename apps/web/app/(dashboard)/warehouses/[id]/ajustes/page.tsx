import { redirect } from 'next/navigation';
import type {
  AlegraConnectionSummary,
  CoordinadoraConnectionSummary,
  SkydropxSedeConfig,
} from '@smartlogistica/shared';

import { canManageConnections } from '@/lib/rbac';
import { getSessionUser, getWarehouses, serverFetch } from '@/lib/server-api';
import { AlegraConnectionCard } from '../alegra-connection-card';
import { AlegraFixedClientCard } from '../alegra-fixed-client-card';
import { AlegraSellerCard } from '../alegra-seller-card';
import { CertificateCard } from '../certificate-card';
import { CoordinadoraConnectionCard } from '../coordinadora-connection-card';
import { SkydropxSedeCard } from '../skydropx-sede-card';

/** Ajustes de la sede: conexiones (Alegra/Coordinadora) + Certificado. */
export default async function WarehouseSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Los Ajustes de la sede son conexiones/configuracion: solo administradores.
  // Quien no lo sea vuelve a los pedidos de la sede (el gestor si entra ahi).
  const me = await getSessionUser();
  if (me && !canManageConnections(me.role)) redirect(`/warehouses/${id}`);

  const warehouse = (await getWarehouses()).find((w) => w.id === id);
  const name = warehouse?.name ?? '';
  const [alegra, coordinadora, skydropxSede] = await Promise.all([
    serverFetch<AlegraConnectionSummary | null>(`/v1/warehouses/${id}/alegra`),
    serverFetch<CoordinadoraConnectionSummary | null>(`/v1/warehouses/${id}/coordinadora`),
    serverFetch<SkydropxSedeConfig | null>(`/v1/skydropx/sede-config/${id}`),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <nav className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="font-medium">Sedes</span>
          <span aria-hidden>·</span>
          <span>{name}</span>
          <span aria-hidden>·</span>
          <span>Ajustes</span>
        </nav>
        <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">
          {name} · Ajustes
        </h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <AlegraConnectionCard warehouseId={id} warehouseName={name} initial={alegra ?? null} />
        <CoordinadoraConnectionCard
          warehouseId={id}
          warehouseName={name}
          initial={coordinadora ?? null}
        />
        {/* Remitente Skydropx: gestion SEPARADA de Coordinadora. */}
        <SkydropxSedeCard warehouseId={id} initial={skydropxSede ?? null} />
      </div>
      <AlegraFixedClientCard warehouseId={id} />
      <AlegraSellerCard warehouseId={id} />
      <CertificateCard warehouseId={id} warehouseName={name} />
    </div>
  );
}
