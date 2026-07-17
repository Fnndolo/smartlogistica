export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-xs animate-pulse rounded bg-muted/60" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
            <div className="mt-3 h-9 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-border bg-card p-8">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-muted" />
        <div className="mx-auto mt-4 h-4 w-64 animate-pulse rounded bg-muted/70" />
        <div className="mx-auto mt-2 h-3 w-full max-w-sm animate-pulse rounded bg-muted/60" />
      </div>
    </div>
  );
}
