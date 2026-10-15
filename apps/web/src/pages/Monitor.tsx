import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { EmptyState, Spinner } from "../components/Feedback";
import { SystemHealth } from "../components/SystemHealth";
import { evaluateStrategy, fetchHealth, fetchMarketData, fetchStrategies, type ApiResult, type EvaluateResult, type HealthResult, type MarketView, type StrategyView } from "../lib/api";
import { useApiResource } from "../lib/useApi";
import { formatFunding, formatTimestamp, formatUsd } from "../lib/format";

const POLL_MS = 5000;
const DEMO_THRESHOLD_BPS = -1;
type Mode = "API" | "DEMO";
type Scenario = "matched" | "unmatched" | "constraint";

function Stage({ index, label, detail, status }: { index: number; label: string; detail: string; status: string }) {
  const positive = status === "MATCHED" || status === "READY" || status === "PASSED";
  return <li className="flex gap-3 border-b border-line-soft py-3">
    <span className={`grid h-7 w-7 shrink-0 place-items-center border font-mono text-[10px] ${positive ? "border-long/40 text-long" : "border-line text-muted"}`}>{String(index).padStart(2, "0")}</span>
    <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-paper">{label}</div><div className="mt-1 text-[11px] text-muted">{detail}</div></div>
    <span className={`shrink-0 font-mono text-[10px] ${positive ? "text-long" : status === "BLOCKED" ? "text-warn" : "text-muted"}`}>{status}</span>
  </li>;
}

