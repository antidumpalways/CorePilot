# CorePilot API

Fastify + Drizzle (PostgreSQL) read/write API for the CorePilot strategy execution layer.

## Endpoints

- `GET /api/health` — service status.
- `GET /api/markets` — distinct markets seen in `market_snapshots`.
- `GET /api/market/:symbol` — latest snapshot for a market.
- `GET /api/strategies` — list strategies.
- `GET /api/strategies/:id` — strategy detail.
- `GET /api/strategies/:id/executions` — execution attempts for a strategy.
- `POST /api/executor/evaluate/:strategyId` — stub strategy evaluation.
- `POST /api/oracle/snapshot` — insert a market snapshot.

All endpoints return JSON. Read endpoints return `{ data, db }` and degrade to
`{ data: [], db: false }` (or `null`) when `DATABASE_URL` is missing/unreachable
instead of crashing.

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
