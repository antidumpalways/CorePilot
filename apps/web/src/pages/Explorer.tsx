import { Link } from "react-router-dom";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { Panel, Stat } from "../components/Panel";
import { EmptyState, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { fetchStrategies, type StrategyView } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { formatNumber, shortenAddress } from "../lib/format";

function backingLabel(value: number | null): string {
  if (value === null) return "—";
  return `${formatNumber(value, 0)} PILOT`;
}

function executionsLabel(value: number | null): string {
  if (value === null) return "—";
  return formatNumber(value, 0);
}

export function Explorer() {
  const { result, loading, reload } = useApiResource<StrategyView[]>(fetchStrategies, []);
  const strategies = result?.data ?? [];
  const activeCount = strategies.filter((s) => s.active).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-paper">Strategy Explorer</h1>
          <p className="mt-1 text-sm text-muted">
            Registered strategies, their markets, PILOT backing and execution activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && <DataSourceBadge source={result.source} />}
          <button type="button" className="cp-btn-ghost" onClick={reload} disabled={loading}>
            {loading && <Spinner className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Strategies" value={formatNumber(strategies.length, 0)} hint="Registered" />
        <Stat label="Active" value={formatNumber(activeCount, 0)} hint="Currently executable" />
        <Stat
          label="Markets"
          value={formatNumber(new Set(strategies.map((s) => s.market)).size, 0)}
          hint="Distinct venues"
        />
      </div>

      {result?.error && (
        <div className="rounded-md border border-purple-400/30 bg-purple-400/10 px-4 py-2.5 text-xs text-purple-200">
          API unavailable ({result.error}) — showing DEMO DATA.
        </div>
      )}

      <Panel
        title="Strategies"
        subtitle={loading ? "Loading…" : `${strategies.length} result(s)`}
        bodyClassName="p-0"
      >
        {loading && strategies.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
            <Spinner /> Loading strategies…
          </div>
        ) : strategies.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No strategies registered"
              message="Register a strategy to see it appear here."
              action={
                <Link to="/create" className="cp-btn-primary mt-1">
                  Create Strategy
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="cp-table min-w-[720px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Strategy</th>
                  <th>Market</th>
                  <th>Creator</th>
                  <th>PILOT backing</th>
                  <th>Executions</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => (
                  <tr key={strategy.id}>
                    <td className="cp-mono text-muted">{strategy.id}</td>
                    <td>
                      <Link
                        to={`/strategies/${strategy.id}`}
                        className="font-medium text-paper hover:text-accent"
                      >
                        {strategy.name}
                      </Link>
                      <div className="cp-mono mt-0.5 text-[11px] text-muted">
                        {strategy.strategyType}
                      </div>
                    </td>
                    <td className="cp-mono">{strategy.market}</td>
                    <td className="cp-mono text-muted">{shortenAddress(strategy.creator)}</td>
                    <td className="cp-mono">{backingLabel(strategy.pilotBacking)}</td>
                    <td className="cp-mono">{executionsLabel(strategy.executions)}</td>
                    <td>
                      <StatusBadge active={strategy.active} />
                    </td>
                    <td className="text-right">
                      <Link to={`/strategies/${strategy.id}`} className="cp-btn-ghost">
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
