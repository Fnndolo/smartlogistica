'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Pantalla de fallo del panel.
 *
 * Existe para que un tropiezo al traer datos NO se disfrace de otra cosa. Sin
 * ella, una pagina cuyo fetch fallaba acababa en el 404 de Next ("esta pagina
 * no existe"), que es una respuesta distinta y lleva a buscar el problema donde
 * no esta. Aqui se dice lo que pasa de verdad y se ofrece el unico gesto util:
 * volver a intentarlo.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Al log del navegador: el `digest` es lo que permite cruzarlo con el
    // servidor cuando alguien reporta "me salio el error".
    console.error('Error en el panel:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400">
        <TriangleAlert className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[15px] font-extrabold">No se pudieron cargar los datos</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] text-muted-foreground">
          Suele ser momentáneo: el servidor estaba reiniciando o la conexión falló. Tus datos están
          intactos.
        </p>
      </div>
      <Button onClick={reset} className="mt-1 gap-2">
        <RefreshCw className="h-4 w-4" />
        Reintentar
      </Button>
      {error.digest ? (
        <p className="mt-1 font-mono text-[10.5px] text-hint">ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
