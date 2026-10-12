import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { StrategyConfig } from "@corepilot/shared";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { Panel, KeyValue, Stat } from "../components/Panel";
import { EmptyState, Spinner } from "../components/Feedback";
import { ExecutionStatusBadge, StatusBadge } from "../components/StatusBadge";
import {
  fetchExecutions,
  fetchMarketData,
  fetchStrategy,
  type ExecutionView,
  type MarketView,
  type StrategyView,
} from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import {
  formatBps,
  formatFunding,
  formatNumber,
  formatTimestamp,
  formatUsd,
  shortenAddress,
  shortenHash,
} from "../lib/format";

interface OnchainState {
  config: StrategyConfig | null;
  creatorBond: bigint | null;
  executable: boolean | null;
  error: string | null;
}

function bondLabel(bond: bigint | null): string {
  if (bond === null) return "—";
  return `${formatNumber(Number(bond) / 1e18, 2)} PILOT`;
}

function ExecutionTable({ executions }: { executions: ExecutionView[] }) {
  if (executions.length === 0) {
    return (
      <EmptyState title="No executions recorded" message="Attempts will appear here once evaluated." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="cp-table min-w-[680px]">
        <thead>
          <tr>
            <th>Time</th>
            <th>Status</th>
            <th>Notional</th>
            <th>Tx hash</th>
            <th>External id / reason</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={`${execution.id}-${execution.createdAt ?? ""}`}>
              <td className="cp-mono text-muted">
                {execution.createdAt ? formatTimestamp(new Date(execution.createdAt).getTime()) : "—"}
              </td>
              <td>
                <ExecutionStatusBadge status={execution.status} />
              </td>
              <td className="cp-mono">{formatUsd(execution.requestedNotional)}</td>
              <td className="cp-mono text-muted">
                {execution.txHash ? shortenHash(execution.txHash) : "—"}
              </td>
              <td className="cp-mono">
                {execution.error ? (
                  <span className="text-short">{execution.error}</span>
                ) : (
                  <span className="text-muted">{execution.externalExecutionId ?? "—"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketPanel({ market }: { market: MarketView | null }) {
  return (
    <Panel
      title="Hyperliquid market"
      subtitle={market ? `${market.market} · snapshot` : "Awaiting data"}
      actions={market && <DataSourceBadge source={market.dataSource} />}
    >
      {market ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Mark price"
            value={formatUsd(market.markPrice)}
            hint={`source: ${market.source}`}
          />
          <Stat
            label="Funding (hourly)"
            value={formatFunding(market.fundingRateBps)}
            tone={market.fundingRateBps < 0 ? "down" : market.fundingRateBps > 0 ? "up" : "default"}
            hint={`${market.fundingRateBps.toFixed(4)} bps`}
          />
          <div className="sm:col-span-2 text-[11px] text-muted">
            Snapshot: <span className="cp-mono">{formatTimestamp(market.timestamp)}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading market data…
        </div>
      )}
    </Panel>
  );
}

function DetailView({ strategy }: { strategy: StrategyView }) {
  const marketResource = useApiResource<MarketView>(
    () => fetchMarketData(strategy.market),
    [strategy.market],
  );
  const executionsResource = useApiResource<ExecutionView[]>(
    () => fetchExecutions(strategy.id),
    [strategy.id],
  );

  const [onchain, setOnchain] = useState<OnchainState>({
    config: null,
    creatorBond: null,
    executable: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!hasContractConfig) {
      setOnchain({ config: null, creatorBond: null, executable: null, error: "SDK unconfigured" });
      return;
    }
    const client = getCorePilotClient();
    (async () => {
      try {
        const [config, creatorBond, executable] = await Promise.all([
          client.read.getStrategy(strategy.id),
          client.read.getCreatorBond(strategy.id),
          client.read.isExecutable(strategy.id),
        ]);
        if (!cancelled) setOnchain({ config, creatorBond, executable, error: null });
      } catch (error) {
        if (!cancelled) {
          setOnchain({
            config: null,
            creatorBond: null,
            executable: null,
            error: error instanceof Error ? error.message : "on-chain read failed",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy.id]);

  const market = marketResource.result?.data ?? null;
  const executions = executionsResource.result?.data ?? [];
  const accepted = executions.filter((e) => e.status.toUpperCase() === "EXECUTED");
  const rejected = executions.filter((e) => e.status.toUpperCase() !== "EXECUTED");

  const config = onchain.config;
  const marketSymbol = config?.market ?? strategy.market;
  const strategyType = config?.strategyType ?? strategy.strategyType;
  const maxLeverageBps = config?.maxLeverageBps ?? strategy.maxLeverageBps ?? null;
  const maxSlippageBps = config?.maxSlippageBps ?? strategy.maxSlippageBps ?? null;
  const maxNotionalUsd = config?.maxNotionalUsd ?? strategy.maxNotionalUsd ?? null;
  const expiry = config?.expiry ?? strategy.expiry ?? null;
  const active = config?.active ?? strategy.active;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/strategies" className="text-xs text-muted hover:text-paper">
              ← Strategies
            </Link>
          </div>
          <h1 className="mt-2 flex items-center gap-3 text-xl font-semibold text-paper">
            {strategy.name}
            <span className="cp-mono text-sm text-muted">#{strategy.id}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge active={active} />
            <DataSourceBadge source={strategy.market ? "TESTNET" : "DEMO"} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Strategy rules" subtitle="On-chain configuration + constraints">
          <KeyValue label="Market">
            <span className="cp-mono">{marketSymbol}</span>
          </KeyValue>
          <KeyValue label="Strategy type">
            <span className="cp-mono">{strategyType}</span>
          </KeyValue>
          <KeyValue label="Max leverage">
            <span className="cp-mono">
              {maxLeverageBps === null ? "—" : `${(maxLeverageBps / 100).toFixed(2)}x`}
            </span>
          </KeyValue>
          <KeyValue label="Max slippage">
            <span className="cp-mono">{formatBps(maxSlippageBps)}</span>
          </KeyValue>
          <KeyValue label="Max notional">
            <span className="cp-mono">{formatUsd(maxNotionalUsd)}</span>
          </KeyValue>
          <KeyValue label="Expiry">
            <span className="cp-mono">
              {expiry && expiry > 0 ? formatTimestamp(expiry * 1000) : "—"}
            </span>
          </KeyValue>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Creator & security" subtitle="Bonds and execution capacity">
            <KeyValue label="Creator">
              <span className="cp-mono">{shortenAddress(strategy.creator)}</span>
            </KeyValue>
            <KeyValue label="Creator bond">
              <span className="cp-mono">{bondLabel(onchain.creatorBond)}</span>
            </KeyValue>
            <KeyValue label="Execution capacity">
              {onchain.executable === null ? (
                <span className="cp-mono text-muted">—</span>
              ) : onchain.executable ? (
                <span className="text-long">Executable</span>
              ) : (
                <span className="text-short">Not executable</span>
              )}
            </KeyValue>
            <KeyValue label="Source">
              <span className="cp-mono text-muted">
                {onchain.error ? "API / demo" : "Elysium testnet"}
              </span>
            </KeyValue>
            {onchain.error && (
              <p className="pt-2 text-[11px] text-muted">{onchain.error}</p>
            )}
          </Panel>

          <MarketPanel market={market} />
        </div>
      </div>

      <Panel
        title="Execution history"
        subtitle={`${accepted.length} accepted · ${rejected.length} rejected`}
        actions={executionsResource.result && <DataSourceBadge source={executionsResource.result.source} />}
        bodyClassName="p-0"
      >
        <ExecutionTable executions={executions} />
      </Panel>
    </div>
  );
}

export function StrategyDetail() {
  const { id } = useParams();
  const strategyId = Number(id);
  const { result, loading, reload } = useApiResource<StrategyView | null>(
    () => fetchStrategy(strategyId),
    [strategyId],
  );

  if (loading && !result) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Spinner /> Loading strategy…
      </div>
    );
  }

  const strategy = result?.data ?? null;
  if (!strategy) {
    return (
      <EmptyState
        title="Strategy not found"
        message={`No strategy with id #${id}.`}
        action={
          <button type="button" className="cp-btn-ghost mt-1" onClick={reload}>
            Retry
          </button>
        }
      />
    );
  }

  return <DetailView strategy={strategy} />;
}
