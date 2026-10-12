import type { DataSource } from "../lib/api";

const STYLES: Record<DataSource, { label: string; className: string; dot: string }> = {
  LIVE: {
    label: "LIVE DATA",
    className: "border-long/40 bg-long/10 text-long",
    dot: "bg-long",
  },
  TESTNET: {
    label: "TESTNET",
    className: "border-accent/40 bg-accent/10 text-accent",
    dot: "bg-accent",
  },
  SIMULATED: {
    label: "SIMULATED",
    className: "border-warn/40 bg-warn/10 text-warn",
    dot: "bg-warn",
  },
  DEMO: {
    label: "DEMO DATA",
    className: "border-purple-400/40 bg-purple-400/10 text-purple-300",
    dot: "bg-purple-400",
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
