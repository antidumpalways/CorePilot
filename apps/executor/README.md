# @corepilot/executor

Off-chain executor for CorePilot. It:

1. loads strategy bounds from Elysium via the SDK,
2. requires a stored per-strategy funding policy before reading market data,
3. evaluates the signal and policy, builds an intent, then checks constraints,
4. simulates the adapter when live execution is disabled,
5. with explicit live opt-in, submits and confirms an oracle snapshot, dispatches
   the intent, and records the confirmed adapter-request event.

## Run

```bash
cp .env.example .env
pnpm dev            # from apps/executor
```

Without contract addresses configured, it runs a **deterministic, simulation-only demo**.
`FUNDING_TRIGGER_BPS` and `STRATEGY_SIDE` configure only this demo.

The current SDK chain read returns bounds but no persisted trigger. Therefore chain strategies
are **skipped fail-closed** until an authenticated policy store is integrated. Setting
`EXECUTOR_ENABLE_LIVE_EXECUTION=true` alone cannot bypass this guard. Once a verified
per-strategy policy is available, live dispatch additionally requires the opt-in, wallets,
contract addresses, and successful oracle/controller transaction receipts. An
`ADAPTER_REQUESTED` receipt is **not** proof of a HyperCore venue fill.

## Notes

- The executor account must be the bonded `executor` set on `ExecutionController`.
- The snapshot signer key must match the oracle's `signer`.
- Never log private keys.
