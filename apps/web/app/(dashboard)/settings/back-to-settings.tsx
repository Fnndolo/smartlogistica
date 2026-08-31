import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Migaja de vuelta a Ajustes, con el mismo tratamiento del asistente de VTEX
 * (micro-etiqueta en mayusculas sobre una linea): las paginas de configuracion
 * que cuelgan de Ajustes tienen que poder devolverse sin usar el navegador.
 */
export function BackToSettings() {
  return (
    <div className="mb-[18px] border-b border-border pb-4">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint transition-colors [transition-duration:140ms] hover:text-accent-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a ajustes
      </Link>
    </div>
  );
}
