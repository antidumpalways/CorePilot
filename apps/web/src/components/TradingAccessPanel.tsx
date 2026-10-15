import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { tradingAccessSigningMessage, type TradingAccessGrantV1 } from "@corepilot/shared";
import { checkTradingAccess, fetchRuntimeTrace, fetchTradingAccess, saveSignedTradingAccess, type AuthorizationView,
  type RuntimeTraceView, type TradingAccessView } from "../lib/api";
import { actionError } from "../lib/strategyUx";
import { elysiumTestnet } from "../lib/wagmi";

export function TradingAccessPanel({ row }: { row: AuthorizationView }) {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const [access, setAccess] = useState<TradingAccessView | null>(null);
  const [trace, setTrace] = useState<RuntimeTraceView | null>(null);
  const [account, setAccount] = useState("");
  const [agent, setAgent] = useState("");
  const [mode, setMode] = useState<"ISOLATED" | "COMPATIBILITY">("ISOLATED");
  const [compatibilityConsent, setCompatibilityConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ key: string; ready: boolean; reason: string } | null>(null);
  const authorization = row.authorization;
  const executionAccount = mode === "COMPATIBILITY" ? address ?? "" : account;
  const checkKey = `${authorization.authorizationId}:${mode}:${executionAccount.toLowerCase()}:${agent.toLowerCase()}`;
  const venueReason: Record<string, string> = {
    READY: "Agent and execution account match this wallet on HyperCore testnet.",
    AGENT_NOT_APPROVED: "This address is not an approved testnet agent. Approve it in Hyperliquid testnet first.",
    AGENT_WRONG_OWNER: "This agent belongs to another trader wallet. Use an agent approved by this wallet.",
    ACCOUNT_MUST_MATCH_WALLET: "In wallet mode, the execution account must be your connected wallet.",
    SUBACCOUNT_REQUIRED: "Isolated mode needs a dedicated subaccount, not the main wallet.",
    SUBACCOUNT_NOT_FOUND: "This address is not a HyperCore testnet subaccount.",
    SUBACCOUNT_WRONG_OWNER: "This subaccount belongs to another master wallet.",
    VENUE_UNAVAILABLE: "HyperCore testnet could not be reached. Try the check again later.",
  };

  async function checkSetup() {
    if (!isAddress(executionAccount) || !isAddress(agent) || checking) return;
    const key = checkKey;
    setChecking(true); setChecked(null); setError(null);
    try {
      const result = await checkTradingAccess({ authorizationId: authorization.authorizationId,
        executionAccount, agentAddress: agent, isolationMode: mode });
      setChecked({ key, ready: result.ready, reason: result.reason });
    } catch (caught) { setError(actionError(caught)); }
    finally { setChecking(false); }
  }

  async function refresh() {
    try { setAccess(await fetchTradingAccess(authorization.authorizationId)); }
    catch (caught) {
      if (caught instanceof Error && caught.message === "TRADING_ACCESS_NOT_FOUND") setAccess(null);
      else setError("Trading access state unavailable. Try again.");
    }
  }
  useEffect(() => { void refresh(); }, [authorization.authorizationId]);
  useEffect(() => {
    let active = true;
    fetchRuntimeTrace(authorization.authorizationId).then(value => { if (active) setTrace(value); })
      .catch(() => { if (active) setTrace(null); });
    return () => { active = false; };
  }, [authorization.authorizationId]);

  async function connectAgent() {
    if (!wallet || !address || !isAddress(executionAccount) || !isAddress(agent) || busy ||
        checked?.key !== checkKey || !checked.ready ||
        chainId !== elysiumTestnet.id || row.status !== "ACTIVE") return;
    if (mode === "COMPATIBILITY" && !compatibilityConsent) {
      setError("Confirm the broader native agent authority before choosing compatibility mode.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const recheck = await checkTradingAccess({ authorizationId: authorization.authorizationId,
        executionAccount, agentAddress: agent, isolationMode: mode });
      if (!recheck.ready) { setChecked({ key: checkKey, ready: false, reason: recheck.reason }); return; }
      const grant: TradingAccessGrantV1 = { version: 1,
        authorizationId: authorization.authorizationId, chainId: authorization.chainId,
        registry: authorization.registry, trader: authorization.trader,
        executionAccount, agentAddress: agent, isolationMode: mode,
        validUntilMs: Math.min(authorization.validUntilMs, Date.now() + 7 * 24 * 60 * 60 * 1000) };
      if (address.toLowerCase() !== grant.trader.toLowerCase()) throw new Error("Connect the authorization owner wallet.");
      if (mode === "ISOLATED" && executionAccount.toLowerCase() === address.toLowerCase()) {
        throw new Error("Isolated mode requires a dedicated HyperCore testnet subaccount.");
      }
      if (mode === "COMPATIBILITY" && executionAccount.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Compatibility mode requires the trader account address.");
      }
      const signature = await wallet.signMessage({ account: address,
        message: tradingAccessSigningMessage(grant) });
      await saveSignedTradingAccess(grant, signature);
      await refresh();
    } catch (caught) { setError(actionError(caught)); }
    finally { setBusy(false); }
  }

  return <details className="mt-4 border-t border-line pt-4">
    <summary className="cursor-pointer text-xs text-paper">Trading access <span className="ml-2 font-mono text-muted">{access?.status ?? "NOT CONNECTED"} ▾</span></summary>
    <div className="mt-4 space-y-3 text-xs">
      {access ? <div className="grid gap-2 font-mono text-muted sm:grid-cols-2"><div>Mode · {access.isolationMode}</div><div>Agent · {access.agentAddress.slice(0, 10)}…</div><div>Account · {access.executionAccount.slice(0, 10)}…</div><div>Venue · HyperCore Testnet</div></div> : null}
      <p className="text-muted">Connect an already-approved HyperCore testnet agent. This does not create an agent or place an order.</p>
      {access?.status === "ACTIVE" ? <button className="cp-btn-ghost" type="button" onClick={() => void refresh()}>Verify venue access again</button> : row.status === "ACTIVE" ? <div className="space-y-3">
        <div className="cp-label">1 / Choose where testnet orders would run</div>
        <div className="grid gap-2 sm:grid-cols-2"><button type="button" className={`rounded-lg border p-3 text-left ${mode === "ISOLATED" ? "border-accent bg-accent/10 text-paper" : "border-line text-muted"}`} aria-pressed={mode === "ISOLATED"} onClick={() => { setMode("ISOLATED"); setAccount(""); setChecked(null); setCompatibilityConsent(false); }}><span className="block font-semibold">Dedicated subaccount</span><span className="mt-1 block text-[11px]">Recommended isolation · needs an existing testnet subaccount</span></button><button type="button" className={`rounded-lg border p-3 text-left ${mode === "COMPATIBILITY" ? "border-accent bg-accent/10 text-paper" : "border-line text-muted"}`} aria-pressed={mode === "COMPATIBILITY"} onClick={() => { setMode("COMPATIBILITY"); setAccount(address ?? ""); setChecked(null); }}><span className="block font-semibold">Use connected wallet</span><span className="mt-1 block text-[11px]">Simpler setup · venue agent may have broader authority</span></button></div>
        <div className="cp-label pt-2">2 / Enter public addresses</div>
        <label className="block text-muted">{mode === "ISOLATED" ? "Your HyperCore testnet subaccount" : "Execution account · connected wallet"}<input className="cp-input mt-1 w-full font-mono text-xs" value={mode === "COMPATIBILITY" ? address ?? "" : account} onChange={event => { setAccount(event.target.value.trim()); setChecked(null); }} readOnly={mode === "COMPATIBILITY"} placeholder="0x…" autoComplete="off" /><span className="mt-1 block text-[11px]">{mode === "ISOLATED" ? "This must be a subaccount owned by the connected wallet." : "Filled automatically from your wallet."}</span></label>
        <label className="block text-muted">Approved testnet agent · public address<input className="cp-input mt-1 w-full font-mono text-xs" value={agent} onChange={event => { setAgent(event.target.value.trim()); setChecked(null); }} placeholder="0x…" autoComplete="off" /><span className="mt-1 block text-[11px]">Use an agent already approved by this wallet in Hyperliquid testnet. Never paste a private key.</span></label>
        <div className="cp-label pt-2">3 / Check before signing</div>
        <button type="button" className="cp-btn-ghost" disabled={checking || busy || !isAddress(mode === "COMPATIBILITY" ? address ?? "" : account) || !isAddress(agent)} onClick={() => void checkSetup()}>{checking ? "Checking testnet roles…" : "Check testnet setup"}</button>
        {checked?.key === checkKey && <p role="status" className={`border-l-2 pl-3 ${checked.ready ? "border-long text-long" : "border-warn text-warn"}`}>{venueReason[checked.reason] ?? checked.reason}{checked.ready && <span className="mt-1 block text-muted">This checks venue roles only. The local executor must separately use the same approved agent before an order can run.</span>}</p>}
        {mode === "COMPATIBILITY" && <label className="flex items-start gap-2 text-warn"><input type="checkbox" checked={compatibilityConsent} onChange={event => setCompatibilityConsent(event.target.checked)} />I understand the venue agent may have broader native trading authority than CorePilot's limits.</label>}
        <button type="button" className="cp-btn-primary" disabled={busy || checking || !wallet || chainId !== elysiumTestnet.id || checked?.key !== checkKey || !checked.ready || (mode === "COMPATIBILITY" && !compatibilityConsent)} onClick={() => void connectAgent()}>{busy ? "Verifying agent…" : "Sign trading access"}</button>
      </div> : <p className="text-warn">An ACTIVE CorePilot authorization is required before connecting trading access.</p>}
      {error && <p role="alert" className="text-warn">{error}</p>}
      <div className="border-t border-line pt-3"><div className="cp-label">Runtime evidence</div>
        <div className="mt-2 font-mono text-[11px] text-muted">HyperCore Mainnet signal → Elysium Testnet policy → HyperCore Testnet order</div>
        <div className="mt-2 text-muted">{trace?.triggers[0] ? `Trigger ${trace.triggers[0].matched ? "MATCHED" : "NOT MATCHED"} · ${trace.triggers[0].reason}` : "No recorded trigger yet"}</div>
        <div className="mt-1 text-muted">{trace?.intents[0] ? `Intent ${trace.intents[0].status} · venue ${trace.intents[0].venueReceipt?.status ?? "NOT SUBMITTED"}${trace.intents[0].venueReceipt?.orderId ? ` · order #${trace.intents[0].venueReceipt.orderId}` : ""}` : "No canonical intent or venue receipt yet"}</div>
      </div>
      <p className="text-[11px] text-muted">CorePilot Pause/Revoke blocks new intents; it does not remove venue-native agent authority. Revoke the agent in Hyperliquid separately and refresh verification here.</p>
    </div>
  </details>;
}
