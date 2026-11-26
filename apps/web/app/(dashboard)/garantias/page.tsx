import { Suspense } from 'react';
import type { Metadata } from 'next';

import { WarrantiesClient } from './warranties-client';

export const metadata: Metadata = { title: 'Garantías' };

/** Garantias: todo el equipo las ve y las trabaja (no depende del rol). */
export default function GarantiasPage() {
  // Suspense: la vista lee filtros y la garantia abierta de la URL.
  return (
    <Suspense fallback={null}>
      <WarrantiesClient />
    </Suspense>
  );
}
