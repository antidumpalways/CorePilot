import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { authorizationChangeMessage } from "@corepilot/shared";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { WalletButton } from "../components/WalletButton";
import { TradingAccessPanel } from "../components/TradingAccessPanel";
import { changeAuthorizationState, fetchAuthorizations, fetchMarketData, fetchStrategies,
  type AuthorizationView, type StrategyView } from "../lib/api";
import { shortenAddress } from "../lib/format";
import { actionError, expiryLabel, marketCondition, previewEffectiveLimits } from "../lib/strategyUx";
import { useApiResource } from "../lib/useApi";
import { elysiumTestnet } from "../lib/wagmi";

function MarketContext({ row }: { row: AuthorizationView }) {
  const market = row.policy?.market ?? "";
  const resource = useApiResource(() => fetchMarketData(market), [market]);
  if (!row.policy) return <div><div className="cp-label">Market condition</div><div className="mt-2 text-muted">Policy unverified</div></div>;
  const condition = marketCondition(row.policy, resource.result?.data, resource.result?.source ?? "UNKNOWN");
  return <div><div className="cp-label">Current / condition</div><div className="mt-2 font-mono text-paper">{resource.loading && !resource.result ? "Loading market…" : `${resource.result?.data.fundingRateBps.toFixed(2) ?? "—"} bps · ${condition.label}`}</div><div className="mt-1 text-[11px] text-muted">{condition.distance} · {resource.result?.source ?? "UNKNOWN"}</div></div>;
}

