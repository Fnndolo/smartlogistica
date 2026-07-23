'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Building2, LayoutDashboard, Settings } from 'lucide-react';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { cn } from '@/lib/utils';

import { NotificationBell } from './notification-bell';

const TABS = [
  {
    href: '/dashboard',
    label: 'Resumen',
    icon: LayoutDashboard,
    match: (p: string) => p === '/dashboard',
    adminOnly: true,
  },
  {
    href: '/orders',
    label: 'Pedidos',
    icon: Boxes,
    match: (p: string) => p.startsWith('/orders'),
    adminOnly: true,
  },
  {
    href: '/warehouses',
    label: 'Sedes',
    icon: Building2,
    match: (p: string) => p.startsWith('/warehouses'),
    adminOnly: false,
  },
  {
    href: '/settings',
    label: 'Ajustes',
    icon: Settings,
    match: (p: string) => p.startsWith('/settings') || p.startsWith('/connections'),
    adminOnly: false,
  },
] as const;

/** Barra superior (solo movil): logo + workspace + campana de notificaciones. */
export function MobileTopBar() {
  const user = useCurrentUser();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path
              d="M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4m0 0l8-4m-8 4v10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold tracking-tight">SmartLogistica</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {user?.activeTenantSlug ?? '...'}
          </span>
        </span>
      </Link>
      <NotificationBell align="right" />
    </header>
  );
}

/** Barra inferior de pestañas (solo movil), estilo app nativa. */
export function MobileBottomNav() {
  const pathname = usePathname();
  const user = useCurrentUser();
  // El operador solo ve Sedes y Ajustes (no pedidos generales ni resumen).
  const isAdminUser = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const tabs = TABS.filter((t) => isAdminUser || !t.adminOnly);
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-2',
      )}
      aria-label="Navegacion principal"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className={cn('h-5 w-5', active ? 'text-foreground' : 'text-muted-foreground')} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
