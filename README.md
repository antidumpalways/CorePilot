# CorePilot

**Programmable strategy execution layer for Elysium + HyperCore.**

CorePilot lets strategy creators define automated trading strategies that execute against
HyperCore while users **keep custody of their capital** in their own HyperCore accounts (via a
revocable, trade-only agent).

- On-chain on **Elysium**: strategy registry, user authorization, constraint enforcement, fee
  accounting, execution receipts.
- Execution: MVP runs through an **executor + Hyperliquid agent API** today; migrates to
  Elysium's **native HyperCore precompile + CoreWriter** later (same interfaces).
- Token: **$PILOT** — creator bond, executor bond, registration burn, usage-driven
  buyback/burn. Launch via **Ascend** at Elysium mainnet.

## Docs

- [docs/architecture.md](./docs/architecture.md) — system design.
- [docs/deploy-testnet.md](./docs/deploy-testnet.md) — deploy to Elysium testnet.

## Repository layout

```
CorePilot/
├── apps/
│   ├── web/            # dashboard (React + Vite + Tailwind + wagmi)
│   ├── api/            # REST API (Fastify + Drizzle + Postgres)
│   └── executor/       # off-chain executor (data → evaluate → execute)
├── packages/
│   ├── contracts/      # Foundry (Solidity)
│   ├── sdk/            # @corepilot/sdk (viem client + ABIs)
│   └── shared/         # @corepilot/shared (types + constants)
├── docs/
├── pnpm-workspace.yaml
└── package.json
```

## Quickstart

```bash
pnpm install
pnpm -r --if-present typecheck      # all TS packages
```

### Executor (demo mode, live Hyperliquid data — no chain config needed)

```bash
pnpm --filter @corepilot/executor start
```

### Contracts (requires Foundry)

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd packages/contracts
forge install foundry-rs/forge-std
forge test -vv
```

### Web

```bash
pnpm --filter @corepilot/web dev
```

### API

```bash
cp apps/api/.env.example apps/api/.env      # optional DATABASE_URL
pnpm --filter @corepilot/api dev            # degrades gracefully without a DB
```

## Status

Early stage. Contracts, SDK, executor, API, and web app are scaffolded and typecheck/build
clean. MVP scope is a single `HYPE Funding Trigger` strategy executed on testnet.

## Non-negotiables

- Not a DEX, wallet, custodial fund, bot, or copy-trading product.
- CorePilot never takes custody of trading capital.
- Do not fake Elysium's native interfaces — use adapters.
- Do not slash for market losses.
