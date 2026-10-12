import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { Panel, Stat } from "../components/Panel";
import { EmptyState, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import {
  evaluateStrategy,
  fetchMarketData,
  fetchStrategies,
  type ApiResult,
  type EvaluateResult,
  type MarketView,
  type StrategyView,
} from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { formatFunding, formatTimestamp, formatUsd } from "../lib/format";

const POLL_MS = 5000;

const STEP_ORDER = ["leverage", "slippage", "notional", "market"] as const;
const STEP_LABELS: Record<string, string> = {
  leverage: "leverage",
  slippage: "slippage",
  notional: "capacity",
  market: "market",
};

function StepList({ evaluation }: { evaluation: EvaluateResult }) {
  return (
    <div className="flex flex-col gap-2">
      {STEP_ORDER.map((key) => {
        const checked = evaluation.constraints.checked[key] ?? true;
        const label = STEP_LABELS[key] ?? key;
        return (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className={checked ? "text-long" : "text-short"}>{checked ? "✓" : "✗"}</span>
            <span className={checked ? "text-paper" : "text-short"}>{label}</span>
          </div>
        );
      })}
      <div className="mt-1 border-t border-line pt-3">
        {evaluation.constraints.ok ? (
          <div className="inline-flex items-center gap-2 rounded border border-long/40 bg-long/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-long">
            Execution accepted
          </div>
        ) : (
          <div className="rounded border border-short/40 bg-short/10 px-3 py-1.5 text-xs text-short">
            Rejected: {evaluation.constraints.violations.join(", ") || "constraint violation"}
          </div>
        )}
      </div>
    </div>
  );
}

export function Monitor() {
  const { id } = useParams();
  const strategiesResource = useApiResource<StrategyView[]>(fetchStrategies, []);
  const strategies = strategiesResource.result?.data ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(id ? Number(id) : null);
  const [polling, setPolling] = useState(true);
  const [marketResult, setMarketResult] = useState<ApiResult<MarketView> | null>(null);
  const [evaluation, setEvaluation] = useState<ApiResult<EvaluateResult> | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (selectedId !== null) return;
    const first = strategies[0];
    if (first) setSelectedId(first.id);
  }, [strategies, selectedId]);

  const selectedStrategy = strategies.find((s) => s.id === selectedId) ?? null;
  const marketSymbol = selectedStrategy?.market ?? "HYPE";

  const runOnce = useCallback(async () => {
    if (selectedId === null) return;
    const marketRes = await fetchMarketData(marketSymbol);
    setMarketResult(marketRes);
    const data = marketRes.data;
    const evaluationRes = await evaluateStrategy(selectedId, {
      market: data.market,
      markPrice: data.markPrice,
      fundingRateBps: data.fundingRateBps,
      side: "long",
    });
    setEvaluation(evaluationRes);
    setLastUpdated(Date.now());
  }, [selectedId, marketSymbol]);

  useEffect(() => {
    void runOnce();
  }, [runOnce]);

  useEffect(() => {
    if (!polling || selectedId === null) return;
    const timer = setInterval(() => {
      void runOnce();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, selectedId, runOnce]);

  const market = marketResult?.data ?? null;
  const evalData = evaluation?.data ?? null;
  const triggered = evalData?.triggered ?? false;

  const triggerLabel =
    evaluation?.data.dataSource === "SIMULATED"
      ? "funding < -1.00 bps"
      : "funding < 0.00 bps (server stub)";

  const currentValue = evalData?.request ? formatUsd(evalData.request.notionalUsd) : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-paper">Execution Monitor</h1>
          <p className="mt-1 text-sm text-muted">
            Live-ish evaluation of the strategy trigger and constraints.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {triggered ? (
              <span className="inline-flex items-center gap-1.5 rounded border border-long/40 bg-long/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-long">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-long" />
                Triggered
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                Idle
              </span>
            )}
            {marketResult && <DataSourceBadge source={marketResult.source} />}
            {evaluation && <DataSourceBadge source={evaluation.source} />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="cp-input w-56"
            value={selectedId ?? ""}
            onChange={(event) => setSelectedId(Number(event.target.value))}
          >
            {strategies.length === 0 && <option value="">No strategies</option>}
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                #{strategy.id} · {strategy.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`cp-btn ${polling ? "border-long/50 bg-long/10 text-long" : "bg-ink-700"}`}
            onClick={() => setPolling((value) => !value)}
          >
            {polling ? "Polling on" : "Polling off"}
          </button>
          <button type="button" className="cp-btn-ghost" onClick={() => void runOnce()}>
            Run once
          </button>
        </div>
      </div>

      {(marketResult?.error || evaluation?.error) && (
        <div className="rounded-md border border-purple-400/30 bg-purple-400/10 px-4 py-2.5 text-xs text-purple-200">
          API unavailable — showing SIMULATED evaluation. {marketResult?.error ?? evaluation?.error}
        </div>
      )}

      {selectedId === null ? (
        <EmptyState
          title="No strategy selected"
          message="Register a strategy, then select it here to monitor execution."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6">
            <Panel title="Market" subtitle={market ? market.market : "Awaiting data"}>
              {market ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat label="Mark price" value={formatUsd(market.markPrice)} hint={`source: ${market.source}`} />
                  <Stat
                    label="Funding (hourly)"
                    value={formatFunding(market.fundingRateBps)}
                    tone={market.fundingRateBps < 0 ? "down" : market.fundingRateBps > 0 ? "up" : "default"}
                    hint={`${market.fundingRateBps.toFixed(4)} bps`}
                  />
                  <Stat label="Trigger" value={triggerLabel} hint="Condition" />
                  <Stat
                    label="Current value"
                    value={currentValue}
                    hint="Bounded notional for this execution"
                    tone={triggered ? "up" : "default"}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner /> Loading market data…
                </div>
              )}
            </Panel>

            <Panel
              title="Strategy"
              subtitle={selectedStrategy ? selectedStrategy.name : `#${selectedId}`}
              actions={selectedStrategy && <StatusBadge active={selectedStrategy.active} />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="Market" value={marketSymbol} />
                <Stat label="Type" value={selectedStrategy?.strategyType ?? "FUNDING_TRIGGER"} />
              </div>
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <Panel title="Constraint gate" subtitle="Executor checks before acceptance">
              {evalData ? (
                <StepList evaluation={evalData} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner /> Evaluating…
                </div>
              )}
            </Panel>

            <Panel title="Session" subtitle="Polling metadata">
              <div className="flex flex-col gap-2 text-xs text-muted">
                <div className="flex items-center justify-between">
                  <span>Interval</span>
                  <span className="cp-mono">{POLL_MS / 1000}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last update</span>
                  <span className="cp-mono">{lastUpdated ? formatTimestamp(lastUpdated) : "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Strategy</span>
                  <span className="cp-mono">#{selectedId}</span>
                </div>
              </div>
              {evalData && (
                <div className="mt-3 border-t border-line-soft pt-3 text-[11px] text-muted">
                  Fee preview:{" "}
                  <span className="cp-mono text-paper">{formatUsd(evalData.feePreview.feeUsd)}</span>{" "}
                  · PILOT discount{" "}
                  <span className="cp-mono text-long">
                    {(evalData.feePreview.pilotDiscountBps / 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
