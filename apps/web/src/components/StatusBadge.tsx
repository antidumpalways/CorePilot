export function StatusBadge({ active }: { active: boolean | null }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-2 rounded-[8px] border border-long/25 bg-long/10 px-2.5 py-1.5 text-[11px] font-bold text-long">
        <span className="h-1.5 w-1.5 rounded-full bg-long shadow-[0_0_10px_#22c55e]" />
        Active
      </span>
    );
  }
  if (active === null) return <span className="inline-flex items-center rounded-[8px] border border-line/70 bg-ink-700/50 px-2.5 py-1.5 text-[11px] font-bold text-muted">Unverified</span>;
  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] border border-line/70 bg-ink-700 px-2.5 py-1.5 text-[11px] font-bold text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      Inactive
    </span>
  );
}

export function ExecutionStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const isRequested = normalized === "ADAPTER_REQUESTED";
  const label = normalized === "EXECUTED" ? "Legacy EXECUTED" : normalized === "ADAPTER_REQUESTED" ? "Adapter requested" : status.replaceAll("_", " ");
  const isRejected = normalized === "REJECTED" || normalized === "FAILED";
  return (
    <span
      className={
        isRequested
          ? "inline-flex items-center rounded-[8px] border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] font-bold text-warn"
          : isRejected ? "inline-flex items-center rounded-[8px] border border-short/30 bg-short/10 px-2.5 py-1.5 text-[11px] font-bold text-short"
          : "inline-flex items-center rounded-[8px] border border-line/70 bg-ink-700 px-2.5 py-1.5 text-[11px] font-bold text-muted"
      }
    >
      {label}
    </span>
  );
}
