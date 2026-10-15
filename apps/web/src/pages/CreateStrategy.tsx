import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { decodeEventLog, formatUnits, parseUnits, type WalletClient } from "viem";
import { policySigningMessage, type StrategyPolicyV1 } from "@corepilot/shared";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { strategyRegistryAbi, pilotStakingAbi, type StrategyRecord } from "@corepilot/sdk";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { CreateLivePreview } from "../components/CreateLivePreview";
import { FaucetButton } from "../components/FaucetButton";
import { Spinner } from "../components/Feedback";
import { WalletButton } from "../components/WalletButton";
import { fetchCapabilities, fetchHealth, fetchMarketData, fetchMarkets, saveSignedPolicy, type MarketView } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import { elysiumTestnet } from "../lib/wagmi";
import { formatBps, formatFunding, formatNumber, formatUsd, shortenAddress, shortenHash } from "../lib/format";
import { actionError } from "../lib/strategyUx";
import { isRpcRateLimit, retryRpcRead } from "../lib/rpcRetry";

const STEPS = ["Trigger", "Action & constraints", "PILOT bond", "Review & publish"] as const;
type TxState = "idle" | "wallet" | "confirming" | "success" | "error";
interface TxLine { label: string; detail: string; state: TxState }

const pauseRpc = () => new Promise<void>(resolve => setTimeout(resolve, 350));
let pendingBondRead: { key: string; promise: Promise<{ walletBalance: bigint; required: bigint; approved: bigint }> } | null = null;

function NumberField({ label, value, onChange, suffix, helper }: { label: string; value: number; onChange: (value: number) => void; suffix: string; helper?: string }) {
  return <label className="block"><span className="cp-label">{label}</span><div className="mt-2 flex"><input type="number" className="cp-input rounded-r-none font-mono tabular-nums" value={value} onChange={event => onChange(Number(event.target.value))} /><span className="flex min-w-14 items-center justify-center rounded-r-md border border-l-0 border-line bg-ink-700 px-3 text-xs text-muted">{suffix}</span></div>{helper && <span className="mt-1.5 block text-[11px] text-muted">{helper}</span>}</label>;
}

