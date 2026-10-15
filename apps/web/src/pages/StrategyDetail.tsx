import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { StrategyConfig } from "@corepilot/shared";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { EmptyState, Spinner } from "../components/Feedback";
import { ExecutionStatusBadge, StatusBadge } from "../components/StatusBadge";
import { AuthorizationPanel } from "../components/AuthorizationPanel";
import { fetchExecutions, fetchMarketData, fetchStrategy, fetchVerifiedPolicy, type DataSource, type ExecutionView, type StrategyView, type VerifiedPolicy } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import { formatBps, formatFunding, formatNumber, formatTimestamp, formatUsd, shortenAddress, shortenHash } from "../lib/format";
import { marketCondition } from "../lib/strategyUx";

interface OnchainState { config: StrategyConfig | null; creatorBond: bigint | null; executable: boolean | null; error: string | null }
const emptyChain: OnchainState = { config: null, creatorBond: null, executable: null, error: null };
function bondLabel(bond: bigint | null) { return bond === null ? "—" : `${formatNumber(Number(bond) / 1e18, 2)} PILOT`; }

function DetailView({ strategy, source }: { strategy: StrategyView; source: DataSource }) {
  const marketResource = useApiResource(() => fetchMarketData(strategy.market), [strategy.market]);
  const executionsResource = useApiResource<ExecutionView[]>(() => fetchExecutions(strategy.id), [strategy.id]);
  const [onchain, setOnchain] = useState<OnchainState>(emptyChain);
  const [verifiedPolicy, setVerifiedPolicy] = useState<VerifiedPolicy | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasContractConfig || strategy.chainStrategyId === null || source === "DEMO") {
      setOnchain({ ...emptyChain, error: strategy.chainStrategyId === null || source === "DEMO" ? "No verified on-chain strategy ID" : "SDK unconfigured" });
      return;
    }
    const client = getCorePilotClient();
    Promise.all([client.read.getStrategy(strategy.chainStrategyId), client.read.getCreatorBond(strategy.chainStrategyId), client.read.isExecutable(strategy.chainStrategyId)])
      .then(([config, creatorBond, executable]) => { if (!cancelled) setOnchain({ config, creatorBond, executable, error: null }); })
      .catch(error => { if (!cancelled) setOnchain({ ...emptyChain, error: error instanceof Error ? error.message : "On-chain read failed" }); });
    return () => { cancelled = true; };
  }, [strategy.chainStrategyId, source]);

  useEffect(() => {
    let cancelled = false;
    setVerifiedPolicy(null);
    if (strategy.chainStrategyId === null || source === "DEMO") return;
    fetchVerifiedPolicy(strategy.chainStrategyId).then(result => {
      if (!cancelled) setVerifiedPolicy(result);
    }).catch(() => { if (!cancelled) setVerifiedPolicy(null); });
    return () => { cancelled = true; };
  }, [strategy.chainStrategyId, source]);

  const market = marketResource.result?.data;
  const executions = executionsResource.result?.data ?? [];
  const config = onchain.config;
  const maxNotional = config?.maxNotionalUsd ?? strategy.maxNotionalUsd ?? null;
  const leverageBps = config?.maxLeverageBps ?? strategy.maxLeverageBps ?? null;
  const slippageBps = config?.maxSlippageBps ?? strategy.maxSlippageBps ?? null;
  const expiry = config?.expiry ?? strategy.expiry ?? null;
  const allowedMarket = config?.market ?? strategy.market;
  const active = config?.active ?? strategy.active;
  const sample = source === "DEMO";
  const condition = marketCondition(sample ? null : verifiedPolicy?.policy ?? null, market, marketResource.result?.source ?? "UNKNOWN");

  return <div className="strategy-detail space-y-7"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6"><div><Link to="/strategies" className="text-xs text-muted hover:text-paper">← Explore</Link><div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="cp-page-title">{strategy.name}</h1><StatusBadge active={active} /></div><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted"><span className="font-mono">#{strategy.id} · {allowedMarket}</span><span>·</span><span>by <span className="font-mono text-paper">{shortenAddress(strategy.creator)}</span></span><DataSourceBadge source={source} /></div></div><div className="flex gap-2"><Link to={`/activity?strategy=${strategy.id}`} className="cp-btn-ghost text-xs">Strategy activity ↗</Link><Link to={`/monitor/${strategy.id}`} className="cp-btn-ghost text-xs">Technical monitor ↗</Link></div></div>
    <div className="strategy-detail-layout grid gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.85fr)]"><div className="min-w-0 space-y-8">
      <section className="overflow-hidden rounded-xl border border-line bg-ink-800"><div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="text-base font-semibold text-paper">Strategy rule</h2><span className="font-mono text-[10px] text-muted">{sample ? "ILLUSTRATIVE" : verifiedPolicy ? `SIGNED V${verifiedPolicy.policy.version}` : "POLICY UNVERIFIED"}</span></div><div className="grid gap-px bg-line sm:grid-cols-2"><div className="bg-ink-800 p-5 sm:p-7"><div className="cp-kicker text-accent">WHEN / signal</div><div className="mt-5 text-sm text-muted">{strategy.strategyType === "FUNDING_TRIGGER" ? `${allowedMarket} Funding Rate` : "Signal not indexed"}</div><div className="mt-2 font-mono text-[28px] font-semibold tracking-[-.04em] text-paper">{sample ? "< −1.00 bps" : verifiedPolicy ? `< ${verifiedPolicy.policy.signal.thresholdBps.toFixed(2)} bps` : "Threshold —"}</div><p className="mt-3 text-xs text-muted">{sample ? "Sample rule, not a verified policy" : verifiedPolicy ? `Creator signed · ${shortenHash(verifiedPolicy.hash)}` : "No verified policy available"}</p></div><div className="bg-ink-800 p-5 sm:p-7"><div className="cp-kicker text-accent">THEN / action</div><div className="mt-5 text-sm text-muted">Permitted action</div><div className="mt-2 text-[28px] font-semibold tracking-[-.04em] text-paper">{sample ? "Open LONG" : verifiedPolicy ? `Open ${verifiedPolicy.policy.action.side.toUpperCase()}` : "Not indexed"}</div><p className="mt-3 text-xs text-muted">{sample ? "Illustrative action only" : verifiedPolicy ? "Signed action · no venue fill implied" : "No verified side or intent"}</p></div></div></section>
      <section className="border-t border-line pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-paper">Market condition</h2><p className="mt-1 text-xs text-muted">Snapshot comparison only · condition met does not prove an execution.</p></div><DataSourceBadge source={marketResource.result?.source ?? "UNKNOWN"} /></div><div className="mt-5 grid grid-cols-2 gap-4 border-y border-line py-5 sm:grid-cols-4">{[["Trigger", verifiedPolicy ? `Funding < ${verifiedPolicy.policy.signal.thresholdBps.toFixed(2)} bps` : "Unverified"], ["Current / hour", formatFunding(market?.fundingRateBps)], ["Condition", condition.label], ["Distance", condition.distance]].map(([label,value]) => <div key={label}><div className="cp-label">{label}</div><div className="mt-2 break-words font-mono text-sm tabular-nums text-paper">{value}</div></div>)}</div><p className="mt-3 text-xs text-muted">{marketResource.result?.error ? "Market API unavailable; displayed snapshot is simulated." : `Source: ${market?.source ?? "unknown"} · updated ${formatTimestamp(market?.timestamp)}`}</p></section>
      <section className="border-t border-line pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-paper">Execution history</h2><p className="mt-1 text-xs text-muted">Adapter requests and reported rejections. Venue fill not confirmed.</p></div><DataSourceBadge source={executionsResource.result?.source ?? "UNKNOWN"} /></div>{executionsResource.loading && !executionsResource.result ? <p className="mt-4 text-xs text-muted">Loading execution activity…</p> : executions.length === 0 ? <div className="mt-4"><EmptyState title="No attempts indexed" message="No execution receipt is available for this strategy." /></div> : <div className="mt-4 overflow-x-auto border-t border-line"><table className="cp-table min-w-[650px]"><thead><tr><th>Time</th><th>Result</th><th className="text-right">Notional</th><th>Receipt / reason</th></tr></thead><tbody>{executions.map(execution => <tr key={execution.id}><td className="font-mono text-xs">{execution.createdAt ? formatTimestamp(Date.parse(execution.createdAt)) : "—"}</td><td><ExecutionStatusBadge status={execution.status} /></td><td className="text-right font-mono">{formatUsd(execution.requestedNotional)}</td><td className="font-mono text-xs"><Link className="hover:text-accent" to={`/activity?strategy=${strategy.id}&execution=${execution.id}`}>{execution.error ?? (execution.txHash ? shortenHash(execution.txHash) : `Receipt #${execution.id}`)} ↗</Link></td></tr>)}</tbody></table></div>}</section>
    </div><aside className="min-w-0 space-y-6"><AuthorizationPanel chainStrategyId={strategy.chainStrategyId} executable={onchain.executable} maxNotionalUsd={maxNotional} maxLeverageBps={leverageBps} maxSlippageBps={slippageBps} />
      <section className="rounded-xl border border-line bg-ink-800 p-5 sm:p-6"><h2 className="text-base font-semibold text-paper">Strategy constraints</h2><p className="mt-1 text-xs text-muted">Creator-level hard boundaries</p><dl className="mt-4">{[["Maximum notional", formatUsd(maxNotional)], ["Maximum leverage", leverageBps === null ? "—" : `${(leverageBps/100).toFixed(2)}×`], ["Maximum slippage", formatBps(slippageBps)], ["Allowed market", allowedMarket], ["Expiry", expiry && expiry > 0 ? formatTimestamp(expiry*1000) : "—"], ["Creator bond", bondLabel(onchain.creatorBond)]].map(([label,value]) => <div key={label} className="flex justify-between gap-4 border-b border-line-soft py-3 text-xs"><dt className="text-muted">{label}</dt><dd className="text-right font-mono text-paper">{value}</dd></div>)}</dl><div className="mt-4 text-[11px] text-muted">On-chain eligibility: {onchain.executable === null ? "unverified" : onchain.executable ? "eligible for controller bounds" : "not eligible"}. Funding policy is checked separately and is not verified here.</div>{onchain.error && <div className="mt-1 break-words text-[11px] text-muted">{onchain.error}</div>}</section></aside></div>
  </div>;
}

export function StrategyDetail() {
  const { id } = useParams();
  const strategyId = Number(id);
  const { result, loading, reload } = useApiResource<StrategyView | null>(() => fetchStrategy(strategyId), [strategyId]);
  if (loading && !result) return <div className="flex items-center gap-2 py-16 text-sm text-muted"><Spinner />Loading strategy…</div>;
  if (!result?.data) return <EmptyState title="Strategy not found" message={`No strategy with ID #${id}.`} action={<button type="button" className="cp-btn-ghost mt-2" onClick={reload}>Retry</button>} />;
  return <DetailView strategy={result.data} source={result.source} />;
}
