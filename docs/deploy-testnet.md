# Deploy to Elysium testnet

Testnet only. Deployment broadcasts transactions and writes local environment files; review the
script and use a disposable funded testnet wallet. **This is not an end-to-end live trading demo.**
The current executor has no verified stored per-strategy funding policy. It skips chain strategies
even if `EXECUTOR_ENABLE_LIVE_EXECUTION=true`. The deployed adapter is `MockExecutionAdapter`,
which only returns a simulated request ID; it does not place a HyperCore order or prove a fill.

## Prerequisites

- Foundry and this repository's contract dependencies installed.
- Elysium testnet RPC and a disposable wallet with testnet gas.
- Review `packages/contracts/.env.deploy.example` and `scripts/setup-testnet.ps1` before use.

## Guided setup (PowerShell)

```powershell
Copy-Item packages\contracts\.env.deploy.example packages\contracts\.env.deploy
# Fill DEPLOYER_PRIVATE_KEY and review RPC/USDC values in .env.deploy.
pnpm setup:testnet
```

The script deploys the current contracts, bootstraps one test strategy and bonds with the deployer,
then writes `apps/executor/.env` and `apps/web/.env`. It sets
`EXECUTOR_ENABLE_LIVE_EXECUTION=false`. Do not run it over environment files you need to preserve.
The bootstrapped `FUNDING_TRIGGER` string is registry metadata; no threshold or side is stored
on-chain. An oracle seed is not proof of a matching funding policy.

## Manual deployment

From `packages/contracts`, set `ELYSIUM_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, and `USDC_ADDRESS`
in your shell, then run:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $ELYSIUM_RPC_URL --broadcast
```

Record every printed address. The script deploys `PilotToken`, `PilotStaking`,
`StrategyRegistry`, `ExecutionReceiptRegistry`, `SignedMarketDataOracle`,
`MockExecutionAdapter`, `ExecutionController`, and `FeeModule`. It calls
`staking.setStrategyRegistry(registry)`, `receipts.setController(controller)`, and
`adapter.setController(controller)`. Verify those bindings against the new deployment before
bootstrapping. If using `Bootstrap.s.sol`, export the printed pilot, staking, registry,
controller, and oracle addresses first. Bootstrap creates a demo strategy, bonds the deployer as
creator and executor, sets the controller executor, and seeds oracle data; it still does not store
a policy.

Configure app address variables from the **new** deployment, not an old address list. Source
edits do not upgrade deployed bytecode; older deployments may not have creator-bond checks,
controller-bound adapters, or the `receiptStatus` semantics expected by the current SDK.

## Run and verify

```bash
pnpm --filter @corepilot/api dev
pnpm --filter @corepilot/web dev
pnpm --filter @corepilot/executor start
```

With chain addresses configured, expect the executor to log a missing verified policy and skip
the strategy. With no chain config, its deterministic demo produces a `SIMULATED` local receipt.
The API evaluation endpoint returns `REQUIRES_POLICY` until an authoritative policy and limits
source is integrated. Do not interpret `ExecutionAccepted`, `AdapterRequestAccepted`, or
`accepted=true` as a venue fill. No automatic slashing is implemented.
