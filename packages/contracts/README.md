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
- Constraint enforcement happens in `ExecutionController`; on HyperCore the order is carried by
  the bonded trade-only agent, so adherence is economic (bond + slashing).
