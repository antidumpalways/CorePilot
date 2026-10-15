import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { EmptyState, Spinner } from "../components/Feedback";
import { ExecutionStatusBadge } from "../components/StatusBadge";
import { fetchAuthorizationEvents, fetchAuthorizations, fetchExecutions, fetchStrategies, fetchStrategy, type ApiResult, type AuthorizationEventView, type AuthorizationView, type DataSource, type ExecutionView, type StrategyView } from "../lib/api";
import { formatTimestamp, formatUsd, shortenAddress, shortenHash } from "../lib/format";
import { useApiResource } from "../lib/useApi";

interface ActivityRow { execution: ExecutionView; strategy: StrategyView; source: DataSource }

async function loadActivity(focusId: number): Promise<ApiResult<ActivityRow[]>> {
  const registry = await fetchStrategies();
  const initial = registry.data.slice(0, 20);
  const focused = focusId > 0 && !initial.some(item => item.id === focusId) ? await fetchStrategy(focusId) : null;
  const strategies = focused?.data && focused.source !== "DEMO" ? [...initial, focused.data] : initial;
  const attempts = await Promise.all(strategies.map(async strategy => ({ strategy, result: await fetchExecutions(strategy.id) })));
  const rows = attempts.flatMap(({strategy,result}) => result.data.map(execution => ({execution,strategy,source: result.source}))).sort((a,b) => Date.parse(b.execution.createdAt ?? "") - Date.parse(a.execution.createdAt ?? ""));
  return { data: rows, source: registry.source, db: registry.db, error: registry.error };
}

