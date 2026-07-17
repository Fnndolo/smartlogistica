export default function ConnectionsLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="h-7 w-44 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-muted/60" />
        </div>
        <div className="h-9 w-36 animate-pulse rounded-md bg-muted" />
      </div>

      <div className="grid gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
              <div className="space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
            <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
