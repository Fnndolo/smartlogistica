'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { PackagePreset } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

import { EMPTY_DRAFT, PackageCatalog, type PackageDraft } from './package-catalog';

/**
 * Paquetes predefinidos para las guias de Coordinadora — GLOBALES, aplican a
 * todas las sedes. Equivalen a los "empaques" del portal web de Coordinadora
 * (su API no los expone): se configuran aqui y se eligen en la pestana Guia.
 *
 * La pieza entera (buscador, filas y panel «Plantilla de paquete») vive en
 * package-catalog.tsx, hermanada con la de Skydropx. Aqui solo se aporta la
 * variante, la lista inicial y el PUT — que es de REEMPLAZO TOTAL, asi que
 * cada paquete confirmado en el panel manda la lista completa ya mutada.
 */
export function PackagePresetsCard({
  initial,
  standalone = false,
}: {
  initial: PackagePreset[];
  /** true = pagina propia: cabecera de PAGINA en vez de tarjeta. */ standalone?: boolean;
}) {
  const qc = useQueryClient();

  return (
    <PackageCatalog
      variant="coordinadora"
      standalone={standalone}
      initial={initial.map(toDraft)}
      onSave={async (rows) => {
        const saved = await api.put<PackagePreset[]>(
          `/v1/warehouses/package-presets`,
          rows.map(toPreset),
        );
        // El panel de guia lee los paquetes dentro del preview del pedido.
        qc.invalidateQueries({ queryKey: ['guide-preview'] });
        return saved;
      }}
    />
  );
}

const toDraft = (p: PackagePreset): PackageDraft => ({
  ...EMPTY_DRAFT,
  name: p.name,
  length: String(p.length),
  width: String(p.width),
  height: String(p.height),
  weight: String(p.weight),
  content: p.content ?? '',
  isDefault: p.isDefault === true,
});

/** Borrador -> paquete del esquema (los campos vacios no viajan). */
const toPreset = (r: PackageDraft): PackagePreset => ({
  name: r.name.trim(),
  weight: Number(r.weight),
  height: Number(r.height),
  width: Number(r.width),
  length: Number(r.length),
  ...(r.content.trim() ? { content: r.content.trim() } : {}),
  ...(r.isDefault ? { isDefault: true } : {}),
});
