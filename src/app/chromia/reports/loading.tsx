/** Reports, while its charts are read: the four panels' outlines, so the page does not jump when they arrive. */
export default function ReportsLoading() {
  const panel = 'border-line surface animate-pulse rounded-xl border p-6';
  const bar = 'h-3 rounded bg-[var(--line)]';
  return (
    <div aria-busy="true" aria-label="Loading reports">
      <div className="mb-6 h-8 w-40 animate-pulse rounded bg-[var(--line)]" />
      <div className="flex flex-col gap-6">
        <div className={panel}>
          <div className={`${bar} mb-6 w-56`} />
          {[90, 72, 55, 40, 26].map((w) => (
            <div key={w} className="mb-3 flex items-center gap-3">
              <div className={`${bar} w-32`} />
              <div className="h-5 rounded bg-[var(--line)]" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className={`${panel} h-64`} />
          <div className={`${panel} h-64`} />
        </div>
        <div className={`${panel} h-72`} />
        <div className={`${panel} h-72`} />
      </div>
      <p className="sr-only">Loading reports…</p>
    </div>
  );
}