function Receipt({ row, onClose }: { row: ActivityRow; onClose: () => void }) {
  const { execution, strategy, source } = row;
  const requested = execution.status.toUpperCase() === "ADAPTER_REQUESTED";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-[6px] sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="receipt-title" className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[22px] border border-accent/25 bg-ink-800 shadow-[0_30px_80px_rgba(0,0,0,.72),0_0_60px_-35px_#688bff]"><div className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-7"><div><div className="cp-kicker">Execution record / #{execution.id}</div><h2 id="receipt-title" className="mt-2 text-xl font-semibold text-paper">{requested ? "Adapter request recorded" : execution.status.toUpperCase() === "REJECTED" ? "Rejection reported" : "Legacy or unverified result"}</h2><div className="mt-3 flex gap-2"><ExecutionStatusBadge status={execution.status} /><DataSourceBadge source={source} /></div></div><button type="button" className="cp-btn-ghost" onClick={onClose} aria-label="Close receipt">×</button></div><div className="px-5 pt-5 sm:px-7"><div className="cp-kicker text-accent">CorePilot / indexed evidence</div><dl className="py-2">{[["Strategy", strategy.name], ["Market", strategy.market], ["Status", execution.status === "EXECUTED" ? "Legacy label · not fill proof" : execution.status], ["Requested notional", formatUsd(execution.requestedNotional)], ["Recorded", execution.createdAt ? formatTimestamp(Date.parse(execution.createdAt)) : "—"], ["CorePilot transaction", execution.txHash ? shortenHash(execution.txHash) : "Unverified"], ["Adapter request ID", execution.externalExecutionId ?? "None"], ["Policy / authorization", "Not indexed in this record"], ["Signal / intent / executor", "Not indexed in this record"], ["Constraint / rejection", execution.error ?? "Not indexed"]].map(([label,value]) => <div key={label} className="flex justify-between gap-6 border-b border-line-soft py-2.5 text-xs"><dt className="text-muted">{label}</dt><dd className="max-w-[60%] break-all text-right font-mono text-paper">{value}</dd></div>)}</dl><div className="cp-kicker mt-3 text-warn">Hyperliquid venue / unverified</div><dl className="py-2">{[["Order ID", "No verified venue receipt"], ["Order state / fill", "Unknown"], ["Filled size / average fill", "Unknown"], ["Last reconciled", "Not available"]].map(([label,value]) => <div key={label} className="flex justify-between gap-6 border-b border-line-soft py-2.5 text-xs"><dt className="text-muted">{label}</dt><dd className="text-right font-mono text-paper">{value}</dd></div>)}</dl></div><p className="px-5 pb-6 text-xs leading-5 text-muted sm:px-7">{source === "DEMO" ? "SIMULATED RECORD. " : ""}{requested ? "Adapter requested does not mean order submitted or filled." : "This result is not independently verified as a venue fill."} No trading outcome is proven by this record.</p></section></div>;
}

export function Activity() {
  const { address } = useAccount();
  const [params, setParams] = useSearchParams();
  const focusId = Number(params.get("strategy"));
  const { result, loading, reload } = useApiResource<ActivityRow[]>(() => loadActivity(focusId), [focusId]);
  const focusedStrategy = useApiResource<StrategyView | null>(() => focusId > 0 ? fetchStrategy(focusId) : Promise.resolve({ data: null, source: "UNKNOWN" as const, db: false }), [focusId]);
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [authorizations, setAuthorizations] = useState<AuthorizationView[]>([]);
  const [authorizationEvents, setAuthorizationEvents] = useState<AuthorizationEventView[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | "Execution" | "Authorization" | "Venue">("All");
  useEffect(() => {
    let cancelled = false;
    setAuthorizations([]); setAuthorizationEvents([]); setAuthError(null);
    if (!address) return;
    fetchAuthorizations(address).then(value => { if (!cancelled) setAuthorizations(value.data); }).catch(error => { if (!cancelled) setAuthError(error instanceof Error ? error.message : "Authorization activity unavailable"); });
    fetchAuthorizationEvents(address).then(value => { if (!cancelled) setAuthorizationEvents(value.data); }).catch(error => { if (!cancelled) setAuthError(error instanceof Error ? error.message : "Authorization events unavailable"); });
    return () => { cancelled = true; };
  }, [address]);
  useEffect(() => {
    const execution = Number(params.get("execution"));
    const strategy = Number(params.get("strategy"));
    const found = execution > 0 && strategy > 0 ? result?.data.find(row => row.execution.id === execution && row.strategy.id === strategy) : null;
    if (found) setSelected(found);
  }, [result, params]);
  useEffect(() => {
    if (!selected) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); const next = new URLSearchParams(params); next.delete("execution"); setParams(next); } };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [selected, params, setParams]);
  const strategyFilter = Number(params.get("strategy"));
  const rows = (result?.data ?? []).filter(row => !strategyFilter || row.strategy.id === strategyFilter);
  const signedRows = authorizations.filter(row => !strategyFilter || focusedStrategy.result?.data?.chainStrategyId === row.authorization.strategyId);
  const eventRows = authorizationEvents.filter(row => !strategyFilter || focusedStrategy.result?.data?.chainStrategyId === row.strategyId);
  const showExecutions = filter === "All" || filter === "Execution";
  const showAuthorizations = filter === "All" || filter === "Authorization";
  return <div className="activity-page mx-auto max-w-[1140px] space-y-7"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-7"><div><div className="cp-kicker text-accent">Records / activity</div><h1 className="cp-page-title mt-2">Activity</h1><p className="cp-page-subtitle">Indexed execution attempts across available strategies. This is not a personal trading ledger.</p></div><div className="flex items-center gap-2"><DataSourceBadge source={result?.source ?? "UNKNOWN"} /><button type="button" className="cp-btn-ghost" onClick={reload} disabled={loading}>Refresh</button></div></div>
    {result?.error && <p role="status" className="border-l-2 border-warn pl-3 text-xs text-warn">API unavailable · showing labelled demo activity.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-paper">Indexed activity</h2><span className="text-xs text-muted">Adapter request ≠ Hyperliquid fill</span></div>
    <div className="flex flex-wrap gap-2">{(["All", "Execution", "Authorization", "Venue"] as const).map(item => <button key={item} className="cp-btn-ghost" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}{strategyFilter > 0 && <button className="cp-btn-ghost" onClick={() => { const next = new URLSearchParams(params); next.delete("strategy"); next.delete("execution"); setParams(next); }}>Clear strategy filter</button>}</div>
    {loading && !result ? <div className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner />Loading activity…</div> : <div className="activity-feed space-y-2">{showExecutions && rows.map(row => <button key={`${row.strategy.id}-${row.execution.id}`} type="button" onClick={() => { setSelected(row); setParams({ strategy: String(row.strategy.id), execution: String(row.execution.id) }); }} className="activity-row grid w-full gap-3 rounded-[15px] border border-line/50 bg-ink-800 px-5 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center"><time className="font-mono text-[11px] text-muted">{row.execution.createdAt ? formatTimestamp(Date.parse(row.execution.createdAt)) : "Time unknown"}</time><div className="min-w-0"><div className="font-medium text-paper">{row.strategy.name} <span className="font-mono text-xs font-normal text-muted">#{row.strategy.id}</span></div><div className="mt-1 text-xs text-muted">{row.strategy.market} · {formatUsd(row.execution.requestedNotional)} · {row.execution.error ?? (row.execution.externalExecutionId ? `Adapter request ${shortenAddress(row.execution.externalExecutionId)}` : "No venue fill verified")}</div></div><div className="flex items-center gap-2"><DataSourceBadge source={row.source} /><ExecutionStatusBadge status={row.execution.status} /><span className="text-muted">↗</span></div></button>)}{showAuthorizations && signedRows.map(row => <div key={row.authorization.authorizationId} className="activity-row grid gap-3 rounded-[15px] border border-line/50 bg-ink-800 px-5 py-4 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center"><time className="font-mono text-[11px] text-muted">{formatTimestamp(row.authorization.validFromMs)}</time><div><div className="font-medium text-paper">Strategy #{row.authorization.strategyId} · {row.status === "UNVERIFIED" ? "authorization record unverified" : "authorization signed"}</div><div className="mt-1 text-xs text-muted">${row.authorization.maxNotionalUsd.toLocaleString()} · {(row.authorization.maxLeverageBps/100).toFixed(2)}× · {row.authorization.maxSlippageBps}bps · current state {row.status}</div></div><div className="text-xs text-muted">COREPILOT · TESTNET</div></div>)}</div>}
    {showAuthorizations && eventRows.length > 0 && <div className="space-y-2">{eventRows.map(event => <div key={event.id} className="activity-row grid gap-3 rounded-[15px] border border-line/50 bg-ink-800 px-5 py-4 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center"><time className="font-mono text-[11px] text-muted">{formatTimestamp(Date.parse(event.timestamp))}</time><div><div className="font-medium text-paper">Strategy #{event.strategyId} · authorization {event.action.toLowerCase()}d</div><div className="mt-1 text-xs text-muted">Signed state change · authorization {event.authorizationId.slice(0, 8)}… · version {event.version}</div></div><div className="text-xs text-muted">COREPILOT · TESTNET</div></div>)}</div>}
    {filter === "Venue" && <EmptyState title="No verified venue receipts" message="No Hyperliquid order or fill proof is indexed. Adapter requests are shown under Execution, not Venue." />}
    {filter !== "Venue" && !loading && (!showExecutions || rows.length === 0) && (!showAuthorizations || signedRows.length + eventRows.length === 0) && <EmptyState title="No CorePilot activity yet" message="Signed authorizations and indexed execution attempts appear here when available. Trigger evaluations are not yet indexed." action={<Link to="/strategies" className="cp-btn-primary mt-2">Explore Strategies</Link>} />}
    {authError && address && <p className="text-xs text-warn">Authorization history unavailable: {authError}</p>}
    <p className="text-[11px] text-muted">Authorization start time comes from the signed payload; pause, resume, and revoke event times come from CorePilot API records. Historical “EXECUTED” labels are not venue fill proof.</p>
    {selected && <Receipt row={selected} onClose={() => { setSelected(null); const next = new URLSearchParams(params); next.delete("execution"); setParams(next); }} />}
  </div>;
}
