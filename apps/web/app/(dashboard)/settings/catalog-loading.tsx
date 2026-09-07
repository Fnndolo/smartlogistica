/**
 * Esqueleto de los dos catalogos de paquetes. Comparten forma — cabecera,
 * boton de agregar y una lista de filas — asi que comparten espera.
 */
export function CatalogLoading() {
  return (
    <div>
      <div className="mb-3 h-4 w-28 animate-pulse rounded bg-muted/60" />
      <div className="rounded-[14px] border border-border bg-card px-4 py-[15px]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-[11px] bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full max-w-lg animate-pulse rounded bg-muted/60" />
          </div>
          <div className="h-8 w-24 shrink-0 animate-pulse rounded-[9px] bg-muted" />
        </div>
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[11px] border border-border px-3 py-2.5"
            >
              <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted/60" />
              <div className="h-3.5 w-36 max-w-full animate-pulse rounded bg-muted" />
              <div className="ml-auto h-3 w-28 animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
