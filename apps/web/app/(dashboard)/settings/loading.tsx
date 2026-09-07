/**
 * Ajustes tarda porque el servidor pide sus datos al API antes de pintar. Sin
 * esto, el navegador se queda en la pagina ANTERIOR mientras tanto y parece
 * que el clic no hizo nada. Con esto la navegacion es instantanea.
 */
export default function SettingsLoading() {
  return (
    <div>
      <div className="mb-[18px] border-b border-border pb-4">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-md animate-pulse rounded bg-muted/60" />
      </div>

      {Array.from({ length: 3 }).map((_, s) => (
        <section key={s} className={s === 0 ? 'space-y-2.5' : 'mt-[22px] space-y-2.5'}>
          <div className="flex items-center gap-[9px]">
            <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-2.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-[13px] rounded-[14px] border border-border bg-card px-4 py-3.5"
              >
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-[11px] bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-40 max-w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted/60" />
                </div>
                <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
