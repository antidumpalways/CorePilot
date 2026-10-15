import { useEffect, useState } from "react";
import { useAccount, useConnect, useSwitchChain, useWalletClient } from "wagmi";
import { authorizationChangeMessage, authorizationSigningMessage, type TraderAuthorizationV1 } from "@corepilot/shared";
import { changeAuthorizationState, fetchAuthorizations, fetchVerifiedPolicy, saveSignedAuthorization, type AuthorizationView, type VerifiedPolicy } from "../lib/api";
import { actionError, expiryLabel, previewEffectiveLimits, primaryStrategyAction } from "../lib/strategyUx";
import { elysiumTestnet } from "../lib/wagmi";
import { shortenHash } from "../lib/format";

interface Props { chainStrategyId: number | null; executable: boolean | null; maxNotionalUsd: number | null; maxLeverageBps: number | null; maxSlippageBps: number | null }
type Step = "intro" | "limits" | "review";

export function AuthorizationPanel({ chainStrategyId, executable }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [policy, setPolicy] = useState<VerifiedPolicy | null>(null);
  const [authorizations, setAuthorizations] = useState<AuthorizationView[]>([]);
  const [step, setStep] = useState<Step>("intro");
  const [notional, setNotional] = useState(100);
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(30);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"PAUSE" | "REVOKE" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  async function refresh() {
    if (!chainStrategyId) return;
    const verified = await fetchVerifiedPolicy(chainStrategyId);
    setPolicy(verified);
    const found = address ? await fetchAuthorizations(address) : null;
    setAuthorizations((found?.data ?? []).filter(item => item.authorization.strategyId === chainStrategyId));
  }

  useEffect(() => {
    let cancelled = false;
    setPolicy(null); setAuthorizations([]); setError(null); setStep("intro"); setLoading(Boolean(chainStrategyId));
    if (!chainStrategyId) return;
    Promise.all([fetchVerifiedPolicy(chainStrategyId), address ? fetchAuthorizations(address) : Promise.resolve(null)])
      .then(([verified, found]) => { if (!cancelled) { setPolicy(verified); setAuthorizations((found?.data ?? []).filter(item => item.authorization.strategyId === chainStrategyId)); } })
      .catch(err => { if (!cancelled) setError(actionError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chainStrategyId, address]);

  const matching = authorizations.filter(item => item.authorization.policyHash.toLowerCase() === policy?.hash.toLowerCase());
  const current = matching.find(item => item.status === "ACTIVE" || item.status === "PAUSED") ?? matching[0];
  const currentStatus = current && (current.status === "ACTIVE" || current.status === "PAUSED") && current.authorization.validUntilMs <= now ? "EXPIRED" : current?.status;
  const bounds = policy?.policy.bounds;
  const valid = Number.isSafeInteger(notional) && notional > 0 && Number.isSafeInteger(leverage * 100) && leverage > 0 && Number.isSafeInteger(slippage) && slippage >= 0 && Number.isSafeInteger(hours) && hours > 0 && hours <= 720 && Boolean(bounds);
  const effective = policy && valid ? previewEffectiveLimits(policy.policy, { maxNotionalUsd: notional, maxLeverageBps: Math.round(leverage * 100), maxSlippageBps: slippage }) : null;
  const action = primaryStrategyAction({ connected: isConnected, correctChain: chainId === elysiumTestnet.id, loading, policyVerified: policy?.status === "VERIFIED", executable, authorization: current, draft: step === "limits", reviewing: step === "review", pending: busy });

  async function activate() {
    if (!wallet || !address || !policy || !effective || !valid || busy || chainId !== elysiumTestnet.id || executable !== true) return;
    setBusy(true); setError(null);
    let saved = false;
    try {
      const now = Date.now();
      const authorization: TraderAuthorizationV1 = { authorizationId: crypto.randomUUID(), chainId: policy.policy.chainId, registry: policy.policy.registry, strategyId: policy.policy.strategyId, policyVersion: policy.policy.version, policyHash: policy.hash, trader: address, version: 1, ...effective, validFromMs: now, validUntilMs: now + hours * 3600_000 };
      setLifecycle("Waiting for wallet signature…");
      const signature = await wallet.signMessage({ account: address, message: authorizationSigningMessage(authorization) });
      setLifecycle("Signature received · verifying with CorePilot API…");
      await saveSignedAuthorization(authorization, signature);
      saved = true;
      await refresh(); setStep("intro");
      setLifecycle("CorePilot authorization active. Hyperliquid trade-agent authorization and venue execution remain unverified.");
    } catch (err) { setError(saved ? "Signature was accepted, but refreshing authorization state failed. Retry the status check before signing again." : actionError(err)); setLifecycle(null); }
    finally { setBusy(false); }
  }

  async function change(state: "PAUSE" | "RESUME" | "REVOKE") {
    if (!current || !wallet || !address || busy || chainId !== elysiumTestnet.id) return;
    setBusy(true); setError(null); setConfirm(null);
    let saved = false;
    try {
      const nextVersion = current.authorization.version + 1;
      setLifecycle("Waiting for wallet signature…");
      const signature = await wallet.signMessage({ account: address, message: authorizationChangeMessage(current.authorization, nextVersion, state) });
      setLifecycle("Signature received · verifying state change…");
      await changeAuthorizationState(current.authorization.authorizationId, state, nextVersion, signature);
      saved = true;
      await refresh();
      setLifecycle(`CorePilot authorization ${state === "PAUSE" ? "paused" : state === "RESUME" ? "resumed" : "revoked"}. Existing venue orders are not automatically canceled.`);
    } catch (err) { setError(saved ? "State change was accepted, but refreshing status failed. Retry the status check before signing again." : actionError(err)); setLifecycle(null); }
    finally { setBusy(false); }
  }

  function handlePrimary() {
    switch (action.action) {
      case "connect": if (connectors[0]) connect({ connector: connectors[0] }); break;
      case "switch": switchChain({ chainId: elysiumTestnet.id }); break;
      case "use": case "renew": case "new": setLifecycle(null); setStep("limits"); break;
      case "review": if (valid) setStep("review"); break;
      case "authorize": void activate(); break;
      case "resume": void change("RESUME"); break;
    }
  }

  const showCurrent = current && (currentStatus === "ACTIVE" || currentStatus === "PAUSED") && step === "intro";
  return <section className="auth-panel rounded-xl border border-line bg-ink-800 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-paper">My authorization</h2><span className="font-mono text-[10px] text-muted">{currentStatus ?? (policy ? "NOT AUTHORIZED" : loading ? "LOADING" : "POLICY UNVERIFIED")}</span></div>
    {showCurrent ? <div className="mt-5 space-y-3 text-xs"><div className="cp-kicker text-accent">Effective execution bounds</div><div className="font-mono text-paper">${current.authorization.maxNotionalUsd.toLocaleString()} · {(current.authorization.maxLeverageBps / 100).toFixed(2)}× · {current.authorization.maxSlippageBps} bps</div><div className="text-muted">{expiryLabel(current.authorization.validUntilMs)} · {new Date(current.authorization.validUntilMs).toLocaleString()}</div><div className="flex flex-wrap gap-2">{current.status === "ACTIVE" && <button className="cp-btn-ghost" disabled={busy} onClick={() => setConfirm("PAUSE")}>Pause</button>}<button className="cp-btn-ghost" disabled={busy} onClick={() => setConfirm("REVOKE")}>Revoke</button>{current.status === "ACTIVE" && current.authorization.validUntilMs - Date.now() < 24 * 3600_000 && <button className="cp-btn-ghost" disabled={busy} onClick={() => setStep("limits")}>Renew</button>}</div><p className="text-muted">Authorization state does not prove a trigger, order, or venue fill.</p></div>
    : step === "intro" ? <div className="mt-5 space-y-3 text-xs"><div className="cp-kicker text-accent">Understand</div><p className="text-muted">{policy ? `${policy.policy.market} funding < ${policy.policy.signal.thresholdBps.toFixed(2)} bps → request ${policy.policy.action.side.toUpperCase()} ${policy.policy.market}.` : "A verified strategy rule is required before authorization."}</p><p className="text-muted">Creator bound: {bounds ? `$${bounds.maxNotionalUsd.toLocaleString()} · ${(bounds.maxLeverageBps / 100).toFixed(2)}× · ${bounds.maxSlippageBps} bps` : "unverified"}.</p><p className="text-muted">Your limits may only reduce these bounds. Trading capital is separate from the PILOT creator bond.</p></div>
    : step === "limits" ? <div className="mt-5 space-y-3"><div className="cp-kicker text-accent">Set your limits</div><label className="auth-limit-row"><span>Max execution</span><span className="auth-limit-control"><input className="cp-input" type="number" min="1" value={notional} onChange={e => setNotional(Number(e.target.value))} /><span>USD</span></span></label><label className="auth-limit-row"><span>Max leverage</span><span className="auth-limit-control"><input className="cp-input" type="number" min="0.01" step="0.01" value={leverage} onChange={e => setLeverage(Number(e.target.value))} /><span>×</span></span></label><label className="auth-limit-row"><span>Duration</span><span className="auth-limit-control"><input className="cp-input" type="number" min="1" max="720" value={hours} onChange={e => setHours(Number(e.target.value))} /><span>hours</span></span></label><details className="border-t border-line/50 pt-3"><summary className="cursor-pointer text-xs text-muted">Advanced Settings</summary><label className="auth-limit-row mt-3"><span>Max slippage</span><span className="auth-limit-control"><input className="cp-input" type="number" min="0" value={slippage} onChange={e => setSlippage(Number(e.target.value))} /><span>bps</span></span></label></details><div className="rounded-[11px] border border-accent/20 bg-accent/5 px-3.5 py-3 text-xs text-muted">Effective max · <span className="font-semibold text-paper">{effective ? `$${effective.maxNotionalUsd.toLocaleString()} / ${(effective.maxLeverageBps / 100).toFixed(2)}× / ${effective.maxSlippageBps} bps` : "Check limits"}</span>{effective && bounds && (notional > bounds.maxNotionalUsd || leverage * 100 > bounds.maxLeverageBps || slippage > bounds.maxSlippageBps) && <div className="mt-1">Capped by creator policy. The lower effective values are signed.</div>}</div></div>
    : <div className="mt-5 space-y-3 text-xs"><div className="cp-kicker text-accent">Review effective authority</div><p className="text-muted">The effective values below are what you sign.</p><div className="overflow-x-auto"><table className="cp-table w-full"><thead><tr><th>Limit</th><th>Creator</th><th>You</th><th>Effective</th></tr></thead><tbody>{bounds && effective && <><tr><td>Notional</td><td>${bounds.maxNotionalUsd.toLocaleString()}</td><td>${notional.toLocaleString()}</td><td>${effective.maxNotionalUsd.toLocaleString()}</td></tr><tr><td>Leverage</td><td>{(bounds.maxLeverageBps/100).toFixed(2)}×</td><td>{leverage.toFixed(2)}×</td><td>{(effective.maxLeverageBps/100).toFixed(2)}×</td></tr><tr><td>Slippage</td><td>{bounds.maxSlippageBps} bps</td><td>{slippage} bps</td><td>{effective.maxSlippageBps} bps</td></tr></>}</tbody></table></div><p className="text-paper">Valid for {hours} hours. CorePilot may request bounded trading actions only within these limits.</p>{current?.status === "ACTIVE" && <p className="text-warn">Renewal creates a second active authorization. The existing authorization remains valid until expiry or separately revoked.</p>}<p className="text-muted">This signature is a CorePilot authorization, not a Hyperliquid trade-agent grant. Agent integration and venue execution are unverified.</p><details className="border-t border-line/50 pt-3"><summary className="cursor-pointer text-muted">Technical Details</summary><div className="mt-2 break-all font-mono text-[11px] text-muted">Policy v{policy?.policy.version} · {policy ? shortenHash(policy.hash) : "—"}<br />Registry {policy?.policy.registry ?? "—"}<br />Chain {policy?.policy.chainId ?? "—"}</div></details></div>}
    {confirm && <div className="mt-4 border-l-2 border-warn pl-3 text-xs"><div className="font-semibold text-paper">{confirm === "PAUSE" ? "Pause this strategy?" : "Revoke this authorization?"}</div><p className="mt-1 text-muted">{confirm === "PAUSE" ? "New execution intents will be blocked while paused. You can resume later." : "No new execution requests will be accepted under this authorization. A new signature will be required to activate it again."} Existing venue orders, if any, are not automatically canceled.</p><div className="mt-3 flex gap-2"><button className="cp-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>Keep current state</button><button className="cp-btn-ghost" disabled={busy} onClick={() => void change(confirm)}>Confirm {confirm.toLowerCase()}</button></div></div>}
    {currentStatus === "PAUSED" && step === "intro" && <p className="mt-3 text-xs text-muted">New intents are blocked until you sign a resume action.</p>}{currentStatus === "EXPIRED" && step === "intro" && <p className="mt-3 text-xs text-warn">Authorization expired. New intents are blocked; sign a new authorization to renew.</p>}
    {current?.status === "UNVERIFIED" && step === "intro" && <p className="mt-3 text-xs text-warn">An earlier authorization could not be verified against the current policy. It grants no confirmed authority here; review a new signature.</p>}
    <button type="button" className="cp-btn-primary mt-5 w-full" disabled={busy || connecting || switching || ["loading", "unavailable", "pending", "active"].includes(action.action) || action.action === "review" && !valid || action.action === "authorize" && (!valid || !wallet)} onClick={handlePrimary}>{action.label}</button>{(step === "limits" || step === "review") && <button type="button" className="cp-btn-ghost mt-2 w-full" disabled={busy} onClick={() => setStep(step === "review" ? "limits" : "intro")}>Back</button>}
    {action.helper && <p className="mt-3 text-xs text-warn">{action.helper}</p>}{!valid && step !== "intro" && <p className="mt-3 text-xs text-warn">Enter a positive whole-dollar maximum, valid leverage/slippage, and 1–720 hours before signing.</p>}{error && <div role="alert" className="mt-3 break-words text-xs text-warn">{error} <button type="button" className="underline" onClick={() => { setError(null); void refresh().catch(err => setError(actionError(err))); }}>Retry</button></div>}{lifecycle && <p role="status" className="mt-3 text-xs text-muted">{lifecycle}</p>}
    <p className="mt-4 border-t border-line/50 pt-4 text-[11px] leading-5 text-muted">CorePilot signature ≠ Hyperliquid agent grant. No venue order or fill is implied.</p>
  </section>;
}
