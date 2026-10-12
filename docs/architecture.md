# CorePilot — Architecture

## Layers

```
┌───────────────────────────────┐
│   WEB APP (React + Vite)      │  apps/web
│   Explorer · Detail · Create  │
│   Monitor · Wallet            │
└───────────────┬───────────────┘
                │ REST (apps/api) + direct chain reads (SDK)
┌───────────────▼───────────────┐
│   SDK (@corepilot/sdk, viem)  │  packages/sdk
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────────────────┐
│   ELYSIUM CONTRACTS (Foundry)             │  packages/contracts
│   PilotToken · PilotStaking               │
│   StrategyRegistry · ExecutionController  │
│   FeeModule · ExecutionReceiptRegistry    │
│   SignedMarketDataOracle                  │
│   MockExecutionAdapter / TestnetAdapter   │
└───────────────▲───────────────────────────┘
                │
┌───────────────┴───────────────┐
│   EXECUTOR (@corepilot/executor) apps/executor
│   fetch data → submit snapshot │
│   → evaluate → check → execute │
└───────────────┬───────────────┘
                │
        Hyperliquid API (data + agent execution)
```

## Adapter abstraction (key design)

The executor and the market-data path are behind **stable interfaces** so the implementation can
change without redesign:

| Interface | MVP implementation | Future implementation |
|---|---|---|
| `IMarketDataReader` | `SignedMarketDataOracle` (signed snapshots) | Elysium **HyperCore market-data precompile** |
| `IExecutionAdapter` | `MockExecutionAdapter` / `TestnetExecutionAdapter` | `ElysiumCoreWriterAdapter` |

The rest of the system does not know which implementation is active.

## Capital & custody

- Trading capital stays in the **user's own HyperCore account**.
- CorePilot acts through a **revocable, trade-only agent** (HyperCore enforces: no withdrawals).
- CorePilot never takes custody. It charges a **service fee** only.

## Constraint enforcement

`ExecutionController.execute()` validates on-chain: active, not expired, market allowed,
notional ≤ max, leverage ≤ max, slippage ≤ max, and market data freshness. Invalid executions
**revert**. On HyperCore the order is carried by the bonded agent, so adherence is guaranteed
**economically** (bond + slashing architecture).

## Fee & value flow

```
USDC fee ─┐
          ├─→ FeeModule.charge() ─┬─ creator
PILOT fee ┘  (PILOT gets discount)├─ executor
                                  ├─ treasury
                                  └─ buyback/burn vault → PILOT
```

## Data flow (executor tick)

1. Read active strategies (`StrategyRegistry` via SDK).
2. Fetch Hyperliquid mark price + funding.
3. Submit signed snapshot to `SignedMarketDataOracle`.
4. Evaluate the funding-trigger condition.
5. Off-chain constraint mirror check.
6. Execute on-chain (`ExecutionController`) when live execution is enabled, else simulate.
7. Receipt written (`ExecutionReceiptRegistry`); full details off-chain.

## Packages

| Path | Package | Purpose |
|---|---|---|
| `packages/contracts` | (Foundry) | on-chain layer |
| `packages/shared` | `@corepilot/shared` | shared types + constants |
| `packages/sdk` | `@corepilot/sdk` | viem client + ABIs |
| `apps/executor` | `@corepilot/executor` | off-chain executor |
| `apps/api` | `@corepilot/api` | REST API + Postgres/Drizzle |
| `apps/web` | `@corepilot/web` | dashboard |
