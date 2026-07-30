'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AtSign,
  Boxes,
  Building2,
  LayoutDashboard,
  Link2,
  ListChecks,
  PackageCheck,
  Plus,
  Settings,
  Settings2,
  Users,
} from 'lucide-react';
import type { WarehouseSummary } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { useCurrentUser } from '@/components/providers/current-user-provider';

import { LogoutButton } from './_components/logout-button';
import { GlobalSearch } from './global-search';
import { useMentions } from './use-mentions';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard, adminOnly: true },
  { href: '/orders', label: 'Pedidos', icon: Boxes, adminOnly: true },
  { href: '/mentions', label: 'Menciones', icon: AtSign, adminOnly: false },
  { href: '/connections', label: 'Conexiones', icon: Link2, adminOnly: true },
  { href: '/settings/team', label: 'Equipo', icon: Users, adminOnly: true },
  { href: '/settings', label: 'Ajustes', icon: Settings, adminOnly: false },
] as const;

/** Contador de menciones sin leer (item "Menciones" del sidebar). */
function MentionsBadge() {
  const { unread } = useMentions();
  if (unread === 0) return null;
  return (
    <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold leading-none text-accent-foreground">
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

/** Iniciales para el avatar (nombre "Ana Pérez" -> "AP"; correo -> primera letra). */
function initials(nameOrEmail: string): string {
  const clean = nameOrEmail.split('@')[0] ?? nameOrEmail;
  const parts = clean.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function Sidebar() {
  const user = useCurrentUser();
  const pathname = usePathname();
  // El operador solo trabaja sus sedes: nada de pedidos generales, conexiones,
  // equipo ni resumen (cosas que no puede tocar). Ve sus sedes + Ajustes.
  const isAdminUser = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const navItems = NAV_ITEMS.filter((i) => isAdminUser || !i.adminOnly);
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    staleTime: 30_000,
  });

  return (
    // sticky + h-screen + overflow-y-auto: el sidebar queda fijo y con SU propio
    // scroll, independiente del scroll de la pagina. Superficie blanca sobre el
    // lienzo frio (profundidad del rediseño).
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card px-4 py-5 md:flex">
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2 px-2" prefetch>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4m0 0l8-4m-8 4v10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold tracking-tight">SmartLogistica</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {user?.activeTenantSlug ?? '...'}
            </span>
          </div>
        </Link>
      </div>

      <GlobalSearch variant="sidebar" />

      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {/* Riel de acento del item activo */}
              {isActive ? (
                <span className="absolute -left-px bottom-1.5 top-1.5 w-[2.5px] rounded-full bg-accent" />
              ) : null}
              <Icon
                className={cn(
                  'h-4 w-4 transition-colors',
                  isActive ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
              {item.label}
              {item.href === '/mentions' ? <MentionsBadge /> : null}
            </Link>
          );
        })}
      </nav>

      {/* Sedes */}
      <div className="mt-6">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sedes
          </span>
          {isAdminUser ? (
            <Link
              href="/warehouses"
              prefetch
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Gestionar sedes"
              title="Gestionar sedes"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
        <nav className="flex flex-col gap-0.5">
          {warehouses.length === 0 ? (
            <Link
              href="/warehouses"
              prefetch
              className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Crear primera sede
            </Link>
          ) : (
            warehouses.map((w) => {
              const base = `/warehouses/${w.id}`;
              const active = pathname === base || pathname.startsWith(`${base}/`);
              const subItems = [
                { href: base, label: 'Por preparar', icon: ListChecks },
                { href: `${base}/facturados`, label: 'Facturados', icon: PackageCheck },
                // Ajustes de la sede = conexiones/config: solo administradores.
                ...(isAdminUser
                  ? [{ href: `${base}/ajustes`, label: 'Ajustes', icon: Settings2 }]
                  : []),
              ];
              return (
                <div key={w.id}>
                  <Link
                    href={base}
                    prefetch
                    className={cn(
                      'group relative flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {active ? (
                      <span className="absolute -left-px bottom-1.5 top-1.5 w-[2.5px] rounded-full bg-accent" />
                    ) : null}
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Building2 className={cn('h-4 w-4 shrink-0', active && 'text-accent')} />
                      <span className="truncate">{w.name}</span>
                    </span>
                    {w.orderCount > 0 ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                        {w.orderCount}
                      </span>
                    ) : null}
                  </Link>
                  {active ? (
                    <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                      {subItems.map((s) => {
                        const on = pathname === s.href;
                        const Icon = s.icon;
                        return (
                          <Link
                            key={s.href}
                            href={s.href}
                            prefetch
                            className={cn(
                              'flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors',
                              on
                                ? 'font-medium text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            {s.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </nav>
      </div>

      <div className="mt-auto border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-2.5 px-1">
          {user ? (
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold tracking-wide text-accent">
                {initials(user.name ?? user.email)}
              </span>
              <span className="min-w-0">
                <p className="truncate text-xs font-medium">{user.name ?? user.email}</p>
                <p className="text-[11px] text-muted-foreground">
                  {user.role === 'OWNER'
                    ? 'Propietario'
                    : user.role === 'ADMIN'
                      ? 'Admin'
                      : user.role === 'OPERATOR'
                        ? 'Operador'
                        : 'Sin rol'}
                </p>
              </span>
            </>
          ) : (
            <>
              <div className="h-7 w-7 animate-pulse rounded-full bg-muted" />
              <div>
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-2.5 w-16 animate-pulse rounded bg-muted" />
              </div>
            </>
          )}
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
