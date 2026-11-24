import { IS_SANDBOX } from '@/lib/sandbox';

/**
 * Pastilla fija "PRUEBAS" arriba al centro, en TODAS las pantallas (tambien
 * el login). No captura clics: queda encima de la cabecera sin estorbarla.
 */
export function SandboxBanner() {
  if (!IS_SANDBOX) return null;
  return (
    <div
      role="status"
      aria-label="Ambiente de pruebas"
      className="pointer-events-none fixed left-1/2 top-[max(env(safe-area-inset-top),4px)] z-[200] -translate-x-1/2 select-none rounded-full bg-amber-400 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black shadow-md ring-1 ring-black/10"
    >
      Ambiente de pruebas · copia de producción
    </div>
  );
}
