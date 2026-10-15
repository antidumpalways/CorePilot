# @corepilot/contracts

Foundry project for the CorePilot on-chain layer.

## Layout

- `src/` — contracts
- `test/` — Foundry tests
- `script/` — deploy scripts

## Setup

```bash
# install Foundry (once)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# from this directory
forge install foundry-rs/forge-std
forge build
forge test -vv
```

## Deploy (Elysium testnet)

```bash
export ELYSIUM_RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz
export DEPLOYER_PRIVATE_KEY=0x...
forge script script/Deploy.s.sol:Deploy --rpc-url $ELYSIUM_RPC_URL --broadcast
```

## Notes

- Contracts are self-contained (no external library imports) so `forge build` works with only
  `forge-std` installed.
- `PilotToken` is a **test-only** token.
- `StrategyRegistry` stores strategy identity, creator, and hard execution bounds. Its
  `strategyType` is metadata, **not** an on-chain funding-threshold check. The evaluator must
  decide the funding-rate policy off-chain before submitting an intent.
- `ExecutionController` verifies the registered market, active/unexpired strategy, current
  creator and executor bonds, nonzero request values, notional/leverage/slippage ceilings, and
  snapshot freshness. It does **not** check a funding threshold or prove policy approval.
- `MockExecutionAdapter` records a simulation. `TestnetExecutionAdapter.ExecutionRequested`
  records a backend request only; it does **not** prove an order was placed or filled on HyperCore.
  Both adapters accept calls only from their configured controller.
- `ExecutionReceiptRegistry` preserves its legacy `accepted` field for ABI compatibility; true
  means adapter request accepted, **not** venue fill. `receiptStatus` distinguishes adapter
  requests from executor-reported rejections. A reported rejection reason is not independently
  verified on-chain. Adapter reverts leave no receipt because the transaction reverts.
- Creator bond operations require the canonical `StrategyRegistry.creatorOf(strategyId)`.
  Deployments must configure `PilotStaking.setStrategyRegistry(registry)` and
  `adapter.setController(controller)` once before use, as `script/Deploy.s.sol` does. Existing
  deployed bytecode is not upgraded by these source changes.
- Bonds provide accountability, but this MVP does not implement automatic slashing, enforce
  a HyperCore trade, or verify a HyperCore fill.
