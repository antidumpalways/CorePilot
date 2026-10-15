import { Link } from "react-router-dom";
import { EmptyState, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { SystemHealth } from "../components/SystemHealth";
import { fetchHealth, fetchStrategies, type HealthResult, type StrategyView } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { formatNumber } from "../lib/format";

const metricLabels = ["Active strategies", "24h executions", "Executor", "PILOT bonded"] as const;

export function Overview() {
  const strategies = useApiResource<StrategyView[]>(fetchStrategies, []);
  const health = useApiResource<HealthResult | null>(fetchHealth, []);
  const rows = strategies.result?.data ?? [];
  const source = strategies.result?.source;
  const active = rows.filter((row) => row.active).length;
  const activeKnown = rows.every(row => row.active !== null);
  const metrics = [
    { value: strategies.loading && !strategies.result ? "…" : activeKnown ? formatNumber(active, 0) : "—", note: source === "DEMO" ? "Demo registry" : activeKnown ? "Strategy registry" : "Activity not indexed" },
    { value: "—", note: "24h aggregate not exposed by API" },
    { value: health.result?.data?.components?.executor ? health.result.data.components.executor.replaceAll("_", " ") : "Unknown", note: "Backend reported" },
    { value: "—", note: "Bond totals not indexed" },
  ];

  return <div className="space-y-10">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><div className="cp-kicker">Operations / overview</div><h1 className="cp-page-title mt-2">CorePilot</h1><p className="cp-page-subtitle">Programmable strategy execution for Elysium + HyperCore.</p></div>
      <Link to="/monitor" className="inline-flex min-h-9 items-center gap-2 border-b border-accent/60 text-sm font-medium text-paper transition-colors hover:text-accent">Open Monitor <span aria-hidden>→</span></Link>
    </div>

    {source === "DEMO" && <div role="status" className="border-l-2 border-warn pl-3 text-xs text-warn">Showing DEMO DATA because the strategy registry is unavailable.</div>}

    <div className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
      {metrics.map((metric, index) => <div key={metricLabels[index]} className="min-w-0 border-b border-line-soft px-3 py-5 first:pl-0 odd:pl-0 lg:border-b-0 lg:border-r lg:px-6 lg:last:border-r-0">
        <div className="cp-label">{metricLabels[index]}</div>
        <div className="mt-3 font-mono text-[clamp(18px,2vw,25px)] font-semibold tabular-nums tracking-tight text-paper">{metric.value}</div>
        <div className="mt-1 text-[11px] text-muted">{metric.note}</div>
      </div>)}
    </div>

    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.75fr)_minmax(260px,.85fr)]">
      <section className="min-w-0">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4"><h2 className="text-[15px] font-semibold text-paper">Recent Strategies</h2><Link to="/strategies" className="text-xs text-muted hover:text-accent">View registry →</Link></div>
        {strategies.loading && !strategies.result ? <div className="flex gap-2 py-8 text-sm text-muted"><Spinner />Loading strategies…</div> : rows.length ? <div>{rows.slice(0, 5).map((row) => <Link key={row.id} to={`/strategies/${row.id}`} className="group flex items-center justify-between gap-4 border-b border-line-soft py-5 transition-colors hover:bg-ink-800/30">
          <div className="min-w-0"><div className="truncate text-sm font-semibold text-paper group-hover:text-accent">{row.name}</div><div className="mt-1 font-mono text-[11px] text-muted">#{row.id} · {row.market} · {row.strategyType}</div></div><StatusBadge active={row.active} />
        </Link>)}</div> : <EmptyState title="No strategies" message="The registry is empty." />}
      </section>
      <div className="min-w-0 xl:border-l xl:border-line-soft xl:pl-8"><SystemHealth health={health.result?.data ?? null} loading={health.loading && !health.result} unavailable={Boolean(health.result?.error)} /></div>
    </div>
  </div>;
}
