'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ListChecks, PackageCheck, Settings2 } from 'lucide-react';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { canManageConnections } from '@/lib/rbac';
import { cn } from '@/lib/utils';

/**
 * Pestañas de la sede (Por preparar / Facturados / Ajustes) — SOLO en movil:
 * en escritorio ya existen como sub-items del sidebar, pero en el celular el
 * sidebar no se ve y no habia forma de llegar a Facturados ni a Ajustes.
 */
export function SedeTabs({ warehouseId }: { warehouseId: string }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  // Ajustes de la sede = conexiones/config: solo administradores (ni el gestor).
  const canSeeSettings = canManageConnections(user?.role);
  const base = `/warehouses/${warehouseId}`;

  const tabs = [
    { href: base, label: 'Por preparar', icon: ListChecks },
    { href: `${base}/facturados`, label: 'Facturados', icon: PackageCheck },
    ...(canSeeSettings ? [{ href: `${base}/ajustes`, label: 'Ajustes', icon: Settings2 }] : []),
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1 md:hidden">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
