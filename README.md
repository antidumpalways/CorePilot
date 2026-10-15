# CorePilot

**Programmable strategy execution layer for Elysium + HyperCore.**

CorePilot is an early testnet prototype for expressing a funding-rate signal, an open-position
action, execution bounds, and observable adapter requests. It does **not** currently prove a
HyperCore order or fill, or wire a verified per-strategy policy store for live dispatch.

- On-chain on **Elysium**: strategy registry, creator/executor bonds, hard-bound checks,
  mock/testnet adapter dispatch, and receipts recording an adapter request or a reported rejection.
- Off-chain: executor evaluates a funding-rate policy only when a verified, stored per-strategy
  policy is available. The current chain read has no such source, so chain strategies are skipped.
- **$PILOT** currently backs creator/executor bonds on testnet. Automatic slashing, venue-fill
  verification, native CoreWriter integration, and production token mechanics are not implemented.

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

### Executor (deterministic, simulation-only demo without chain config)

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

Funding Rate is the only currently supported signal; Open Position is the supported action.
Other signals shown in the product are planned. The API returns `REQUIRES_POLICY` and never
dispatches. A new deployment does not make existing deployed bytecode change; verify addresses
and contract versions before using the SDK or web app. An accepted adapter request is not a
venue fill.

## Non-negotiables

- Not a DEX, wallet, custodial fund, bot, or copy-trading product.
- CorePilot never takes custody of trading capital.
- Do not fake Elysium's native interfaces — use adapters.
- Do not slash for market losses.
