import { notFound } from 'next/navigation';

import { getWarehouses, hasSession } from '@/lib/server-api';

import { SedeTabs } from './sede-tabs';

/**
 * Layout de una sede. El encabezado (migas + titulo + "En vivo") lo pinta cada
 * seccion (OrdersLive en Por preparar/Facturados; Ajustes trae el suyo); aqui
 * solo quedan las pestañas de navegacion en movil.
 */
export default async function WarehouseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await hasSession())) notFound();
  const warehouses = await getWarehouses();
  const warehouse = warehouses.find((w) => w.id === id);
  if (!warehouse) notFound();

  return (
    <div className="space-y-5">
      <SedeTabs warehouseId={id} />
      {children}
    </div>
  );
}
