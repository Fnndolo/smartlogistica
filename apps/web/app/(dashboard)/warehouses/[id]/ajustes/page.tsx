import type {
  AlegraConnectionSummary,
  CoordinadoraConnectionSummary,
} from '@smartlogistica/shared';

import { getWarehouses, serverFetch } from '@/lib/server-api';
import { AlegraConnectionCard } from '../alegra-connection-card';
import { AlegraSellerCard } from '../alegra-seller-card';
import { CertificateCard } from '../certificate-card';
import { CoordinadoraConnectionCard } from '../coordinadora-connection-card';

/** Ajustes de la sede: conexiones (Alegra/Coordinadora) + Certificado. */
export default async function WarehouseSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const warehouse = (await getWarehouses()).find((w) => w.id === id);
  const name = warehouse?.name ?? '';
  const [alegra, coordinadora] = await Promise.all([
    serverFetch<AlegraConnectionSummary | null>(`/v1/warehouses/${id}/alegra`),
    serverFetch<CoordinadoraConnectionSummary | null>(`/v1/warehouses/${id}/coordinadora`),
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
        <CoordinadoraConnectionCard warehouseId={id} warehouseName={name} initial={coordinadora ?? null} />
      </div>
      <AlegraSellerCard warehouseId={id} />
      <CertificateCard warehouseId={id} warehouseName={name} />
    </div>
  );
}
