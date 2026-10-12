export function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-long/40 bg-long/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-long">
        <span className="h-1.5 w-1.5 rounded-full bg-long" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      Inactive
    </span>
  );
}

export function ExecutionStatusBadge({ status }: { status: string }) {
  const isExecuted = status.toUpperCase() === "EXECUTED";
  return (
    <span
      className={
        isExecuted
          ? "inline-flex items-center rounded border border-long/40 bg-long/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-long"
          : "inline-flex items-center rounded border border-short/40 bg-short/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-short"
      }
    >
      {status}
    </span>
  );
}
