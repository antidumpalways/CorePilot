import type { DataSource } from "../lib/api";

const STYLES: Record<DataSource, { label: string; className: string; dot: string }> = {
  UNKNOWN: {
    label: "SOURCE UNKNOWN",
    className: "border-line bg-ink-700 text-muted",
    dot: "bg-muted",
  },
  LIVE: {
    label: "LIVE DATA",
    className: "border-long/40 bg-long/10 text-long",
    dot: "bg-long",
  },
  TESTNET: {
    label: "TESTNET",
    className: "border-warn/40 bg-warn/10 text-warn",
    dot: "bg-warn",
  },
  SIMULATED: {
    label: "SIMULATED",
    className: "border-slate-500/40 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-400",
  },
  DEMO: {
    label: "DEMO DATA",
    className: "border-line bg-ink-700 text-muted",
    dot: "bg-muted",
  },
};

export function DataSourceBadge({
  source,
  className = "",
}: {
  source: DataSource;
  className?: string;
}) {
  const style = STYLES[source];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${style.className} ${className}`}
      title="Data source label"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
