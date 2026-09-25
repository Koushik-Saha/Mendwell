export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="border-b border-border pb-5">
        <div className="h-7 w-40 rounded-[var(--radius-control)] bg-muted" />
        <div className="mt-2 h-4 w-80 max-w-full rounded-[var(--radius-control)] bg-muted" />
      </div>
      <div className="mt-6 h-56 rounded-[var(--radius-panel)] border border-border bg-card" />
    </div>
  );
}