export function Monitor() {
  const { id } = useParams();
  const strategiesResource = useApiResource<StrategyView[]>(fetchStrategies, []);
  const health = useApiResource<HealthResult | null>(fetchHealth, []);
  const strategies = strategiesResource.result?.data ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(id ? Number(id) : null);
  const [mode, setMode] = useState<Mode>("API");
  const [scenario, setScenario] = useState<Scenario>("matched");
  const [polling, setPolling] = useState(false);
  const [marketResult, setMarketResult] = useState<ApiResult<MarketView> | null>(null);
  const [evaluation, setEvaluation] = useState<ApiResult<EvaluateResult | null> | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);


  useEffect(() => { if (selectedId === null && strategies[0]) setSelectedId(strategies[0].id); }, [selectedId, strategies]);
  useEffect(() => { if (id && Number(id) !== selectedId) setSelectedId(Number(id)); }, [id, selectedId]);
  const strategy = strategies.find(item => item.id === selectedId) ?? null;
  const runOnce = useCallback(async () => {
    if (!strategy || mode !== "API") return;
    setBusy(true);
    try {
      const [market, result] = await Promise.all([fetchMarketData(strategy.market), evaluateStrategy(strategy.id)]);
      setMarketResult(market);
      setEvaluation(result);
      setLastUpdated(Date.now());
    } finally { setBusy(false); }
  }, [strategy, mode]);
  useEffect(() => { void runOnce(); }, [runOnce]);
  useEffect(() => { if (!polling || mode !== "API") return; const timer = setInterval(() => { void runOnce(); }, POLL_MS); return () => clearInterval(timer); }, [polling, mode, runOnce]);

  const result = mode === "API" ? evaluation?.data : null;
  const demoMatched = scenario !== "unmatched";
  const demoConstraintPassed = scenario !== "constraint";
  const demoFunding = scenario === "unmatched" ? -0.4 : -1.82;
  const stages = mode === "API" ? [
    ["Signal", result?.signal.type === "funding_rate" ? "Funding Rate · evidence not verified" : "Funding Rate · no authoritative evidence", "UNVERIFIED"],
    ["Action / intent", "No normalized intent produced", "NOT BUILT"],
    ["Policy", result?.policy.reason ?? "Awaiting API evaluation", result ? "BLOCKED" : "PENDING"],
    ["Constraints", result?.constraints.reason ?? "No authoritative limits checked", "UNVERIFIED"],
    ["Execution", "No adapter dispatch requested", "NOT REQUESTED"],
    ["Receipt", "No receipt recorded; venue fill not confirmed", "NONE"],
  ] : [
    ["Signal", `Sample funding ${demoFunding.toFixed(2)} bps ${demoMatched ? "<" : "≥"} ${DEMO_THRESHOLD_BPS.toFixed(2)} bps`, demoMatched ? "MATCHED" : "NOT MATCHED"],
    ["Action / intent", demoMatched ? "Sample intent · OPEN LONG · $1,000" : "No sample intent", demoMatched ? "READY" : "NONE"],
    ["Policy", demoMatched ? "Sample condition allows intent" : "Sample condition denies intent", demoMatched ? "PASSED" : "BLOCKED"],
    ["Constraints", !demoMatched ? "Not checked" : demoConstraintPassed ? "Illustrative limits pass" : "Illustrative notional limit fails", !demoMatched ? "SKIPPED" : demoConstraintPassed ? "PASSED" : "BLOCKED"],
    ["Execution", "Simulation only · no adapter dispatch", "NOT REQUESTED"],
    ["Receipt", "No chain or venue receipt", "NONE"],
  ];

  return <div className="space-y-7">
    <div><div className="cp-kicker">Operations / execution</div><h1 className="cp-page-title mt-2">Execution Monitor</h1><p className="cp-page-subtitle">Signal → Action / Intent → Policy → Constraints → Execution → Receipt</p></div>
    <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-3"><div className="flex gap-1" role="group" aria-label="Monitor mode"><button type="button" aria-pressed={mode === "API"} className={mode === "API" ? "cp-btn-primary" : "cp-btn-ghost"} onClick={() => setMode("API")}>API evaluation</button><button type="button" aria-pressed={mode === "DEMO"} className={mode === "DEMO" ? "cp-btn-primary" : "cp-btn-ghost"} onClick={() => { setMode("DEMO"); setPolling(false); }}>Demo simulation</button></div>{mode === "DEMO" ? <DataSourceBadge source="SIMULATED" /> : <DataSourceBadge source={evaluation?.source ?? "UNKNOWN"} />}</div>
    {mode === "DEMO" && <div role="status" className="border-l-2 border-warn pl-3 text-xs text-warn">Illustrative local scenario. It does not read strategy policy, submit an adapter request, or write a receipt.</div>}
    {mode === "API" && evaluation?.error && <div role="status" className="border-l-2 border-warn pl-3 text-xs text-warn">API evaluation unavailable: {evaluation.error}. No simulated result has replaced it.</div>}
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,.8fr)]">
      <div className="min-w-0 space-y-7">
        <div className="flex flex-col gap-3 sm:flex-row"><select aria-label="Strategy" className="cp-input min-w-0 flex-1" value={selectedId ?? ""} onChange={event => setSelectedId(Number(event.target.value))}>{strategies.length === 0 && <option value="">Loading strategies</option>}{strategies.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.name}</option>)}</select>{mode === "API" && <><button type="button" className="cp-btn-primary shrink-0" disabled={busy || !strategy} onClick={() => void runOnce()}>{busy && <Spinner className="h-3.5 w-3.5" />}{busy ? "Evaluating…" : "Run evaluation"}</button><button type="button" className="cp-btn-ghost" onClick={() => setPolling(!polling)}>{polling ? "Pause polling" : "Poll every 5s"}</button></>}</div>
        {mode === "DEMO" && <div className="flex flex-wrap gap-2" role="group" aria-label="Demo scenario">{([ ["matched", "Condition matched"], ["unmatched", "No match"], ["constraint", "Constraint fails"] ] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={scenario === value} className={scenario === value ? "cp-btn-primary" : "cp-btn-ghost"} onClick={() => setScenario(value)}>{label}</button>)}</div>}
        {strategy ? <><div className="grid gap-4 border-y border-line-soft py-4 sm:grid-cols-3"><div><div className="cp-kicker">WHEN · signal</div><div className="mt-2 text-sm text-paper">Funding Rate</div><div className="mt-1 text-[11px] text-muted">{mode === "DEMO" ? `${demoFunding.toFixed(2)} bps · sample` : "Threshold not verified"}</div></div><div><div className="cp-kicker">THEN · action</div><div className="mt-2 text-sm text-paper">Open position</div><div className="mt-1 text-[11px] text-muted">{mode === "DEMO" ? "Illustrative LONG intent" : "Action not verified"}</div></div><div><div className="cp-kicker">WITH · constraints</div><div className="mt-2 text-sm text-paper">Bounded execution</div><div className="mt-1 text-[11px] text-muted">{mode === "DEMO" ? "Illustrative limits" : "On-chain limits not checked by API"}</div></div></div>
          <section className="border-t border-line pt-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-[15px] font-semibold text-paper">Execution pipeline</h2>{lastUpdated && mode === "API" && <span className="font-mono text-[10px] text-muted">{new Date(lastUpdated).toLocaleTimeString("en-US", { hour12: false })}</span>}</div><ol>{stages.map(([label,detail,status], index) => <Stage key={label} index={index+1} label={label} detail={detail} status={status} />)}</ol></section>
          {mode === "API" && <section className="border-t border-line pt-5"><h2 className="text-[15px] font-semibold text-paper">Evaluation log</h2><div className="mt-3 space-y-2 font-mono text-[11px] text-muted"><div>STATUS&nbsp;&nbsp; {result?.status ?? "UNAVAILABLE"}</div><div>REASON&nbsp;&nbsp; {result?.reason ?? evaluation?.error ?? "Awaiting response"}</div><div>PREVIEW {result?.previewInputs ?? "NOT SENT"}</div><div>FILL&nbsp;&nbsp;&nbsp; NOT CONFIRMED</div></div></section>}
        </> : <EmptyState title="No strategy available" message="Wait for the registry or configure a strategy." />}
      </div>
      <aside className="min-w-0 space-y-7 xl:border-l xl:border-line-soft xl:pl-8">
        <section><div className="flex items-center justify-between gap-3 border-b border-line pb-4"><h2 className="text-[15px] font-semibold text-paper">Market snapshot</h2>{mode === "API" && marketResult && <DataSourceBadge source={marketResult.source} />}</div>{mode === "DEMO" ? <div className="mt-4 text-xs text-muted">Scenario input: {demoFunding.toFixed(2)} bps · simulated</div> : <><div className="mt-3 font-mono text-xs text-muted">{marketResult?.data.market ?? "—"}</div><div className="mt-4 grid grid-cols-2 gap-5"><div><div className="cp-label">Mark price</div><div className="mt-2 font-mono text-lg text-paper">{formatUsd(marketResult?.data.markPrice)}</div></div><div><div className="cp-label">Funding / hour</div><div className="mt-2 font-mono text-lg text-paper">{formatFunding(marketResult?.data.fundingRateBps)}</div></div></div><div className="mt-4 text-[11px] text-muted">Updated {formatTimestamp(marketResult?.data.timestamp)}</div><div className="mt-2 text-[11px] text-muted">Context only · not evidence used by API evaluation.</div></>}</section>
        <section><div className="border-b border-line pb-4"><h2 className="text-[15px] font-semibold text-paper">Execution truth</h2></div><dl className="text-xs">{[["Policy", mode === "API" ? "Unavailable" : "Sample only"], ["Adapter", "Not requested"], ["Venue fill", "Not confirmed"]].map(([label,value]) => <div key={label} className="flex justify-between gap-4 border-b border-line-soft py-3"><dt className="text-muted">{label}</dt><dd className="text-right text-paper">{value}</dd></div>)}</dl></section>
        <SystemHealth health={health.result?.data ?? null} loading={health.loading && !health.result} unavailable={Boolean(health.result?.error)} />
      </aside>
    </div>
  </div>;
}
