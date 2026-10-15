# CorePilot — current architecture

CorePilot models `SIGNAL → ACTION / EXECUTION INTENT → POLICY → CONSTRAINTS → EXECUTION ADAPTER → RECEIPT`.
The only implemented signal evaluator is Funding Rate; the supported action is Open Position.
Price, basis, open interest, volatility, PnL, and composite signals are planned, not executable.

| Layer | Current responsibility | Important boundary |
|---|---|---|
| `packages/shared` | Distinct signal, action, policy, intent, constraints, adapter result, and receipt types | Types do not prove runtime behavior. |
| `apps/executor` | Off-chain signal/policy evaluation and constraint preflight | Chain strategies have no verified stored trigger source yet and are skipped fail-closed. Global threshold/side are demo-only. |
| `packages/contracts` | Registry, bonds, hard-bound controller, adapter dispatch, receipt registry | The controller does not evaluate funding policy or verify a HyperCore fill. |
| `packages/sdk` | Reads bounds, maps intent to controller tuple, interprets receipt status | `execute(intent)` does not authorize policy; `executeRaw` is a legacy low-level bypass. |
| `apps/api` | Strategy index, market snapshots, capabilities, fail-closed evaluation endpoint | `REQUIRES_POLICY` means no match, policy permission, checked constraints, intent, or dispatch is asserted. |
| `apps/web` | Source-labelled explorer, create flow, monitor, demo simulation | Demo samples are not API/chain results. |

## Execution truth

For a future verified per-strategy funding policy, the executor can evaluate a fresh market
observation and form an intent. The controller then rechecks the current registry market,
active/expiry state, creator and executor bonds, nonzero request, hard notional/leverage/slippage
limits, and oracle snapshot freshness. These checks can revert an invalid request; they do not
establish that the off-chain funding condition was met. The controller-bound adapter returns a
request ID. `AdapterRequestAccepted` and an `ADAPTER_REQUESTED` on-chain receipt mean dispatch
was accepted, **not** that an order was placed or filled at HyperCore. `recordRejection` is an
executor-reported reason, not an independently verified denial. Adapter revert yields no receipt.

The deploy script currently installs `MockExecutionAdapter`, which only simulates the request.
`TestnetExecutionAdapter` is a backend-request seam, not a venue-fill integration. Neither
adapter takes custody of trading capital or establishes a user trade-only agent. Automatic
slashing and fill verification are not implemented; `PilotStaking.recordViolation` emits an event.

## Deployment compatibility

`Deploy.s.sol` binds `PilotStaking` to `StrategyRegistry`, the receipt registry to the controller,
and the mock adapter to the controller. These are new source/deployment requirements. Editing
source does **not** upgrade previously deployed bytecode. Existing addresses must be inspected
for their actual runtime and ABI before SDK/web configuration is trusted.

See [deploy-testnet.md](./deploy-testnet.md) for a testnet-only walkthrough and its limitations.
