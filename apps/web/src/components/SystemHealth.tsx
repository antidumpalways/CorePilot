import type { HealthResult, HealthState } from "../lib/api";

const labels: Record<HealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unknown: "Unknown",
  not_instrumented: "Not Instrumented",
};

function healthState(value: HealthState | undefined, loading: boolean): string {
  if (loading && !value) return "Checking";
  return value ? labels[value] : "Unknown";
}

export function SystemHealth({ health, loading = false, unavailable = false }: { health: HealthResult | null; loading?: boolean; unavailable?: boolean }) {
  const components = health?.components;
  const states = [
    ["API", unavailable ? "Unavailable" : healthState(components?.api ?? (health?.ok ? "operational" : undefined), loading)],
    ["RPC", healthState(components?.rpc, loading)],
    ["Contracts", healthState(components?.contracts, loading)],
    ["Executor", healthState(components?.executor, loading)],
  ];
  return <section aria-label="System Health"><div className="border-b border-line pb-4"><h2 className="text-[15px] font-semibold text-paper">System Health</h2><p className="mt-1 text-[11px] text-muted">Backend reported status</p></div><dl>{states.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 border-b border-line-soft py-4 text-xs"><dt className="text-muted">{label}</dt><dd className={value === "Operational" ? "text-long" : value === "Unavailable" || value === "Degraded" ? "text-warn" : "text-paper"}>{value}</dd></div>)}</dl></section>;
}
