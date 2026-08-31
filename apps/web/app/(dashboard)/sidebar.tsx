'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AtSign,
  Boxes,
  Building2,
  LayoutDashboard,
  Link2,
  MessageCircle,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import type { OrdersDashboard, WarehouseSummary } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import {
  canManageConnections,
  canManageMembers,
  canManageOrders,
  canSeeAllWarehouses,
  canUseWhatsapp,
  isAdmin,
  roleLabel,
  type MaybeRole,
} from '@/lib/rbac';
import { useCurrentUser } from '@/components/providers/current-user-provider';

import { LogoutButton } from './_components/logout-button';
import { GlobalSearch } from './global-search';
import { useMentions } from './use-mentions';

/**
 * Cada item declara QUE permiso lo destapa (no "adminOnly", que solo sabia
 * decir admin/no-admin y dejaba al GESTOR sin pedidos o con Conexiones).
 */
const everyone: (role: MaybeRole) => boolean = () => true;

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard, show: canSeeAllWarehouses },
  { href: '/orders', label: 'Pedidos', icon: Boxes, show: canManageOrders },
  // WhatsApp es de administradores en el API (WhatsappService.assertAdmin).
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, show: canUseWhatsapp },
  { href: '/mentions', label: 'Menciones', icon: AtSign, show: everyone },
  { href: '/connections', label: 'Conexiones', icon: Link2, show: canManageConnections },
  { href: '/settings/team', label: 'Equipo', icon: Users, show: canManageMembers },
  { href: '/settings', label: 'Ajustes', icon: Settings, show: everyone },
] as const;

/*
 * Lenguaje del rail (mockup "Shell Cobalto"): el rail es CHROME oscuro, no la
 * mesa de trabajo. Por eso su tinta no es foreground/muted sino rail-ink /
 * rail-ink-2, y los estados usan blanco translucido (funciona igual en claro y
 * oscuro porque el fondo del rail es marino en los dos temas).
 */
const ITEM_BASE =
  'group relative flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] font-semibold transition-colors [transition-duration:140ms]';
const ITEM_IDLE = 'text-rail-ink-2 hover:bg-white/[0.06] hover:text-rail-ink';
const ITEM_ACTIVE = 'bg-gradient-to-r from-accent/[0.34] to-accent/[0.14] text-white';

/**
 * Sub-item (.sub .item del mockup): SOLO texto. Sin icono a la izquierda —
 * la jerarquia ya la da el riel vertical del grupo, y meterle iconos volvia a
 * poner tres niveles de simbolo en la misma columna.
 */
const SUB_BASE =
  'flex items-center rounded-[9px] px-[9px] py-1.5 text-[12.5px] font-medium transition-colors [transition-duration:140ms]';

/** Riel de 3px pegado al borde IZQUIERDO del rail (el padding es px-3 = 12px). */
function ActiveRail() {
  return <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-[3px] bg-accent" aria-hidden />;
}

