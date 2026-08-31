export default function ConnectionsLoading() {
  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-start gap-3.5 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="h-6 w-44 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-muted/60" />
        </div>
        {/* Espejo de la accion compacta (.btn-sm) de la cabecera. */}
        <div className="ml-auto h-8 w-32 animate-pulse rounded-[9px] bg-muted" />
      </div>

      <div className="flex items-center gap-[9px]">
        <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-[10px] grid gap-[10px]">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-[13px] rounded-[14px] border border-border bg-card p-[15px_16px]"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-[11px] bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-48 max-w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 max-w-full animate-pulse rounded bg-muted/60" />
            </div>
            <div className="h-8 w-28 shrink-0 animate-pulse rounded-[9px] bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
