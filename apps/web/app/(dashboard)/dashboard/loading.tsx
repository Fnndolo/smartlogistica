/** Esqueleto del Resumen: mismas cajas y alturas que la pagina real. */
export default function DashboardLoading() {
  return (
    <div>
      <div className="mb-[18px] border-b border-border pb-4">
        <div className="h-[22px] w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-muted/60" />
      </div>

      <div className="grid gap-3 min-[820px]:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-[15px]"
          >
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
            <div className="mt-2 h-9 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted/60" />
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-muted" />
          </div>
        ))}
      </div>

      <SectionSkeleton width="w-36" />
      <div className="divide-y divide-dashed divide-input rounded-[14px] border border-border bg-card px-4 py-[15px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-[11px]">
            <div className="h-8 w-8 flex-none animate-pulse rounded-[9px] bg-muted" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted/70" />
              <div className="mt-1.5 h-3 w-56 max-w-full animate-pulse rounded bg-muted/50" />
            </div>
            <div className="h-5 w-6 animate-pulse rounded bg-muted" />
            {/* Hueco del chevron: el conteo cae donde caera de verdad. */}
            <div className="h-[15px] w-[15px] flex-none" />
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, col) => (
          <section key={col} className="min-w-0">
            <SectionSkeleton width={col === 0 ? 'w-28' : 'w-44'} />
            <div className="rounded-[14px] border border-border bg-card px-4 py-[15px]">
              <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-[11px] py-[9px]">
                    <div className="h-3.5 min-w-0 flex-1 animate-pulse rounded bg-muted/70" />
                    <div
                      className={`h-1.5 flex-none animate-pulse rounded-[3px] bg-muted ${
                        col === 0 ? 'w-20 sm:w-[120px]' : 'hidden'
                      }`}
                    />
                    <div
                      className={`flex-none animate-pulse rounded bg-muted ${
                        col === 0 ? 'h-3.5 w-6' : 'h-4 w-20 rounded-full'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SectionSkeleton({ width }: { width: string }) {
  return (
    <div className="mb-2.5 mt-[22px] flex items-center gap-2.5">
      <div className={`h-3 animate-pulse rounded bg-muted/70 ${width}`} />
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