/** Contador de menciones sin leer (item "Menciones" del sidebar). */
function MentionsBadge() {
  const { unread } = useMentions();
  if (unread === 0) return null;
  return (
    <span className="ml-auto inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-1.5 py-px text-[10px] font-extrabold tabular-nums leading-[1.4] text-white">
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
  // El gestor trabaja los pedidos de TODAS las sedes, pero sin conexiones,
  // equipo, WhatsApp ni la configuracion de la sede.
  const isAdminUser = isAdmin(user?.role);
  const navItems = NAV_ITEMS.filter((i) => i.show(user?.role));
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    staleTime: 30_000,
  });
  // Contador de "Pedidos" (generales), gemelo del de las sedes. El numero es el
  // MISMO del Resumen: `unassigned` = espejo de VTEX esperando sede, que es
  // exactamente lo que lista /orders. El rail vive en el layout y no se
  // desmonta al navegar, asi que esto es UNA consulta por sesion (como
  // /v1/warehouses), no una por pagina; y solo para quien ve el item — el API
  // niega el resumen a los demas.
  const seesOrders = canManageOrders(user?.role);
  const { data: dashboard } = useQuery({
    queryKey: ['orders-dashboard'],
    queryFn: () => api.get<OrdersDashboard>('/v1/orders/dashboard'),
    enabled: seesOrders,
    staleTime: 30_000,
  });
  const generalCount = dashboard?.unassigned ?? 0;

  // La barra de scroll del rail solo se ve MIENTRAS se scrollea: se enciende
  // con el evento y se apaga sola al segundo de quietud (el hover tambien la
  // muestra, eso lo hace el CSS).
  const [scrolling, setScrolling] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback(() => {
    setScrolling(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setScrolling(false), 900);
  }, []);
  useEffect(() => () => void (idleTimer.current && clearTimeout(idleTimer.current)), []);

  return (
    // sticky + h-screen + overflow-y-auto: el rail queda fijo y con SU propio
    // scroll, independiente del scroll de la pagina. La barra va SUPERPUESTA
    // (scrollbar-overlay): no se ve en reposo y aparece solo al scrollear.
    <aside
      onScroll={onScroll}
      className={cn(
        'scrollbar-overlay sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col gap-3.5 overflow-y-auto border-r border-rail-line bg-gradient-to-b from-rail to-rail-2 px-3 py-3.5 text-rail-ink md:flex',
        scrolling && 'is-scrolling',
      )}
    >
      <Link
        href="/dashboard"
        prefetch
        className="flex min-w-0 items-center gap-2.5 px-1.5 pb-0.5 pt-1"
      >
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-accent to-accent-deep text-white shadow-[0_4px_14px_-4px_hsl(var(--ring))]">
          <svg viewBox="0 0 24 24" fill="none" className="h-[17px] w-[17px]" aria-hidden>
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
          <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-rail-ink">
            SmartLogística
          </span>
          <span className="truncate font-mono text-[11px] text-rail-ink-2">
            {user?.activeTenantSlug ?? '...'}
          </span>
        </span>
      </Link>

      {/* El disparador de la busqueda global vive dentro de <GlobalSearch/>
          (mismo componente, mismas props, mismo atajo ⌘K). Aqui solo se le
          repinta con la tinta del rail: el envoltorio gana por especificidad
          (.wrapper > button) sin tocar el componente. */}
      <div
        className={cn(
          '[&>button]:mb-0 [&>button]:gap-2 [&>button]:rounded-[10px] [&>button]:border-rail-line [&>button]:bg-white/[0.04] [&>button]:px-2.5 [&>button]:py-[7px] [&>button]:text-rail-ink-2 [&>button]:[transition-duration:140ms]',
          '[&>button:hover]:border-accent [&>button:hover]:bg-accent/[0.12] [&>button:hover]:text-rail-ink',
          '[&>button>span]:text-[12.5px]',
          '[&_kbd]:border-b [&_kbd]:border-rail-line [&_kbd]:bg-transparent [&_kbd]:px-[5px] [&_kbd]:py-px [&_kbd]:font-sans [&_kbd]:text-rail-ink-2',
        )}
      >
        <GlobalSearch variant="sidebar" />
      </div>

      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
          return (
            <Fragment key={item.href}>
              <Link
                href={item.href}
                prefetch
                // El estado activo se comunicaba SOLO por color: sin esto un
                // lector de pantalla no sabe en que pagina estas.
                aria-current={isActive ? 'page' : undefined}
                className={cn(ITEM_BASE, isActive ? ITEM_ACTIVE : ITEM_IDLE)}
              >
                {isActive ? <ActiveRail /> : null}
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.href === '/mentions' ? <MentionsBadge /> : null}
                {/* Mismo tratamiento que el conteo de las sedes (se oculta en 0). */}
                {item.href === '/orders' && generalCount > 0 ? (
                  <span className="ml-auto shrink-0 pl-1 text-[10.5px] tabular-nums text-rail-ink-2">
                    {generalCount}
                  </span>
                ) : null}
              </Link>
              {/* Sub-secciones de Pedidos generales, JUSTO debajo de Pedidos
                  (como las sedes): Por preparar y Facturados (por fuera). */}
              {item.href === '/orders' && isActive ? (
                <div className="my-0.5 ml-[22px] flex flex-col gap-px border-l border-rail-line pl-2.5">
                  {[
                    { href: '/orders', label: 'Por preparar' },
                    { href: '/orders/facturados', label: 'Facturados' },
                  ].map((s) => {
                    const on = pathname === s.href;
                    return (
                      <Link
                        key={s.href}
                        href={s.href}
                        prefetch
                        className={cn(SUB_BASE, on ? ITEM_ACTIVE : ITEM_IDLE)}
                      >
                        <span className="truncate">{s.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </Fragment>
          );
        })}

        {/* Sedes */}
        <div className="flex items-center px-2 pb-1 pt-2.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-rail-ink-2">
          Sedes
          {isAdminUser ? (
            <Link
              href="/warehouses"
              prefetch
              className="ml-auto grid h-[18px] w-[18px] place-items-center rounded-[5px] text-rail-ink-2 transition-colors [transition-duration:140ms] hover:bg-white/[0.08] hover:text-rail-ink"
              aria-label="Gestionar sedes"
              title="Gestionar sedes"
            >
              <Plus className="h-3 w-3" strokeWidth={2.4} />
            </Link>
          ) : null}
        </div>

        {warehouses.length === 0 ? (
          <Link
            href="/warehouses"
            prefetch
            className={cn(SUB_BASE, ITEM_IDLE, 'px-2.5')}
          >
            Crear primera sede
          </Link>
        ) : (
          warehouses.map((w) => {
            const base = `/warehouses/${w.id}`;
            const active = pathname === base || pathname.startsWith(`${base}/`);
            const subItems = [
              { href: base, label: 'Por preparar' },
              { href: `${base}/facturados`, label: 'Facturados' },
              // Ajustes de la sede = conexiones/config: solo administradores.
              ...(isAdminUser ? [{ href: `${base}/ajustes`, label: 'Ajustes' }] : []),
            ];
            return (
              <div key={w.id}>
                <Link
                  href={base}
                  prefetch
                  className={cn(ITEM_BASE, active ? ITEM_ACTIVE : ITEM_IDLE)}
                >
                  {active ? <ActiveRail /> : null}
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{w.name}</span>
                  {w.orderCount > 0 ? (
                    <span className="ml-auto shrink-0 pl-1 text-[10.5px] tabular-nums text-rail-ink-2">
                      {w.orderCount}
                    </span>
                  ) : null}
                </Link>
                {active ? (
                  <div className="my-0.5 ml-[22px] flex flex-col gap-px border-l border-rail-line pl-2.5">
                    {subItems.map((s) => {
                      const on = pathname === s.href;
                      return (
                        <Link
                          key={s.href}
                          href={s.href}
                          prefetch
                          className={cn(SUB_BASE, on ? ITEM_ACTIVE : ITEM_IDLE)}
                        >
                          <span className="truncate">{s.label}</span>
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

      <div className="mt-auto flex items-center gap-[9px] border-t border-rail-line pt-[11px]">
        {user ? (
          <>
            {/* .ava del mockup: tinta cobalto CLARA (#c9d6ff) sobre el lavado
                del acento — no el blanco casi puro de rail-ink. Ningun token
                solo sirve en los dos temas (el rail es marino en ambos pero
                wash-strong se hunde en oscuro y accent-ink se hunde en claro),
                asi que se toma de cada tema el que si queda claro y cobalto:
                wash-strong #dfe8ff en claro, accent-ink #b7c8ff en oscuro.
                Los dos bordean el tono del mockup, y el avatar se lee igual. */}
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/[0.28] text-[10.5px] font-extrabold tracking-wide text-wash-strong dark:text-accent-ink">
              {initials(user.name ?? user.email)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-rail-ink">
                {user.name ?? user.email}
              </span>
              <span className="block truncate text-[11px] text-rail-ink-2">
                {roleLabel(user.role)}
              </span>
            </span>
          </>
        ) : (
          <>
            <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-white/10" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
              <div className="mt-1 h-2.5 w-16 animate-pulse rounded bg-white/10" />
            </div>
          </>
        )}
        {/* Mismo <LogoutButton/> (su POST, su router.refresh y su toast); aqui
            solo se convierte en el boton de 26px del rail. El texto sigue en el
            DOM para los lectores de pantalla, solo se le quita el tamaño. */}
        <div
          className={cn(
            'shrink-0',
            '[&>button]:h-[26px] [&>button]:w-[26px] [&>button]:justify-center [&>button]:gap-0 [&>button]:rounded-[7px] [&>button]:px-0 [&>button]:py-0',
            '[&>button]:text-[length:0px] [&>button]:text-rail-ink-2 [&>button]:[transition-duration:140ms]',
            '[&>button:hover]:bg-white/[0.08] [&>button:hover]:text-rail-ink',
            '[&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:shrink-0',
          )}
        >
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
