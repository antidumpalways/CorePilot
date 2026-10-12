import {
  ExecutionErrorCode,
  type ConstraintCheck,
  type ExecutionRequest,
  type StrategyConfig,
} from "@corepilot/shared";

/**
 * Off-chain mirror of the on-chain `ExecutionController` checks.
 * Used to avoid sending transactions that would revert.
 */
export function checkConstraints(
  strategy: StrategyConfig,
  req: ExecutionRequest,
  nowSec: number,
): ConstraintCheck {
  const violations: ExecutionErrorCode[] = [];
  const checked: Record<string, boolean> = {};

  const marketOk = req.market.toUpperCase() === strategy.market.toUpperCase();
  checked.market = marketOk;
  if (!marketOk) violations.push(ExecutionErrorCode.MarketNotAllowed);

  const notionalOk = req.notionalUsd <= strategy.maxNotionalUsd;
  checked.notional = notionalOk;
  if (!notionalOk) violations.push(ExecutionErrorCode.NotionalExceeded);

  const levOk = req.leverageBps <= strategy.maxLeverageBps;
  checked.leverage = levOk;
  if (!levOk) violations.push(ExecutionErrorCode.LeverageExceeded);

  const slipOk = req.slippageBps <= strategy.maxSlippageBps;
  checked.slippage = slipOk;
  if (!slipOk) violations.push(ExecutionErrorCode.SlippageExceeded);

  const expiryOk = nowSec < strategy.expiry;
  checked.expiry = expiryOk;
  if (!expiryOk) violations.push(ExecutionErrorCode.StrategyExpired);

  const activeOk = strategy.active;
  checked.active = activeOk;
  if (!activeOk) violations.push(ExecutionErrorCode.StrategyInactive);

  return { ok: violations.length === 0, violations, checked };
}
