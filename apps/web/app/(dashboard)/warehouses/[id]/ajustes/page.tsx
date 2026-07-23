import type {
  AlegraConnectionSummary,
  CoordinadoraConnectionSummary,
} from '@smartlogistica/shared';

import { getWarehouses, serverFetch } from '@/lib/server-api';
import { AlegraConnectionCard } from '../alegra-connection-card';
import { AlegraSellerCard } from '../alegra-seller-card';
import { CertificateCard } from '../certificate-card';
import { CoordinadoraConnectionCard } from '../coordinadora-connection-card';
import { PackagePresetsCard } from '../package-presets-card';

/** Ajustes de la sede: conexiones (Alegra/Coordinadora) + paquetes de guia + Certificado. */
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
      <div className="grid gap-4 lg:grid-cols-2">
        <AlegraConnectionCard warehouseId={id} warehouseName={name} initial={alegra ?? null} />
        <CoordinadoraConnectionCard warehouseId={id} warehouseName={name} initial={coordinadora ?? null} />
      </div>
      <AlegraSellerCard warehouseId={id} />
      <PackagePresetsCard warehouseId={id} initial={warehouse?.packagePresets ?? []} />
      <CertificateCard warehouseId={id} warehouseName={name} />
    </div>
  );
}
