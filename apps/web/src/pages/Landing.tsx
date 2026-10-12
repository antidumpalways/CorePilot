import { Link } from "react-router-dom";
import { DataSourceBadge } from "../components/DataSourceBadge";
import { Panel } from "../components/Panel";

const STEPS = [
  {
    tag: "01",
    title: "Non-custodial",
    body: "Capital stays in the user's own HyperCore account. CorePilot never takes custody — a revocable, trade-only agent can place and cancel orders but can never withdraw or transfer.",
  },
  {
    tag: "02",
    title: "Hard constraints",
    body: "Every strategy is bounded on-chain: market, max leverage, max slippage, max notional and expiry. Invalid executions must revert.",
  },
  {
    tag: "03",
    title: "Receipts",
    body: "Each execution attempt is evaluated and recorded — accepted or rejected — with an auditable receipt, so automation is verifiable rather than opaque.",
  },
];

export function Landing() {
  return (
    <div className="flex flex-col gap-8">
      <section className="cp-panel overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[1.4fr_1fr] md:p-10">
          <div className="flex flex-col justify-center gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <DataSourceBadge source="TESTNET" />
              <span className="cp-label">Elysium + HyperCore</span>
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-paper md:text-4xl">
              Programmable strategy execution for Elysium + HyperCore.
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Publish trigger + constraint strategies that execute against HyperCore while users
              keep custody of their capital. Bounded, revocable, and receipted.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/strategies" className="cp-btn-primary">
                Explore Strategies
              </Link>
              <Link to="/create" className="cp-btn-ghost">
                Create Strategy
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-ink-900/70 p-5">
            <div className="cp-label">Capital model</div>
            <pre className="cp-mono mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
{`USER'S HYPERCORE ACCOUNT
  capital (e.g. 10,000 USDC)
        │  revocable TRADE-ONLY agent
        ▼
   COREPILOT EXECUTOR
        │  bounded by constraints
        ▼
     HYPERCORE`}
            </pre>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-line bg-ink-800 px-3 py-2">
                <div className="cp-label">Trading capital</div>
                <div className="mt-1 text-paper">HyperCore (user)</div>
              </div>
              <div className="rounded border border-line bg-ink-800 px-3 py-2">
                <div className="cp-label">Economic security</div>
                <div className="mt-1 text-paper">PILOT</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step) => (
          <Panel key={step.tag} title={step.title} subtitle={`Step ${step.tag}`}>
            <p className="text-sm leading-relaxed text-muted">{step.body}</p>
          </Panel>
        ))}
      </section>

      <section className="cp-panel p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-paper">What this is not</h2>
            <p className="mt-1 text-xs text-muted">
              No pooled vault, no delegated custody, no APY, no return promises. CorePilot charges a
              flat service fee only when it actually performs an execution.
            </p>
          </div>
          <Link to="/monitor" className="cp-btn-ghost shrink-0">
            Open Execution Monitor
          </Link>
        </div>
      </section>
    </div>
  );
}
