# CorePilot API

Fastify + Drizzle (PostgreSQL) read/write API for the CorePilot strategy execution layer.

## Endpoints

- `GET /api/health` — component health and data provenance.
- `GET /api/capabilities` — supported/planned signals and actions, network,
  contract configuration, and executor instrumentation status.
- `GET /api/markets` — distinct markets seen in `market_snapshots`.
- `GET /api/market/:symbol` — latest snapshot for a market.
- `GET /api/strategies` — list strategies.
- `GET /api/strategies/:id` — strategy detail.
- `GET /api/strategies/:id/executions` — execution attempts for a strategy.
- `POST /api/executor/evaluate/:strategyId` — returns a generic evaluation
  pipeline; it fails closed while strategy policy and controller limits remain
  unavailable from authoritative sources. Its top-level status is `REQUIRES_POLICY`,
  `signal.matched` and `policy.allowed` are `null`, `constraints.ok` is `false`,
  and intent, action, and receipt are `null`. Preview fields are validated but ignored
  as non-authoritative.
- `POST /api/oracle/snapshot` — insert a market snapshot.

All endpoints return JSON. Read endpoints return `{ data, db }` and degrade to
`{ data: [], db: false }` (or `null`) when `DATABASE_URL` is missing/unreachable
instead of crashing.

Strategy responses use normalized fields. The current database index does not
store signal parameters, action, execution constraints, active state, or expiry;
these fields are returned as `null` instead of inferred from legacy strategy
type strings. Existing indexed records receive `unknown` provenance; seeded
records use `demo`. Evaluation does not dispatch execution or produce
receipts. Executor health is `not_instrumented` until the executor reports a
heartbeat.

## Scripts

```bash
pnpm --filter @corepilot/api dev        # tsx watch
pnpm --filter @corepilot/api start      # tsx
pnpm --filter @corepilot/api typecheck  # tsc --noEmit
pnpm --filter @corepilot/api db:push    # drizzle-kit push
pnpm --filter @corepilot/api seed       # seed sample data
```

## Environment

Copy `.env.example` to `.env` and set:

```
DATABASE_URL=postgresql://corepilot:corepilot@localhost:5432/corepilot
API_PORT=8001
```

The server listens on `API_PORT`, then `PORT`, then `8001`.
