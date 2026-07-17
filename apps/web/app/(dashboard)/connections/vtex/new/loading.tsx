export default function VtexConnectLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
        <div className="mt-3 h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-muted/60" />
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center gap-3">
              <div className="h-7 w-7 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted/70" />
              {i < 2 && <div className="h-px flex-1 animate-pulse bg-muted/40" />}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="space-y-4">
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
            <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
            <div className="flex justify-end">
              <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