export function MyStrategies() {
  const { address, isConnected, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [rows, setRows] = useState<AuthorizationView[]>([]);
  const [strategies, setStrategies] = useState<StrategyView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: AuthorizationView; action: "PAUSE" | "REVOKE" } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  async function refresh(trader: string) {
    const [authorizations, strategyResult] = await Promise.all([fetchAuthorizations(trader), fetchStrategies()]);
    setRows(authorizations.data);
    setStrategies(strategyResult.source === "DEMO" ? [] : strategyResult.data);
  }

  useEffect(() => {
    let cancelled = false;
    setRows([]); setStrategies([]); setError(null);
    if (!address) return;
    setLoading(true);
    Promise.all([fetchAuthorizations(address), fetchStrategies()]).then(([authorizations, strategyResult]) => {
      if (cancelled) return;
      setRows(authorizations.data);
      setStrategies(strategyResult.source === "DEMO" ? [] : strategyResult.data);
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Authorizations unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  async function change(row: AuthorizationView, action: "PAUSE" | "RESUME" | "REVOKE") {
    if (!wallet || !address || busyId || chainId !== elysiumTestnet.id) return;
    setBusyId(row.authorization.authorizationId); setError(null);
    try {
      const version = row.authorization.version + 1;
      const signature = await wallet.signMessage({ account: address,
        message: authorizationChangeMessage(row.authorization, version, action) });
      await changeAuthorizationState(row.authorization.authorizationId, action, version, signature);
      await refresh(address);
    } catch (err) { setError(actionError(err)); }
    finally { setBusyId(null); }
  }

  const active = rows.filter(row => row.status === "ACTIVE" && row.authorization.validUntilMs > now).length;
  const created = address ? strategies.filter(strategy => strategy.creator.toLowerCase() === address.toLowerCase()) : [];
  return <div className="my-strategies-page mx-auto max-w-[1020px] space-y-8">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-7"><div><div className="cp-kicker text-accent">Your workspace</div><h1 className="cp-page-title mt-2">My Strategies</h1><p className="cp-page-subtitle">Strategies you created and authorizations you signed.</p></div>{isConnected && <span className="font-mono text-xs text-muted">Wallet {shortenAddress(address ?? "")}</span>}</div>
    <div className="grid grid-cols-2 border-y border-line sm:grid-cols-4">{[["Created", String(created.length)], ["Authorizations", String(rows.length)], ["Active authorizations", String(active)], ["Venue positions", "Not verified"]].map(([label, value]) => <div key={label} className="border-r border-line-soft px-3 py-4 last:border-r-0 sm:px-6"><div className="cp-label">{label}</div><div className="mt-3 font-mono text-xl tabular-nums text-paper sm:text-2xl">{value}</div></div>)}</div>
    {isConnected && !loading && <section className="space-y-3"><div className="flex items-center justify-between"><div><div className="cp-kicker text-accent">Creator workspace</div><h2 className="mt-1 text-lg font-semibold text-paper">Created by you</h2></div><button type="button" className="cp-btn-ghost text-xs" onClick={() => { if (address) void refresh(address).catch(err => setError(actionError(err))); }}>Refresh</button></div>
      {created.length === 0 ? <p className="border border-line bg-ink-800 p-5 text-xs text-muted">No creator-owned strategy is indexed yet. If you just published, refresh this view.</p> : created.map(strategy => <Link key={strategy.id} to={`/strategies/${strategy.id}`} className="flex flex-wrap items-center justify-between gap-3 border border-line bg-ink-800 p-5 transition-colors hover:border-accent/40"><div><div className="font-semibold text-paper">{strategy.name}</div><div className="mt-1 font-mono text-xs text-muted">#{strategy.chainStrategyId ?? strategy.id} · {strategy.market} · {strategy.pilotBacking === null ? "Bond unverified" : `${strategy.pilotBacking.toLocaleString()} PILOT bonded`}</div></div><span className={`font-mono text-xs ${strategy.active ? "text-long" : "text-warn"}`}>{strategy.active === null ? "UNVERIFIED" : strategy.active ? "ACTIVE" : "INACTIVE"} ↗</span></Link>)}
    </section>}
    {!isConnected ? <section className="border border-line bg-ink-800 p-6"><p className="mb-4 text-sm text-muted">Connect a wallet to view signed authorizations.</p><WalletButton /></section> : loading ? <p className="text-sm text-muted">Verifying authorizations…</p> : error && rows.length === 0 ? <section className="border border-line bg-ink-800 p-6"><h2 className="text-lg text-paper">Authorizations unavailable</h2><p className="mt-2 text-xs text-muted">CorePilot could not verify your wallet records. No status is inferred.</p><button className="cp-btn-ghost mt-4" onClick={() => { setError(null); if (address) void refresh(address).catch(err => setError(actionError(err))); }}>Retry</button></section> : rows.length === 0 ? <section className="border border-line bg-ink-800 p-6"><div className="flex items-center gap-3"><h2 className="text-lg text-paper">No trader authorizations yet</h2><DataSourceBadge source="UNKNOWN" /></div><p className="mt-2 text-xs text-muted">Created strategies appear above. To trade a strategy, sign a separate authorization with your own limits.</p><Link to="/strategies" className="cp-btn-primary mt-5 inline-flex">Explore Strategies ↗</Link></section> : <div className="space-y-3">{rows.map(row => {
      const auth = row.authorization;
      const strategy = strategies.find(item => item.chainStrategyId === auth.strategyId);
      const effective = row.policy && row.status !== "UNVERIFIED" ? previewEffectiveLimits(row.policy, auth) : null;
      const displayStatus = (row.status === "ACTIVE" || row.status === "PAUSED") && auth.validUntilMs <= now ? "EXPIRED" : row.status;
      return <section key={auth.authorizationId} className="border border-line bg-ink-800 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="cp-kicker text-accent">{row.policy?.market ?? "Strategy"} · Elysium testnet</div><h2 className="mt-2 text-lg font-semibold text-paper">{strategy?.name ?? `Strategy #${auth.strategyId}`}</h2><div className="mt-1 font-mono text-xs text-muted">#{auth.strategyId} · Authorization {auth.authorizationId.slice(0, 8)}…</div></div><span className="font-mono text-xs text-paper">{displayStatus}</span></div>
        <div className="mt-5 grid gap-3 border-y border-line py-4 text-xs sm:grid-cols-4"><div><div className="cp-label">Trigger</div><div className="mt-2 font-mono text-paper">{row.policy ? `Funding < ${row.policy.signal.thresholdBps} bps` : "Unverified"}</div></div><MarketContext row={row} /><div><div className="cp-label">Effective max</div><div className="mt-2 font-mono text-paper">{effective ? `$${effective.maxNotionalUsd.toLocaleString()} / ${(effective.maxLeverageBps / 100).toFixed(2)}× / ${effective.maxSlippageBps}bps` : "Unverified"}</div></div><div><div className="cp-label">Expiry</div><div className="mt-2 font-mono text-paper">{expiryLabel(auth.validUntilMs)}</div><div className="mt-1 text-[11px] text-muted">{new Date(auth.validUntilMs).toLocaleString()}</div></div></div>
        <div className="mt-4 flex flex-wrap gap-2">{strategy && <Link className="cp-btn-ghost" to={`/strategies/${strategy.id}`}>View</Link>}{displayStatus === "ACTIVE" && <button className="cp-btn-ghost" disabled={Boolean(busyId)} onClick={() => setConfirm({ row, action: "PAUSE" })}>Pause</button>}{displayStatus === "PAUSED" && <button className="cp-btn-ghost" disabled={Boolean(busyId)} onClick={() => void change(row, "RESUME")}>Resume</button>}{["ACTIVE", "PAUSED"].includes(displayStatus) && <button className="cp-btn-ghost" disabled={Boolean(busyId)} onClick={() => setConfirm({ row, action: "REVOKE" })}>Revoke</button>}{strategy && (["EXPIRED", "REVOKED"].includes(displayStatus) || displayStatus === "ACTIVE" && auth.validUntilMs - now < 24 * 3600_000) && <Link className="cp-btn-ghost" to={`/strategies/${strategy.id}`}>Renew</Link>}{strategy && <Link className="cp-btn-ghost" to={`/activity?strategy=${strategy.id}`}>Activity ↗</Link>}</div>
        <TradingAccessPanel row={row} />
      </section>;
    })}</div>}
    {isConnected && chainId !== elysiumTestnet.id && <button className="cp-btn-ghost" disabled={switching} onClick={() => switchChain({ chainId: elysiumTestnet.id })}>{switching ? "Switching…" : "Switch to Elysium Testnet to change authorizations"}</button>}
    {confirm && <div className="border-l-2 border-warn pl-4 text-xs"><div className="font-semibold text-paper">{confirm.action === "PAUSE" ? "Pause strategy?" : "Revoke authorization?"}</div><p className="mt-1 text-muted">{confirm.action === "PAUSE" ? "New execution intents are blocked while paused. You can resume later." : "No new requests will be accepted under this authorization. A new signed authorization will be required."} Existing venue orders are not automatically canceled.</p><div className="mt-3 flex gap-2"><button className="cp-btn-ghost" onClick={() => setConfirm(null)}>Keep current state</button><button className="cp-btn-ghost" disabled={Boolean(busyId) || chainId !== elysiumTestnet.id} onClick={() => { const pending = confirm; setConfirm(null); void change(pending.row, pending.action); }}>Confirm {confirm.action.toLowerCase()}</button></div></div>}
    {busyId && <p role="status" className="text-xs text-muted">Waiting for wallet signature and CorePilot verification…</p>}
    {error && <p role="alert" className="text-xs text-warn">{error} <button className="underline" onClick={() => { setError(null); if (address) void refresh(address).catch(err => setError(actionError(err))); }}>Retry</button></p>}
    <p className="text-xs text-muted">CorePilot authorization is not a Hyperliquid API-agent grant. No position or venue fill is inferred.</p>
  </div>;
}
