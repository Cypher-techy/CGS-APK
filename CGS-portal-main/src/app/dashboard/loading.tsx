export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-56 animate-pulse rounded bg-subtle-border" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-subtle-border bg-surface" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-subtle-border bg-surface" />
    </div>
  );
}
