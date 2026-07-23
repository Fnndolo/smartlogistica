import { CurrentUserProvider } from '@/components/providers/current-user-provider';

import { MobileBottomNav, MobileTopBar } from './mobile-nav';
import { Sidebar } from './sidebar';

/**
 * Layout del dashboard. Es server component pero NO hace fetch al API — la
 * autenticacion la valida el middleware (presencia de cookie) antes de llegar
 * aqui. Los datos del usuario los carga CurrentUserProvider client-side una
 * sola vez por sesion (staleTime: Infinity).
 *
 * Resultado: navegacion entre secciones es instantanea — el sidebar y el shell
 * persisten, solo cambia el children. loading.tsx en cada segment muestra
 * feedback visual mientras la pagina carga sus datos.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <main className="flex-1">
            {/* pb extra en movil: deja espacio para la barra inferior de pestañas.
                max-w-7xl: la tabla de pedidos (9 columnas con "Direccion") necesita
                ~1230px; con 6xl (1152px) se desbordaba dentro de la tarjeta. */}
            <div className="mx-auto w-full max-w-7xl px-4 py-5 pb-24 sm:px-6 md:py-8 md:pb-8">
              {children}
            </div>
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </CurrentUserProvider>
  );
}
