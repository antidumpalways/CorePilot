import type { DataSource, MarketView } from "../lib/api";
import { formatBps, formatFunding, formatUsd } from "../lib/format";
import { DataSourceBadge } from "./DataSourceBadge";

interface Props {
  market: string;
  snapshot?: MarketView | null;
  source: DataSource;
  thresholdBps: number;
  side: "long" | "short";
  notionalUsd: number;
  leverageX: number;
  slippageBps: number;
  bond: number;
}

export function CreateLivePreview({ market, snapshot, source, thresholdBps, side,
  notionalUsd, leverageX, slippageBps, bond }: Props) {
  const observed = snapshot?.fundingRateBps;
  const contextualMatch = observed !== undefined && Number.isFinite(observed) && observed < thresholdBps;
  const stale = !snapshot || !Number.isFinite(snapshot.timestamp) || Date.now() - snapshot.timestamp > 5 * 60_000 || snapshot.timestamp > Date.now() + 60_000;
  return <aside className="composer-preview relative p-6 sm:p-7">
    <div className="relative flex items-center justify-between gap-3"><div className="cp-kicker text-[#aac0ff]">Strategy preview</div><DataSourceBadge source={source} /></div>
    <div className="relative mt-8 flex items-start justify-between gap-4"><div><div className="preview-market text-[42px] font-extrabold leading-none text-paper">{market}</div><div className="mt-2 text-xs text-muted">Market snapshot · {source}</div></div><div className="text-right"><div className="cp-label">Mark price</div><div className="preview-value mt-2 text-xl font-bold text-paper">{snapshot ? formatUsd(snapshot.markPrice) : "—"}</div></div></div>
    <div className="relative mt-7 rounded-[15px] border border-[#89a4ec]/15 bg-[#090e1b]/55 p-4 shadow-[0_1px_0_rgba(255,255,255,.05)_inset]"><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted">Observed funding / hour</span><span className="font-semibold tabular-nums text-paper">{formatFunding(observed)}</span></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-line/40 pt-4"><span className="text-xs text-muted">Condition context</span><span className={`text-xs font-bold ${observed === undefined || stale ? "text-muted" : contextualMatch ? "text-[#9eb7ff]" : "composer-status-waiting"}`}>{observed === undefined ? "NO SNAPSHOT" : stale ? "STALE SNAPSHOT" : contextualMatch ? source === "SIMULATED" || source === "DEMO" ? "MATCHED · SIMULATED" : "CONDITION MET" : "WAITING"}</span></div>{observed !== undefined && !stale && !contextualMatch && <div className="mt-2 text-right font-mono text-[11px] text-muted">{(observed - thresholdBps).toFixed(2)} bps above trigger</div>}</div>
    <div className="relative mt-8 space-y-2"><div className="composer-logic-line"><span className="composer-logic-node">01</span><div><div className="cp-label text-[#9db7ff]">When</div><div className="mt-0.5 text-sm font-semibold text-paper">Funding &lt; {thresholdBps.toFixed(2)} bps</div></div></div><div className="composer-logic-line"><span className="composer-logic-node">02</span><div><div className="cp-label text-[#9db7ff]">Then</div><div className="mt-0.5 text-sm font-semibold text-paper">Open {market} {side.toUpperCase()}</div></div></div><div className="composer-logic-line"><span className="composer-logic-node">03</span><div><div className="cp-label text-[#9db7ff]">Within</div><div className="mt-0.5 text-sm font-semibold text-paper">{formatUsd(notionalUsd)} · {leverageX.toFixed(2)}× · {formatBps(slippageBps)}</div></div></div></div>
    <div className="relative mt-8 flex justify-between border-t border-line/50 pt-4 text-xs"><span className="text-muted">Creator bond</span><span className="font-semibold text-paper">{bond.toLocaleString()} PILOT</span></div>
    <p className="relative mt-4 text-[11px] leading-5 text-muted">Preview only. Context does not prove an execution. Rule becomes authoritative after creator signature and API verification.</p>
  </aside>;
}
