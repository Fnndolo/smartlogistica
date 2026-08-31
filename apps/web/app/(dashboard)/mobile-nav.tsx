'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AtSign, Boxes, Building2, LayoutDashboard, Settings } from 'lucide-react';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { canManageOrders, canSeeAllWarehouses, type MaybeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';

import { GlobalSearch } from './global-search';
import { useMentions } from './use-mentions';

/** Igual que el sidebar: cada pestaña dice QUE permiso la destapa. */
const everyone: (role: MaybeRole) => boolean = () => true;

const TABS = [
  {
    href: '/dashboard',
    label: 'Resumen',
    icon: LayoutDashboard,
    match: (p: string) => p === '/dashboard',
    show: canSeeAllWarehouses,
  },
  {
    href: '/orders',
    label: 'Pedidos',
    icon: Boxes,
    match: (p: string) => p.startsWith('/orders'),
    show: canManageOrders,
  },
  {
    href: '/warehouses',
    label: 'Sedes',
    icon: Building2,
    match: (p: string) => p.startsWith('/warehouses'),
    show: everyone,
  },
  {
    href: '/mentions',
    label: 'Menciones',
    icon: AtSign,
    match: (p: string) => p.startsWith('/mentions'),
    show: everyone,
  },
  {
    href: '/settings',
    label: 'Ajustes',
    icon: Settings,
    match: (p: string) => p.startsWith('/settings') || p.startsWith('/connections'),
    show: everyone,
  },
] as const;

/**
 * Barra superior (solo movil): logo + workspace + campana de notificaciones.
 *
 * En movil NO existe el rail oscuro: estas dos barras son el borde del LIENZO,
 * asi que van en la superficie clara (card) con la tinta del contenido. Lo
 * unico que se trae del rail es el mosaico cobalto de la marca.
 */
export function MobileTopBar() {
  const user = useCurrentUser();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-accent to-accent-deep text-white shadow-[0_4px_14px_-4px_hsl(var(--ring))]">
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
          <span className="truncate text-[13px] font-bold tracking-[-0.01em]">SmartLogística</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {user?.activeTenantSlug ?? '...'}
          </span>
        </span>
      </Link>
      {/* Menciones vive en la barra INFERIOR; aqui solo la busqueda global. */}
      <GlobalSearch variant="icon" />
    </header>
  );
}

/** Barra inferior de pestañas (solo movil), estilo app nativa. */
export function MobileBottomNav() {
  const pathname = usePathname();
  const user = useCurrentUser();
  // El operador solo ve Sedes, Menciones y Ajustes (no pedidos generales ni
  // resumen); el gestor los ve todos (WhatsApp no vive en esta barra).
  const tabs = TABS.filter((t) => t.show(user?.role));
  const { unread } = useMentions();
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        tabs.length >= 5 ? 'grid-cols-5' : tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
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
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors [transition-duration:140ms]',
              active ? 'font-bold text-accent-ink' : 'font-medium text-muted-foreground',
            )}
          >
            {/* Eco del riel del sidebar: barra de acento en la pestaña activa. */}
            {active ? (
              <span className="absolute inset-x-5 top-0 h-[2.5px] rounded-b-[3px] bg-accent" aria-hidden />
            ) : null}
            <span className="relative">
              <Icon className={cn('h-5 w-5', active ? 'text-accent' : 'text-muted-foreground')} />
              {tab.href === '/mentions' && unread > 0 ? (
                <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-extrabold tabular-nums leading-none text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate px-1">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
