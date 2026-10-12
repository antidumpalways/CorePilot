# Deploy to Elysium testnet — step by step

Everything below is **testnet only**. No real funds.

## 0. Prerequisites

- Foundry installed: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- A wallet with **testnet HYPE** on Elysium:
  - Faucet: `https://elysium.kinetiq.xyz/testnet-faucet` (connect wallet), or
  - Bridge 1:1 from HyperEVM testnet HYPE (faucet: `https://app.hyperliquid-testnet.xyz/drip`).
- Add Elysium Testnet to your wallet:
  - RPC `https://testnet-rpc.elysium.kinetiq.xyz`, chain `99801`, symbol `HYPE`.

## Quick path (recommended — one command)

The script does **everything**: deploy → bootstrap → write `apps/executor/.env` and
`apps/web/.env`.

```powershell
# 1) set your TESTNET private key (throwaway wallet only)
Copy-Item packages\contracts\.env.deploy.example packages\contracts\.env.deploy
notepad packages\contracts\.env.deploy          # fill DEPLOYER_PRIVATE_KEY

# 2) run it
pnpm setup:testnet
```

Then jump to **§4 Run the live loop**.

The manual steps below are the same thing done by hand, if you prefer.

## 1. Deploy the contracts

```bash
cd packages/contracts
export ELYSIUM_RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz
export DEPLOYER_PRIVATE_KEY=0x...                      # wallet with testnet HYPE
export USDC_ADDRESS=0x7D29d8047B905000459c0E80c34a26CeedcB47b2   # Elysium testnet USDC

forge script script/Deploy.s.sol:Deploy --rpc-url $ELYSIUM_RPC_URL --broadcast
```

Copy the printed addresses. Export them:

```bash
export PILOT_TOKEN_ADDRESS=0x...
export STAKING_ADDRESS=0x...
export STRATEGY_REGISTRY_ADDRESS=0x...
export EXECUTION_CONTROLLER_ADDRESS=0x...
export MARKET_DATA_ORACLE_ADDRESS=0x...
export RECEIPT_REGISTRY_ADDRESS=0x...
export FEE_MODULE_ADDRESS=0x...
```

## 2. Bootstrap a working demo state

This creates the flagship strategy, bonds creator + executor, sets the executor, and seeds
oracle data. (Deployer acts as creator + executor for the MVP.)

```bash
forge script script/Bootstrap.s.sol:Bootstrap --rpc-url $ELYSIUM_RPC_URL --broadcast
```

## 3. Fill environment files

- `apps/executor/.env` (copy from `.env.example`): set the addresses above,
  `EXECUTOR_ENABLE_LIVE_EXECUTION=true`,
  `EXECUTOR_PRIVATE_KEY=<deployer key>`, `ORACLE_SIGNER_PRIVATE_KEY=<deployer key>`.
- `apps/web/.env`: `VITE_API_URL`, `VITE_ELYSIUM_RPC_URL`, and the `VITE_*_ADDRESS` values.

## 4. Run the live loop

```bash
pnpm --filter @corepilot/executor start   # submits snapshots + executes when triggered
pnpm --filter @corepilot/api dev          # optional (needs DATABASE_URL)
pnpm --filter @corepilot/web dev          # dashboard
```

The executor submits a signed snapshot each tick, evaluates live Hyperliquid funding, checks
constraints, and (if `EXECUTOR_ENABLE_LIVE_EXECUTION=true`) calls
`ExecutionController.execute`.

## 5. Verify

- Elysium explorer: `https://elysium.kinetiq.xyz/testnet-explorer` — check deployed contracts.
- Watch executor logs for `executed on-chain: 0x...` or `simulated execution`.

## Troubleshooting

- **"Insufficient funds for gas"** — get more testnet HYPE from the faucet.
- **`InvalidMarketData` revert** — the executor must submit a fresh snapshot first (it does each
  tick); increase `EXECUTOR_POLL_MS` if needed.
- **`NotExecutor` / `ExecutorNotBonded`** — run `Bootstrap.s.sol` again, or ensure the executor
  account is bonded + set on the controller.
