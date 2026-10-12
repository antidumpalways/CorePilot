# @corepilot/executor

Off-chain executor for CorePilot. It:

1. loads active strategies from Elysium (via the SDK),
2. fetches live Hyperliquid market data (mark price + funding),
3. submits a signed snapshot to the on-chain `SignedMarketDataOracle`,
4. evaluates the funding-trigger condition,
5. checks constraints (mirror of the on-chain controller),
6. executes: on-chain `ExecutionController.execute` when live execution is enabled,
   otherwise a mock/simulated execution.

## Run

```bash
cp .env.example .env
pnpm dev            # from apps/executor
```

Without contract addresses configured, it runs in **demo mode**: it fetches live HYPE data and
prints the evaluation, so you can verify the pipeline immediately.

With addresses + `EXECUTOR_ENABLE_LIVE_EXECUTION=true`, it sends real transactions to Elysium
testnet.

## Notes

- The executor account must be the bonded `executor` set on `ExecutionController`.
- The snapshot signer key must match the oracle's `signer`.
- Never log private keys.
