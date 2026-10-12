import { useState } from "react";
import type { WalletClient } from "viem";
import { parseUnits } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import {
  DEFAULT_EXECUTION_FEE_USD,
  PILOT_DISCOUNT_BPS,
} from "@corepilot/shared";
import { Panel, KeyValue, Stat } from "../components/Panel";
import { Spinner } from "../components/Feedback";
import { WalletButton } from "../components/WalletButton";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { fetchMarkets } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import { formatBps, formatFunding, formatNumber, formatUsd } from "../lib/format";

const STEPS = ["Market", "Trigger", "Constraints", "PILOT bond", "Review", "Sign"] as const;

type LogStatus = "info" | "ok" | "error";

interface LogEntry {
  label: string;
  detail: string;
  status: LogStatus;
}

const DEFAULT_MARKETS = ["HYPE", "BTC", "ETH"];

export function CreateStrategy() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const marketsResource = useApiResource<string[]>(fetchMarkets, []);

  const [step, setStep] = useState(0);
  const [market, setMarket] = useState("HYPE");
  const [fundingBelowBps, setFundingBelowBps] = useState(-1);
  const [side, setSide] = useState<"long" | "short">("long");
  const [maxLeverageX, setMaxLeverageX] = useState(3);
  const [maxSlippageBps, setMaxSlippageBps] = useState(50);
  const [maxNotionalUsd, setMaxNotionalUsd] = useState(25000);
  const [expiryHours, setExpiryHours] = useState(24);
  const [bond, setBond] = useState(5000);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const markets = marketsResource.result?.data?.length
    ? marketsResource.result.data
    : DEFAULT_MARKETS;

  const maxLeverageBps = maxLeverageX * 100;
  const expiryUnix = Math.floor(Date.now() / 1000) + expiryHours * 3600;
  const discountedFee = DEFAULT_EXECUTION_FEE_USD * (1 - PILOT_DISCOUNT_BPS / 10_000);

  const canSign = isConnected && Boolean(walletClient) && hasContractConfig && !busy;

  function push(entry: LogEntry) {
    setLog((entries) => [...entries, entry]);
  }

  async function sign() {
    if (!walletClient) return;
    setBusy(true);
    setLog([{ label: "Session", detail: "Submitting strategy transactions…", status: "info" }]);
    const writer = walletClient as unknown as WalletClient;
    try {
      const client = getCorePilotClient();
      const staking = client.addresses.staking;
      if (!staking) throw new Error("staking address not configured");

      let predictedId = 0;
      try {
        predictedId = await client.read.nextStrategyId();
        push({ label: "Registry", detail: `Next strategy id: #${predictedId}`, status: "info" });
      } catch {
        push({ label: "Registry", detail: "Could not read next id; continuing", status: "info" });
      }

      const bondWei = parseUnits(String(bond), 18);

      const approveHash = await client.write.approvePilot(writer, staking, bondWei);
      push({ label: "Approve PILOT", detail: approveHash, status: "ok" });

      const createHash = await client.write.createStrategy(writer, {
        market,
        strategyType: "FUNDING_TRIGGER",
        maxLeverageBps,
        maxSlippageBps,
        maxNotionalUsd,
        expiry: expiryUnix,
      });
      push({ label: "createStrategy", detail: createHash, status: "ok" });

      if (predictedId > 0) {
        const stakeHash = await client.write.stakeCreator(writer, predictedId, bondWei);
        push({
          label: "stakeCreator",
          detail: `${formatNumber(bond, 0)} PILOT → #${predictedId} · ${stakeHash}`,
          status: "ok",
        });
      } else {
        push({
          label: "stakeCreator",
          detail: "Skipped — strategy id unknown (stake manually).",
          status: "info",
        });
      }

      push({ label: "Done", detail: "Strategy submitted. Await confirmations.", status: "ok" });
    } catch (error) {
      push({
        label: "Error",
        detail: error instanceof Error ? error.message : "transaction failed",
        status: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const isLast = step === STEPS.length - 1;
  const canNext =
    step === 0
      ? Boolean(market)
      : step === 1
        ? Number.isFinite(fundingBelowBps)
        : step === 2
          ? maxLeverageX > 0 && maxSlippageBps > 0 && maxNotionalUsd > 0 && expiryHours > 0
          : step === 3
            ? bond > 0
            : true;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-paper">Create Strategy</h1>
        <p className="mt-1 text-sm text-muted">
          Define a trigger plus hard constraints, back it with a PILOT creator bond, and sign.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
              index === step
                ? "border-accent/60 bg-accent/15 text-accent"
                : index < step
                  ? "border-line bg-ink-700 text-paper"
                  : "border-line bg-ink-900 text-muted"
            }`}
          >
            <span className="cp-mono">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel title={STEPS[step]} subtitle={`Step ${step + 1} of ${STEPS.length}`}>
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="cp-label" htmlFor="market">
                  Market
                </label>
                <select
                  id="market"
                  className="cp-input mt-1.5"
                  value={market}
                  onChange={(event) => setMarket(event.target.value)}
                >
                  {markets.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted">
                Only markets with a configured data source and allowed adapter can execute. This MVP
                targets Hyperliquid markets.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="cp-label" htmlFor="funding">
                    Trigger: funding below (bps)
                  </label>
                  <input
                    id="funding"
                    type="number"
                    step="0.1"
                    className="cp-input cp-mono mt-1.5"
                    value={fundingBelowBps}
                    onChange={(event) => setFundingBelowBps(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label className="cp-label" htmlFor="side">
                    Side
                  </label>
                  <select
                    id="side"
                    className="cp-input mt-1.5"
                    value={side}
                    onChange={(event) => setSide(event.target.value === "short" ? "short" : "long")}
                  >
                    <option value="long">long</option>
                    <option value="short">short</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted">
                Fires when the hourly funding rate is below the threshold (
                <span className="cp-mono">{formatFunding(fundingBelowBps)}</span>). Trigger params are
                kept off-chain for this MVP; constraints are enforced on-chain.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="cp-label" htmlFor="leverage">
                    Max leverage (x)
                  </label>
                  <input
                    id="leverage"
                    type="number"
                    min={1}
                    max={20}
                    className="cp-input cp-mono mt-1.5"
                    value={maxLeverageX}
                    onChange={(event) => setMaxLeverageX(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label className="cp-label" htmlFor="slippage">
                    Max slippage (bps)
                  </label>
                  <input
                    id="slippage"
                    type="number"
                    min={1}
                    className="cp-input cp-mono mt-1.5"
                    value={maxSlippageBps}
                    onChange={(event) => setMaxSlippageBps(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label className="cp-label" htmlFor="notional">
                    Max notional (USD)
                  </label>
                  <input
                    id="notional"
                    type="number"
                    min={1}
                    className="cp-input cp-mono mt-1.5"
                    value={maxNotionalUsd}
                    onChange={(event) => setMaxNotionalUsd(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label className="cp-label" htmlFor="expiry">
                    Expiry (hours)
                  </label>
                  <input
                    id="expiry"
                    type="number"
                    min={1}
                    className="cp-input cp-mono mt-1.5"
                    value={expiryHours}
                    onChange={(event) => setExpiryHours(Number(event.target.value))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted">
                These are hard on-chain limits. Any execution that breaches them must revert.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="cp-label" htmlFor="bond">
                  Creator bond (PILOT)
                </label>
                <input
                  id="bond"
                  type="number"
                  min={0}
                  className="cp-input cp-mono mt-1.5"
                  value={bond}
                  onChange={(event) => setBond(Number(event.target.value))}
                />
              </div>
              <p className="text-xs text-muted">
                A PILOT bond is required to publish a public strategy. It provides economic security —
                it is not trading capital and does not determine exposure.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-1">
              <KeyValue label="Market">
                <span className="cp-mono">{market}</span>
              </KeyValue>
              <KeyValue label="Trigger">
                <span className="cp-mono">
                  funding &lt; {formatFunding(fundingBelowBps)} · {side}
                </span>
              </KeyValue>
              <KeyValue label="Max leverage">
                <span className="cp-mono">{maxLeverageX.toFixed(2)}x</span>
              </KeyValue>
              <KeyValue label="Max slippage">
                <span className="cp-mono">{formatBps(maxSlippageBps)}</span>
              </KeyValue>
              <KeyValue label="Max notional">
                <span className="cp-mono">{formatUsd(maxNotionalUsd)}</span>
              </KeyValue>
              <KeyValue label="Expiry">
                <span className="cp-mono">{expiryHours}h</span>
              </KeyValue>
              <KeyValue label="Creator bond">
                <span className="cp-mono">{formatNumber(bond, 0)} PILOT</span>
              </KeyValue>
              <KeyValue label="Execution fee">
                <span className="cp-mono">{formatUsd(DEFAULT_EXECUTION_FEE_USD)}</span>
              </KeyValue>
              <KeyValue label="Fee in PILOT (discount)">
                <span className="cp-mono text-long">
                  {formatUsd(discountedFee)} (−{(PILOT_DISCOUNT_BPS / 100).toFixed(0)}%)
                </span>
              </KeyValue>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-4">
              {!hasContractConfig && (
                <div className="rounded-md border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-warn">
                  Contract addresses are not configured. Set the VITE_*_ADDRESS variables to sign.
                </div>
              )}
              {!isConnected ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">Connect a wallet to submit the strategy.</p>
                  <div>
                    <WalletButton />
                  </div>
                </div>
              ) : (
                <button type="button" className="cp-btn-primary" disabled={!canSign} onClick={sign}>
                  {busy && <Spinner className="h-3.5 w-3.5" />}
                  Sign &amp; submit strategy
                </button>
              )}

              {log.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {log.map((entry, index) => (
                    <li
                      key={`${entry.label}-${index}`}
                      className="rounded-md border border-line bg-ink-900/60 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-paper">{entry.label}</span>
                        <span
                          className={`cp-label ${
                            entry.status === "ok"
                              ? "text-long"
                              : entry.status === "error"
                                ? "text-short"
                                : "text-muted"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                      <div className="cp-mono mt-1 break-all text-[11px] text-muted">
                        {entry.detail}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
            <button
              type="button"
              className="cp-btn-ghost"
              disabled={step === 0 || busy}
              onClick={() => setStep((value) => Math.max(0, value - 1))}
            >
              Back
            </button>
            {!isLast ? (
              <button
                type="button"
                className="cp-btn-primary"
                disabled={!canNext}
                onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
              >
                Continue
              </button>
            ) : null}
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel
            title="Markets"
            subtitle="Available from the API"
            actions={marketsResource.result && <DataSourceBadge source={marketsResource.result.source} />}
          >
            <div className="flex flex-wrap gap-2">
              {markets.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cp-btn ${
                    market === option ? "border-accent/60 bg-accent/15 text-accent" : "bg-ink-700"
                  }`}
                  onClick={() => setMarket(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Stat label="Max leverage" value={`${maxLeverageX.toFixed(2)}x`} hint={formatBps(maxLeverageBps)} />
            <Stat label="Max notional" value={formatUsd(maxNotionalUsd)} hint="Bounded exposure" />
            <Stat label="Creator bond" value={`${formatNumber(bond, 0)} PILOT`} hint="Economic security" />
          </div>
        </div>
      </div>
    </div>
  );
}
