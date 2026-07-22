import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Actualiza los query params de la URL SIN round-trip al servidor (no re-ejecuta
 * los Server Components). En Next 15, window.history.replaceState esta integrado
 * con el router: useSearchParams se actualiza al instante y los componentes
 * cliente reaccionan. Se usa en filtros/orden/paginacion, que ya refrescan los
 * datos por React Query en el cliente -> la interaccion se siente inmediata (con
 * router.replace se disparaba un SSR que tardaba varios segundos).
 */
export function replaceUrlParams(pathname: string, params: URLSearchParams): void {
  if (typeof window === 'undefined') return;
  const qs = params.toString();
  window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
}