export function CreateStrategy() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, isPending: switching } = useSwitchChain();
  const marketsResource = useApiResource<string[]>(fetchMarkets, []);
  const capabilities = useApiResource(fetchCapabilities, []);
  const health = useApiResource(fetchHealth, []);
  const [step, setStep] = useState(0);
  const [market, setMarket] = useState("HYPE");
  const marketResource = useApiResource<MarketView>(() => fetchMarketData(market), [market]);
  const [fundingBelowBps, setFundingBelowBps] = useState(-1);
  const [side, setSide] = useState<"long" | "short">("long");
  const [maxLeverageX, setMaxLeverageX] = useState(3);
  const [maxSlippageBps, setMaxSlippageBps] = useState(50);
  const [maxNotionalUsd, setMaxNotionalUsd] = useState(25000);
  const [expiryHours, setExpiryHours] = useState(24);
  const [bond, setBond] = useState(5000);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [minBond, setMinBond] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txLines, setTxLines] = useState<TxLine[]>([]);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryRecord, setRecoveryRecord] = useState<StrategyRecord | null>(null);
  const [recoveryBond, setRecoveryBond] = useState<bigint | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const markets = marketsResource.result?.data?.length ? marketsResource.result.data : ["HYPE", "BTC", "ETH"];
  const snapshot = marketResource.result?.data;
  const capabilityData = capabilities.result?.data;
  const supportedSignal = capabilityData?.signals.some(item => item.type === "funding_rate" && item.support === "supported") ?? false;
  const supportedAction = capabilityData?.actions.some(item => item.type === "open_position" && item.support === "supported") ?? false;
  let bondWei = 0n;
  try { if (Number.isFinite(bond) && bond > 0) bondWei = parseUnits(String(bond), 18); } catch { /* Bond precision is validated below. */ }
  const triggerValid = Boolean(market) && Number.isFinite(fundingBelowBps) && Number.isSafeInteger(fundingBelowBps * 1000) && supportedSignal;
  const riskValid = supportedAction && Number.isInteger(maxNotionalUsd) && maxNotionalUsd > 0 && Number.isFinite(maxLeverageX) && maxLeverageX > 0 && maxLeverageX <= 20 && Number.isInteger(maxSlippageBps) && maxSlippageBps > 0 && Number.isInteger(expiryHours) && expiryHours > 0;
  const bondValid = bondWei > 0n && (!isConnected || (balance !== null && minBond !== null && balance >= bondWei && bondWei >= minBond));
  const canProceed = step === 0 ? triggerValid : step === 1 ? riskValid : step === 2 ? bondValid : true;
  const deployment = capabilities.result?.data?.contracts?.deployment;
  const configured = getCorePilotClient().addresses;
  const deploymentMatches = Boolean(deployment?.registry && deployment?.pilotToken && deployment?.staking &&
    deployment.registry.toLowerCase() === configured.registry?.toLowerCase() &&
    deployment.pilotToken.toLowerCase() === configured.pilotToken?.toLowerCase() &&
    deployment.staking.toLowerCase() === configured.staking?.toLowerCase());
  const apiReady = capabilities.result?.source === "TESTNET" && capabilities.result.data.contracts?.addresses.registry === true && health.result?.data?.db === true && deploymentMatches;
  const canSign = isConnected && Boolean(walletClient) && hasContractConfig && chainId === elysiumTestnet.id && !busy && createdId === null && triggerValid && riskValid && bondValid && apiReady;
  const approvalRequired = allowance === null || allowance < bondWei;
  const publishLabel = txState === "wallet" ? "Check Wallet…" : txState === "confirming" ? "Confirming on Elysium…" : txState === "success" ? "Strategy Published" : createdId !== null ? "Registry Strategy Created · Recovery Required" : !hasContractConfig ? "Contract Unavailable" : balance !== null && balance < bondWei ? "Insufficient PILOT" : !apiReady ? "CorePilot API Unavailable" : approvalRequired ? "Approve PILOT & Publish" : "Publish Strategy";
  const addTx = (label: string, detail: string, state: TxState) => setTxLines(rows => [...rows, { label, detail, state }]);

  async function loadExistingStrategy(idText = recoveryInput) {
    setRecoveryError(null);
    const id = Number(idText);
    if (!Number.isSafeInteger(id) || id < 1) { setRecoveryError("Enter a valid strategy ID."); return; }
    if (!address || chainId !== elysiumTestnet.id) { setRecoveryError("Connect the creator wallet on Elysium Testnet first."); return; }
    setBusy(true);
    try {
      const client = getCorePilotClient();
      const [record, bonded] = await Promise.all([
        retryRpcRead(() => client.read.getStrategyRecord(id)),
        retryRpcRead(() => client.read.getCreatorBond(id)),
      ]);
      if (record.creator.toLowerCase() !== address.toLowerCase()) throw new Error("This strategy belongs to a different creator wallet.");
      if (record.strategyType !== "FUNDING_TRIGGER") throw new Error("This recovery flow only supports funding strategies.");
      if (record.expiry <= Math.floor(Date.now() / 1000)) throw new Error("This strategy has expired and cannot be activated.");
      if (record.active) throw new Error("This strategy is already active. Check its status in Strategies.");
      setRecoveryRecord(record); setRecoveryBond(bonded); setRecoveryInput(String(id)); setCreatedId(id);
      setMarket(record.market); setMaxLeverageX(record.maxLeverageBps / 100);
      setMaxSlippageBps(record.maxSlippageBps); setMaxNotionalUsd(record.maxNotionalUsd);
      setStep(3);
    } catch (error) { setRecoveryRecord(null); setRecoveryBond(null); setRecoveryError(actionError(error)); }
    finally { setBusy(false); }
  }

  async function resumeExistingStrategy() {
    if (!walletClient || !address || !recoveryRecord || !apiReady || busy || chainId !== elysiumTestnet.id) return;
    setBusy(true); setTxState("wallet"); setTxLines([]); setRecoveryError(null);
    const writer = walletClient as unknown as WalletClient;
    try {
      const client = getCorePilotClient();
      const registry = client.addresses.registry;
      const staking = client.addresses.staking;
      if (!registry || !staking) throw new Error("Contract addresses are incomplete");
      const latestCapabilities = await fetchCapabilities();
      const current = latestCapabilities.data.contracts?.deployment;
      if (latestCapabilities.source !== "TESTNET" || !current ||
          current.registry?.toLowerCase() !== registry.toLowerCase() ||
          current.pilotToken?.toLowerCase() !== client.addresses.pilotToken?.toLowerCase() ||
          current.staking?.toLowerCase() !== staking.toLowerCase()) throw new Error("DEPLOYMENT_MISMATCH");
      const id = recoveryRecord.id;
      const record = await retryRpcRead(() => client.read.getStrategyRecord(id));
      const bonded = await retryRpcRead(() => client.read.getCreatorBond(id));
      if (record.creator.toLowerCase() !== address.toLowerCase() || record.strategyType !== "FUNDING_TRIGGER") throw new Error("Strategy ownership or type changed. Reload its on-chain state.");
      if (record.expiry <= Math.floor(Date.now() / 1000) || record.active) throw new Error("Strategy expired or is already active. Reload its on-chain state.");
      if (record.market !== recoveryRecord.market || record.maxLeverageBps !== recoveryRecord.maxLeverageBps ||
          record.maxSlippageBps !== recoveryRecord.maxSlippageBps || record.maxNotionalUsd !== recoveryRecord.maxNotionalUsd ||
          record.expiry !== recoveryRecord.expiry) throw new Error("On-chain strategy bounds changed. Reload before signing.");
      if (!Number.isFinite(fundingBelowBps) || !Number.isSafeInteger(fundingBelowBps * 1000)) throw new Error("Invalid funding threshold.");
      const required = minBond ?? await retryRpcRead(() => client.publicClient.readContract({ address: staking, abi: pilotStakingAbi, functionName: "CREATOR_MIN_BOND" }));
      if (bonded < required) {
        if (bondWei < required) throw new Error("Selected PILOT bond is below the contract minimum.");
        const amount = bondWei > bonded ? bondWei - bonded : required - bonded;
        const walletBalance = await retryRpcRead(() => client.read.pilotBalance(address));
        if (walletBalance < amount) throw new Error("Insufficient PILOT balance for the remaining creator bond.");
        const approved = await retryRpcRead(() => client.read.pilotAllowance(address, staking));
        if (approved < amount) {
          addTx("Approval", "Waiting for wallet signature", "wallet");
          const hash = await client.write.approvePilot(writer, staking, amount);
          setTxState("confirming"); addTx("Approval", `Submitted ${shortenHash(hash)} · confirming`, "confirming");
          const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("PILOT approval reverted");
          addTx("Approval", `Confirmed ${shortenHash(hash)}`, "success");
        }
        setTxState("wallet"); addTx("Creator bond", `Stake ${formatUnits(amount, 18)} PILOT for existing strategy #${id}`, "wallet");
        const hash = await client.write.stakeCreator(writer, id, amount);
        setTxState("confirming"); addTx("Creator bond", `Submitted ${shortenHash(hash)} · confirming`, "confirming");
        const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Creator bond transaction reverted");
        addTx("Creator bond", `Confirmed ${shortenHash(hash)}`, "success");
        setRecoveryBond(bonded + amount);
      } else addTx("Creator bond", "Already bonded on-chain · no stake transaction needed", "success");
      const policy: StrategyPolicyV1 = { chainId: elysiumTestnet.id, registry, strategyId: id, creator: address, version: 1,
        market: record.market, signal: { type: "funding_rate", operator: "lt", thresholdBps: fundingBelowBps },
        action: { type: "open_position", side }, enabled: true,
        bounds: { maxNotionalUsd: record.maxNotionalUsd, maxLeverageBps: record.maxLeverageBps,
          maxSlippageBps: record.maxSlippageBps, expiry: record.expiry } };
      setTxState("wallet"); addTx("Strategy policy", "Sign the reviewed funding rule", "wallet");
      const signature = await writer.signMessage({ account: address, message: policySigningMessage(policy) });
      const saved = await saveSignedPolicy(policy, signature);
      if (saved.status !== "VERIFIED") throw new Error("Policy was not verified by the API");
      addTx("Strategy policy", `Verified v${policy.version} · ${shortenHash(saved.hash)}`, "success");
      setTxState("wallet"); addTx("Activate registry", "Waiting for creator wallet", "wallet");
      const hash = await client.write.setActive(writer, id, true);
      setTxState("confirming"); addTx("Activate registry", `Submitted ${shortenHash(hash)} · confirming`, "confirming");
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Registry activation reverted");
      addTx("Activate registry", `Confirmed ${shortenHash(hash)}`, "success");
      setTxState("success");
    } catch (error) { setTxState("error"); addTx("Action needed", actionError(error), "error"); }
    finally { setBusy(false); setBalanceRefresh(value => value + 1); }
  }

  useEffect(() => {
    let cancelled = false;
    if (!address || !hasContractConfig) { setBalance(null); setMinBond(null); setAllowance(null); return; }
    const client = getCorePilotClient();
    setBalance(null); setMinBond(null); setAllowance(null); setBalanceError(null);
    const key = `${address}:${client.addresses.pilotToken}:${client.addresses.staking}:${balanceRefresh}`;
    if (!pendingBondRead || pendingBondRead.key !== key) {
      const promise = (async () => {
        const walletBalance = await retryRpcRead(() => client.read.pilotBalance(address));
        await pauseRpc();
        const required = await retryRpcRead(() => client.publicClient.readContract({
          address: client.addresses.staking!, abi: pilotStakingAbi, functionName: "CREATOR_MIN_BOND" }));
        let approved = 0n;
        if (walletBalance > 0n) {
          await pauseRpc();
          approved = await retryRpcRead(() => client.read.pilotAllowance(address, client.addresses.staking!));
        }
        return { walletBalance, required, approved };
      })();
      pendingBondRead = { key, promise };
      void promise.finally(() => { if (pendingBondRead?.promise === promise) pendingBondRead = null; }).catch(() => {});
    }
    pendingBondRead.promise
      .then(({ walletBalance, required, approved }) => { if (!cancelled) { setBalance(walletBalance); setMinBond(required); setAllowance(approved); setBalanceError(null); } })
      .catch(error => { if (!cancelled) setBalanceError(isRpcRateLimit(error)
        ? "Public Elysium RPC is rate-limited. Wait 20–30 seconds, then retry balance. Do not submit a transaction while the balance is unknown."
        : error instanceof Error ? error.message : "Balance unavailable"); });
    return () => { cancelled = true; };
  }, [address, balanceRefresh]);

  async function sign() {
    if (!walletClient || !canSign) return;
    setBusy(true); setTxState("wallet"); setTxLines([]); setCreatedId(null);
    const writer = walletClient as unknown as WalletClient;
    try {
      const client = getCorePilotClient();
      const staking = client.addresses.staking;
      const registry = client.addresses.registry;
      if (!staking || !registry) throw new Error("Contract addresses are incomplete");
      const latestCapabilities = await fetchCapabilities();
      const current = latestCapabilities.data.contracts?.deployment;
      if (latestCapabilities.source !== "TESTNET" || !current ||
          current.registry?.toLowerCase() !== registry.toLowerCase() ||
          current.pilotToken?.toLowerCase() !== client.addresses.pilotToken?.toLowerCase() ||
          current.staking?.toLowerCase() !== staking.toLowerCase()) {
        throw new Error("DEPLOYMENT_MISMATCH");
      }
      if (!address || !chainId) throw new Error("Wallet identity is unavailable");
      const expiry = Math.floor(Date.now() / 1000) + expiryHours * 3600;
      if (approvalRequired) {
        addTx("Approval", "Waiting for wallet signature", "wallet");
        const approvalHash = await client.write.approvePilot(writer, staking, bondWei);
        setTxState("confirming"); addTx("Approval", `Submitted ${approvalHash} · confirming`, "confirming");
        const approvalReceipt = await client.publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("PILOT approval reverted");
        setAllowance(bondWei); addTx("Approval", `Confirmed ${shortenHash(approvalHash)}`, "success");
      } else addTx("Approval", "Existing allowance is sufficient · no approval transaction needed", "success");
      setTxState("wallet"); addTx("Create strategy", "Waiting for wallet signature", "wallet");
      const createHash = await client.write.createStrategy(writer, { market, strategyType: "FUNDING_TRIGGER", maxLeverageBps: Math.round(maxLeverageX * 100), maxSlippageBps, maxNotionalUsd, expiry });
      setTxState("confirming"); addTx("Create strategy", `Submitted ${shortenHash(createHash)} · confirming`, "confirming");
      const createReceipt = await client.publicClient.waitForTransactionReceipt({ hash: createHash });
      if (createReceipt.status !== "success") throw new Error("Strategy creation reverted");
      let strategyId: number | null = null;
      for (const entry of createReceipt.logs) {
        if (entry.address.toLowerCase() !== registry.toLowerCase()) continue;
        try { const event = decodeEventLog({ abi: strategyRegistryAbi, data: entry.data, topics: entry.topics }); if (event.eventName === "StrategyCreated") { strategyId = Number(event.args.strategyId); break; } } catch { /* Unrelated log. */ }
      }
      if (strategyId === null) throw new Error(`Strategy confirmed (${createHash}), but its ID was not found in the receipt. Bond it from the registry.`);
      setCreatedId(strategyId); setRecoveryInput(String(strategyId)); addTx("Create strategy", `Confirmed strategy #${strategyId} · ${shortenHash(createHash)}`, "success");
      setTxState("wallet"); addTx("Creator bond", "Waiting for wallet signature", "wallet");
      const stakeHash = await client.write.stakeCreator(writer, strategyId, bondWei);
      setTxState("confirming"); addTx("Creator bond", `Submitted ${shortenHash(stakeHash)} · confirming`, "confirming");
      const stakeReceipt = await client.publicClient.waitForTransactionReceipt({ hash: stakeHash });
      if (stakeReceipt.status !== "success") throw new Error("Creator bond transaction reverted");
      addTx("Creator bond", `Confirmed ${formatNumber(bond, 0)} PILOT · ${shortenHash(stakeHash)}`, "success");
      const policy: StrategyPolicyV1 = { chainId, registry, strategyId, creator: address, version: 1,
        market, signal: { type: "funding_rate", operator: "lt", thresholdBps: fundingBelowBps },
        action: { type: "open_position", side }, enabled: true,
        bounds: { maxNotionalUsd, maxLeverageBps: Math.round(maxLeverageX * 100), maxSlippageBps, expiry } };
      setTxState("wallet"); addTx("Strategy policy", "Sign the exact funding rule for API verification", "wallet");
      const policySignature = await writer.signMessage({ account: address, message: policySigningMessage(policy) });
      const saved = await saveSignedPolicy(policy, policySignature);
      if (saved.status !== "VERIFIED") throw new Error("Policy was not verified by the API");
      addTx("Strategy policy", `Verified v${policy.version} · ${shortenHash(saved.hash)}`, "success");
      setTxState("wallet"); addTx("Activate registry", "Waiting for creator wallet", "wallet");
      const activateHash = await client.write.setActive(writer, strategyId, true);
      setTxState("confirming");
      const activateReceipt = await client.publicClient.waitForTransactionReceipt({ hash: activateHash });
      if (activateReceipt.status !== "success") throw new Error("Registry activation reverted");
      addTx("Activate registry", `Confirmed ${shortenHash(activateHash)}`, "success");
      setTxState("success");
    } catch (error) { setTxState("error"); addTx("Action needed", actionError(error), "error"); }
    finally { setBusy(false); }
  }

  return <div className="create-composer space-y-7"><div className="border-b border-line pb-6"><div className="cp-kicker text-accent">Creator / Elysium testnet</div><h1 className="cp-page-title mt-2">Create Strategy</h1><p className="cp-page-subtitle">Define a funding rule, set hard boundaries, and bond PILOT.</p></div>
    <section className="rounded-xl border border-accent/30 bg-accent/5 p-5" aria-label="Resume existing strategy">
      <div className="cp-kicker text-accent">Already registered on-chain?</div>
      <h2 className="mt-2 text-base font-semibold text-paper">Resume an existing strategy</h2>
      <p className="mt-1 text-xs text-muted">Load your strategy ID to continue from the bond. This never creates another strategy.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input aria-label="Existing strategy ID" type="number" min="1" step="1" className="cp-input w-40 font-mono" placeholder="Strategy ID" value={recoveryInput} onChange={event => { setRecoveryInput(event.target.value); setRecoveryRecord(null); setRecoveryBond(null); }} />
        <button type="button" className="cp-btn-ghost" disabled={busy || !isConnected || chainId !== elysiumTestnet.id} onClick={() => void loadExistingStrategy()}>Load on-chain</button>
      </div>
      {recoveryError && <p role="alert" className="mt-3 text-xs text-short">{recoveryError}</p>}
      {recoveryRecord && <div className="mt-5 space-y-4 border-t border-accent/20 pt-4">
        <p className="font-mono text-xs text-paper">#{recoveryRecord.id} · {recoveryRecord.market} · {formatUsd(recoveryRecord.maxNotionalUsd)} · {formatBps(recoveryRecord.maxSlippageBps)} · expires {new Date(recoveryRecord.expiry * 1000).toLocaleString()}</p>
        <p className="text-xs text-muted">On-chain bond: {recoveryBond === null ? "—" : `${formatUnits(recoveryBond, 18)} PILOT`}. Review the off-chain rule before signing.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Funding below" value={fundingBelowBps} onChange={setFundingBelowBps} suffix="bps" />
          <label><span className="cp-label">Direction</span><select className="cp-input mt-2" value={side} onChange={event => setSide(event.target.value === "short" ? "short" : "long")}><option value="long">Long</option><option value="short">Short</option></select></label>
          {recoveryBond !== null && (minBond === null || recoveryBond < minBond) && <NumberField label="Target creator bond" value={bond} onChange={setBond} suffix="PILOT" />}
        </div>
        <p className="text-xs text-muted">The registry bounds and expiry above are read from chain; this form cannot change them.</p>
        <button type="button" className="cp-btn-primary" disabled={busy || !apiReady || !walletClient || chainId !== elysiumTestnet.id || txState === "success" || !Number.isSafeInteger(fundingBelowBps * 1000)} onClick={() => void resumeExistingStrategy()}>{busy ? "Working…" : `Resume strategy #${recoveryRecord.id}`}</button>
        {!apiReady && <p className="text-xs text-warn">API, database, or contract deployment is unavailable. Resume is paused.</p>}
      </div>}
    </section>
    <ol className="grid grid-cols-4 overflow-x-auto border-b border-line">{STEPS.map((label,index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`min-w-[132px] border-b-2 px-2 py-3 text-[11px] sm:px-4 sm:text-xs ${step === index ? "border-accent text-paper" : "border-transparent text-muted"}`}><span className="mr-2 font-mono text-accent">{index < step ? "✓" : `0${index+1}`}</span>{label}</li>)}</ol>
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(290px,.85fr)]"><section className="min-w-0 rounded-xl border border-line bg-ink-800 p-5 sm:p-7"><div className="mb-6 flex items-center justify-between border-b border-line pb-4"><h2 className="text-lg font-semibold text-paper">{STEPS[step]}</h2><span className="font-mono text-[11px] text-muted">{step+1} / 4</span></div>
      {step === 0 && <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-2"><label className="block flex-1"><span className="cp-label">Market</span><select className="cp-input mt-2 font-mono" aria-label="Market" value={market} onChange={event => setMarket(event.target.value)}>{markets.map(item => <option key={item} value={item}>{item}</option>)}</select></label><DataSourceBadge source={marketsResource.result?.source ?? "UNKNOWN"} /></div><div className="grid gap-4 sm:grid-cols-2"><label><span className="cp-label">Metric</span><div className="cp-input mt-2 flex items-center">Funding Rate <span className="ml-auto text-[10px] text-long">SUPPORTED</span></div></label><label><span className="cp-label">Operator</span><div className="cp-input mt-2 flex items-center">Below <span className="ml-auto font-mono text-accent">&lt;</span></div></label></div><NumberField label="Threshold" value={fundingBelowBps} onChange={setFundingBelowBps} suffix="bps" helper="−1.00 bps = −0.010% hourly funding" /><div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-xs text-muted"><DataSourceBadge source={marketResource.result?.source ?? "UNKNOWN"} />Current funding <span className="font-mono text-paper">{formatFunding(snapshot?.fundingRateBps)}</span><span className="text-muted">· context only, not verified policy evidence</span></div>{!supportedSignal && <p className="text-xs text-warn">Funding capability is not available from the API. Publishing is paused.</p>}</div>}
      {step === 1 && <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2"><label><span className="cp-label">Action</span><div className="cp-input mt-2 flex items-center">Open Position <span className="ml-auto text-[10px] text-long">SUPPORTED</span></div></label><label><span className="cp-label">Direction</span><select aria-label="Position side" className="cp-input mt-2" value={side} onChange={event => setSide(event.target.value === "short" ? "short" : "long")}><option value="long">Long</option><option value="short">Short</option></select></label></div><div className="border-t border-line pt-5"><h3 className="text-sm font-semibold text-paper">Strategy constraints</h3><p className="mt-1 text-xs text-muted">Creator-level ceilings checked before adapter dispatch.</p><div className="mt-5 grid gap-5 sm:grid-cols-2"><NumberField label="Maximum notional" value={maxNotionalUsd} onChange={setMaxNotionalUsd} suffix="USD" /><NumberField label="Maximum leverage" value={maxLeverageX} onChange={setMaxLeverageX} suffix="×" /><NumberField label="Maximum slippage" value={maxSlippageBps} onChange={setMaxSlippageBps} suffix="bps" /><NumberField label="Expiry after publish" value={expiryHours} onChange={setExpiryHours} suffix="hours" /></div></div>{!supportedAction && <p className="text-xs text-warn">Open Position capability is not available from the API.</p>}</div>}
      {step === 2 && <div className="space-y-5"><NumberField label="Creator bond" value={bond} onChange={setBond} suffix="PILOT" /><dl className="border-y border-line">{[["Minimum required", minBond === null ? "—" : `${formatNumber(Number(formatUnits(minBond,18)),0)} PILOT`], ["Wallet balance", balance === null ? "—" : `${formatNumber(Number(formatUnits(balance,18)),0)} PILOT`], ["After bond", balance === null ? "—" : balance >= bondWei ? `${formatNumber(Number(formatUnits(balance-bondWei,18)),0)} PILOT` : "Insufficient balance"]].map(([label,value]) => <div key={label} className="flex justify-between gap-3 border-b border-line-soft py-3 text-xs"><dt className="text-muted">{label}</dt><dd className="font-mono text-paper">{value}</dd></div>)}</dl>{!bondValid && !balanceError && <p role="alert" className="text-xs text-short">Check the amount, contract minimum, and wallet balance.</p>}{balanceError && <p role="status" className="text-xs text-warn">{balanceError} <button type="button" className="underline" onClick={() => setBalanceRefresh(value => value + 1)}>Retry balance</button></p>}<p className="text-xs leading-5 text-muted">Creator bonds provide accountability for a public strategy. PILOT is not trading capital.</p><div className="border-t border-line pt-4"><div className="cp-label mb-2">Testnet utility</div><FaucetButton onConfirmed={() => setBalanceRefresh(value => value + 1)} /></div></div>}
      {step === 3 && <div className="space-y-5"><div className="rounded-lg border border-accent/30 bg-accent/5 p-5"><div className="cp-kicker text-accent">Authoritative policy / version 1</div><p className="mt-4 text-lg font-semibold leading-7 text-paper">WHEN {market} funding &lt; <span className="font-mono text-accent">{fundingBelowBps.toFixed(2)} bps</span><br />THEN request {side.toUpperCase()} {market}</p><p className="mt-3 font-mono text-xs text-muted">BOUNDED BY {formatUsd(maxNotionalUsd)} · {maxLeverageX.toFixed(2)}× · {formatBps(maxSlippageBps)}</p></div><dl className="border-y border-line">{[["Creator bond", `${formatNumber(bond,0)} PILOT`], ["Network", "Elysium testnet"], ["Policy version", "1"], ["Expiry", `${expiryHours} hours after publish`], ["Creator", shortenAddress(address ?? "")]].map(([label,value]) => <div key={label} className="flex justify-between gap-3 border-b border-line-soft py-3 text-xs"><dt className="text-muted">{label}</dt><dd className="font-mono text-paper">{value}</dd></div>)}</dl><div className="border-l-2 border-warn pl-3 text-xs leading-5 text-warn">Publishing registers bounds and bonds PILOT, then signs the funding policy. If verification fails, the on-chain strategy remains but execution stays blocked.</div>{!hasContractConfig && <p className="text-xs text-warn">Contract addresses are not configured. Signing is unavailable.</p>}{!isConnected ? <WalletButton /> : chainId !== elysiumTestnet.id ? <button type="button" className="cp-btn-primary w-full" disabled={switching} onClick={() => switchChain({ chainId: elysiumTestnet.id })}>{switching ? "Switching…" : "Switch to Elysium Testnet"}</button> : <button type="button" className="cp-btn-primary w-full" disabled={!canSign || txState === "success"} onClick={() => void sign()}>{busy && <Spinner className="h-3.5 w-3.5" />}{publishLabel}</button>}{!apiReady && <p className="text-xs text-warn">{!deploymentMatches ? "Web and API point to different deployments. Hard-refresh this tab before publishing." : "API, database, or policy registry is unavailable. Preview remains available; publishing is blocked before any wallet transaction."} <button className="underline" onClick={() => { capabilities.reload(); health.reload(); }}>Retry checks</button></p>}{balanceError && <p className="text-xs text-warn">PILOT balance could not be verified: {balanceError}</p>}{txLines.length > 0 && <div aria-live="polite" className="space-y-2 border-t border-line pt-4">{txLines.map((line,index) => <div key={index} className="rounded-md border border-line bg-ink-900 p-3"><div className="flex justify-between text-xs"><span className="font-semibold text-paper">{line.label}</span><span className={line.state === "error" ? "text-short" : line.state === "success" ? "text-long" : "text-warn"}>{line.state}</span></div><div className="mt-1 break-all font-mono text-[11px] text-muted">{line.detail}</div></div>)}</div>}{txState === "success" && <div role="status" className="border-l-2 border-long pl-3 text-xs text-long">Registry strategy #{createdId} created, bonded, and policy verified. Explorer detail becomes available when indexed. <Link to="/strategies" className="underline">Explore ↗</Link></div>}{txState === "error" && <p role="alert" className="text-xs text-short">Review the transaction log. Previously confirmed transactions remain on-chain. Retry only after checking the current registry state.</p>}</div>}
      <div className="mt-7 flex justify-between border-t border-line pt-4"><button type="button" className="cp-btn-ghost" disabled={step === 0 || busy} onClick={() => setStep(value => value-1)}>Back</button>{step < 3 && <button type="button" className="cp-btn-primary" disabled={!canProceed} onClick={() => setStep(value => value+1)}>Continue →</button>}</div>
    </section><CreateLivePreview market={market} snapshot={snapshot} source={marketResource.result?.source ?? "UNKNOWN"} thresholdBps={fundingBelowBps} side={side} notionalUsd={maxNotionalUsd} leverageX={maxLeverageX} slippageBps={maxSlippageBps} bond={bond} /></div>
  </div>;
}
