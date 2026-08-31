'use client';

import type { SkydropxPackagePreset } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

import { EMPTY_DRAFT, PackageCatalog, type PackageDraft } from './package-catalog';

/**
 * Paquetes guardados PROPIOS del modo Skydropx — GLOBALES. Equivalen a los
 * "Mis paquetes" del panel de Skydropx, que su API no expone (probado): se
 * gestionan aqui y se eligen al generar una guia en modo Skydropx. Aparte de
 * los paquetes de guia de Coordinadora ("Coordinadora lo suyo, Skydropx lo
 * suyo").
 *
 * initial null = la lectura SSR fallo: NO se permite editar ni guardar (el PUT
 * es reemplazo total y pisaria el catalogo real).
 *
 * Misma pieza que la tarjeta de Coordinadora (package-catalog.tsx); la
 * variante 'skydropx' agrega Empaque y Valor declarado y exige el contenido.
 */
export function SkydropxPackagesCard({
  initial,
  standalone = false,
}: {
  initial: SkydropxPackagePreset[] | null;
  /** true = pagina propia: cabecera de PAGINA en vez de tarjeta. */ standalone?: boolean;
}) {
  return (
    <PackageCatalog
      variant="skydropx"
      standalone={standalone}
      initial={(initial ?? []).map(toDraft)}
      blocked={
        initial === null
          ? 'No se pudieron cargar los paquetes (API reiniciando). Recarga la página antes de editar.'
          : null
      }
      onSave={(rows) =>
        api.put<SkydropxPackagePreset[]>(`/v1/skydropx/package-presets`, rows.map(toPreset))
      }
    />
  );
}

const toDraft = (p: SkydropxPackagePreset): PackageDraft => ({
  ...EMPTY_DRAFT,
  name: p.name,
  length: String(p.length),
  width: String(p.width),
  height: String(p.height),
  weight: String(p.weight),
  content: p.content ?? '',
  packagingCode: p.packagingCode ?? '',
  declaredValue: p.declaredValue === undefined ? '' : String(p.declaredValue),
  isDefault: p.isDefault === true,
});

/**
 * Borrador -> paquete del esquema. El embalaje (ahora editable con el catalogo
 * real) y el valor declarado SIEMPRE pasan: perderlos aqui los borraria del
 * catalogo, porque el PUT reemplaza la lista entera.
 */
const toPreset = (r: PackageDraft): SkydropxPackagePreset => {
  const declared = Number(r.declaredValue.trim());
  return {
    name: r.name.trim(),
    weight: Number(r.weight),
    height: Number(r.height),
    width: Number(r.width),
    length: Number(r.length),
    // En Skydropx el contenido es obligatorio (lo exige la guia).
    content: r.content.trim(),
    ...(r.packagingCode ? { packagingCode: r.packagingCode } : {}),
    ...(r.declaredValue.trim() && Number.isFinite(declared) ? { declaredValue: declared } : {}),
    ...(r.isDefault ? { isDefault: true } : {}),
  };
};
