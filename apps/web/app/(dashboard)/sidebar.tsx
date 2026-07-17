'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
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
import { NotificationBell } from './notification-bell';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/orders', label: 'Pedidos', icon: Boxes },
  { href: '/connections', label: 'Conexiones', icon: Link2 },
  { href: '/settings/team', label: 'Equipo', icon: Users },
  { href: '/settings', label: 'Ajustes', icon: Settings },
] as const;

export function Sidebar() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    staleTime: 30_000,
  });

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-background/40 px-4 py-5 md:flex">
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
        <NotificationBell />
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
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
                'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
              {item.label}
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
          <Link
            href="/warehouses"
            prefetch
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Gestionar sedes"
            title="Gestionar sedes"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
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
                { href: `${base}/ajustes`, label: 'Ajustes', icon: Settings2 },
              ];
              return (
                <div key={w.id}>
                  <Link
                    href={base}
                    prefetch
                    className={cn(
                      'group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Building2 className="h-4 w-4 shrink-0" />
                      <span className="truncate">{w.name}</span>
                    </span>
                    {w.orderCount > 0 ? (
                      <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] font-semibold tabular-nums">
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
        <div className="mb-2 px-2">
          {user ? (
            <>
              <p className="truncate text-xs font-medium">{user.email}</p>
              <p className="text-[11px] text-muted-foreground">{user.role ?? 'Sin rol'}</p>
            </>
          ) : (
            <>
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              <div className="mt-1 h-2.5 w-16 animate-pulse rounded bg-muted" />
            </>
          )}
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
