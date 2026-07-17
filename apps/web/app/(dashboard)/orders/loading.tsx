export default function OrdersLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-muted/60" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="h-9 w-full max-w-xs animate-pulse rounded-md bg-muted sm:w-48" />
        <div className="hidden h-4 w-40 animate-pulse rounded bg-muted/60 sm:block" />
      </div>

      <div className="rounded-xl border border-border bg-card">
        {/* Cabecera de columnas: solo escritorio. */}
        <div className="hidden border-b border-border p-3 md:block">
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-3 w-20 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-border p-3 last:border-0">
            {/* Movil: skeleton de tarjeta (apilado). */}
            <div className="space-y-2 md:hidden">
              <div className="flex items-center justify-between">
                <div className="h-3 w-32 animate-pulse rounded bg-muted/70" />
                <div className="h-5 w-28 animate-pulse rounded-full bg-muted/70" />
              </div>
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-48 animate-pulse rounded bg-muted/60" />
            </div>
            {/* Escritorio: skeleton de fila (columnas). */}
            <div className="hidden gap-4 md:flex">
              {Array.from({ length: 6 }).map((_, j) => (
                <div
                  key={j}
                  className="h-4 animate-pulse rounded bg-muted/70"
                  style={{ width: `${60 + ((i * j) % 4) * 20}px`, animationDelay: `${i * 50}ms` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
