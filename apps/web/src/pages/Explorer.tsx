import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { EmptyState, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { fetchStrategies, type StrategyView } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { formatNumber, shortenAddress } from "../lib/format";

function ruleLabel(strategy: StrategyView, demo: boolean) {
  if (strategy.strategyType !== "FUNDING_TRIGGER") return "Signal not indexed";
  return demo ? "Funding < −1.00 bps · illustrative" : "Funding policy · view details";
}

function StrategyCard({ strategy, demo }: { strategy: StrategyView; demo: boolean }) {
  return <Link to={`/strategies/${strategy.id}`} className="strategy-list-card group" aria-label={`Open ${strategy.name}`}>
    <div className="flex min-w-0 items-center gap-4"><div className="strategy-market-icon" aria-hidden>{strategy.market.slice(0, 1)}</div><div className="min-w-0"><div className="truncate text-[16px] font-bold tracking-[-.035em] text-paper transition-colors group-hover:text-[#b4c7ff]">{strategy.name}</div><div className="mt-1 truncate text-xs text-muted">{strategy.description || "Funding-based strategy with bounded execution"}</div><div className="mt-2 text-[11px] text-muted">Created by {shortenAddress(strategy.creator)}</div></div></div>
    <div><div className="cp-label">Strategy logic</div><div className="mt-2 text-[13px] font-semibold text-paper">{ruleLabel(strategy, demo)}</div><div className="mt-1 text-[11px] text-muted">{strategy.market} · Open position</div></div>
    <div><div className="cp-label">Creator backing</div><div className="mt-2 text-[13px] font-semibold text-paper">{strategy.pilotBacking === null ? "Unverified" : `${formatNumber(strategy.pilotBacking, 0)} PILOT`}</div><div className="mt-1 text-[11px] text-muted">{strategy.executions === null ? "Execution count unavailable" : `${formatNumber(strategy.executions, 0)} indexed attempts`}</div></div>
    <div className="flex items-center justify-between gap-3 sm:justify-end"><StatusBadge active={strategy.active} /><span aria-hidden className="text-xl text-accent transition-transform duration-200 group-hover:translate-x-1">↗</span></div>
  </Link>;
}

export function Explorer() {
  const { result, loading, reload } = useApiResource<StrategyView[]>(fetchStrategies, []);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const strategies = result?.data ?? [];
  const markets = ["ALL", ...new Set(strategies.map(item => item.market))];
  const types = ["ALL", ...new Set(strategies.map(item => item.strategyType))];
  const filtered = useMemo(() => strategies.filter(strategy => {
    const searchable = `${strategy.name} ${strategy.market} ${strategy.creator} ${strategy.id}`.toLowerCase();
    return searchable.includes(query.toLowerCase()) &&
      (market === "ALL" || strategy.market === market) &&
      (type === "ALL" || strategy.strategyType === type) &&
      (status === "ALL" || (status === "ACTIVE" ? strategy.active === true :
        status === "PAUSED" ? strategy.active === false : strategy.active === null));
  }), [strategies, query, market, status, type]);

  return <div className="space-y-8">
    <section className="explorer-hero flex flex-wrap items-end justify-between gap-8"><div className="relative z-10"><div className="cp-kicker text-[#9eb8ff]">Discover / CorePilot strategies</div><h1 className="mt-4 max-w-[680px] text-[clamp(34px,3.5vw,52px)] font-extrabold leading-[1.08] tracking-[-.06em] text-paper">Find your next <span className="text-[#9bb4ff]">execution edge.</span></h1><p className="mt-4 max-w-[580px] text-sm leading-6 text-muted">Explore bounded strategy logic, then choose your own limits before authorization.</p><div className="mt-6 flex flex-wrap gap-2 text-[11px]"><span className="rounded-lg border border-accent/25 bg-accent/10 px-3 py-1.5 text-[#acc1ff]">Funding Rate V1</span><span className="rounded-lg border border-line/60 bg-ink-900/50 px-3 py-1.5 text-muted">Venue fill unverified</span></div></div><Link to="/create" className="cp-btn-primary relative z-10">Create Strategy <span aria-hidden>↗</span></Link></section>
    <section id="strategy-list" aria-label="Strategy discovery" className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="cp-kicker text-accent">Marketplace</div><h2 className="mt-2 text-[25px] font-bold tracking-[-.05em] text-paper">Explore strategies <span className="ml-2 text-base font-medium text-muted">{filtered.length}</span></h2></div><div className="flex items-center gap-2"><DataSourceBadge source={result?.source ?? "UNKNOWN"} /><button className="cp-btn-ghost text-xs" type="button" onClick={reload} disabled={loading}>{loading && <Spinner className="h-3 w-3" />}Refresh</button></div></div>
      {result?.error && <p role="status" className="rounded-lg border border-warn/25 bg-warn/5 px-4 py-3 text-xs text-warn">API unavailable. Showing labelled demo strategies, not a live registry.</p>}
      <div className="grid gap-2 rounded-[16px] border border-line/50 bg-ink-800/70 p-3 shadow-panel sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_170px_170px]"><label className="sr-only" htmlFor="strategy-search">Search strategies</label><input id="strategy-search" className="cp-input sm:col-span-2 lg:col-span-1" placeholder="Search strategies or markets" value={query} onChange={event => setQuery(event.target.value)} /><select className="cp-input" aria-label="Filter by market" value={market} onChange={event => setMarket(event.target.value)}>{markets.map(item => <option key={item} value={item}>{item === "ALL" ? "All markets" : item}</option>)}</select><select className="cp-input" aria-label="Filter by strategy type" value={type} onChange={event => setType(event.target.value)}>{types.map(item => <option key={item} value={item}>{item === "ALL" ? "All signals" : item.replaceAll("_", " ")}</option>)}</select><select className="cp-input" aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="PAUSED">Inactive</option><option value="UNKNOWN">Unknown</option></select></div>
      {loading && !result ? <div className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner />Loading strategies…</div> : filtered.length === 0 ? <EmptyState title="No strategies found" message="Try another filter or check the registry connection." /> : <div className="explorer-list">{filtered.map(strategy => <StrategyCard key={strategy.id} strategy={strategy} demo={result?.source === "DEMO"} />)}</div>}
      <p className="text-[11px] text-muted">Unverified bond, policy, and execution data is never inferred. No performance returns are implied.</p>
    </section>
  </div>;
}
