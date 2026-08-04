'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ListChecks, PackageCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Pestañas de Pedidos generales en MOVIL (el sidebar no existe alli):
 * Por preparar | Facturados (los cerrados POR FUERA de SmartLogistica).
 */
export function OrdersTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/orders', label: 'Por preparar', icon: ListChecks },
    { href: '/orders/facturados', label: 'Facturados', icon: PackageCheck },
  ];
  return (
    <nav className="flex gap-2 md:hidden" aria-label="Secciones de pedidos">
      {tabs.map((t) => {
        const on = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              on
                ? 'border-accent/40 bg-accent/10 text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            <Icon className={cn('h-4 w-4', on && 'text-accent')} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
