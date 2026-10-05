import { notFound } from 'next/navigation';

import { getWarehousesResult, hasSession } from '@/lib/server-api';

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

  // Si NO se pudo preguntar, se levanta el error y lo recoge error.tsx, que
  // ofrece reintentar. Antes esto caia en el mismo `notFound()` de abajo: un
  // parpadeo del API y la sede "dejaba de existir" — con el agravante de que la
  // barra lateral, alimentada por la misma lista vacia, invitaba a "crear la
  // primera sede" cuando ya habia varias.
  const res = await getWarehousesResult();
  if (!res.ok) {
    throw new Error('No se pudieron cargar las sedes');
  }
  const warehouse = res.data.find((w) => w.id === id);
  // Esto si es un 404 de verdad: la lista llego y la sede no esta.
  if (!warehouse) notFound();

  return (
    <div className="space-y-5">
      <SedeTabs warehouseId={id} />
      {children}
    </div>
  );
}
