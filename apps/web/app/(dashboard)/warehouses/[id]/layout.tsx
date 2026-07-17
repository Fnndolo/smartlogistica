import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { getWarehouses, hasSession } from '@/lib/server-api';

/**
 * Layout de una sede: cabecera con el nombre. Las 3 sub-secciones (por preparar /
 * facturados / ajustes) se navegan desde el menu lateral y se renderizan aqui.
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
    <div className="space-y-6">
      <header>
        <Link
          href="/warehouses"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sedes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{warehouse.name}</h1>
      </header>
      {children}
    </div>
  );
}
