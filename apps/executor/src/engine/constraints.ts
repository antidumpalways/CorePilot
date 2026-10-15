import {
  ExecutionErrorCode,
  type ConstraintEvaluation,
  type ExecutionConstraints,
  type ExecutionIntent,
} from "@corepilot/shared";

/**
 * Off-chain preflight only; the controller remains authoritative at dispatch.
 */
export function checkConstraints(
  bounds: ExecutionConstraints,
  intent: ExecutionIntent,
  observedAtMs: number,
  nowMs = Date.now(),
): ConstraintEvaluation {
  const violations: ExecutionErrorCode[] = [];
  const checked: Record<string, boolean> = {};

  const marketOk = intent.strategyId === bounds.strategyId &&
    intent.market.toUpperCase() === bounds.market.toUpperCase();
  checked.market = marketOk;
  if (!marketOk) violations.push(ExecutionErrorCode.MarketNotAllowed);

  const requestOk = Number.isSafeInteger(intent.notionalUsd) && intent.notionalUsd > 0 &&
    Number.isSafeInteger(intent.leverageBps) && intent.leverageBps > 0;
  checked.request = requestOk;
  if (!requestOk) violations.push(ExecutionErrorCode.InvalidExecutionRequest);

  const notionalOk = Number.isSafeInteger(intent.notionalUsd) && intent.notionalUsd > 0 &&
    intent.notionalUsd <= bounds.maxNotionalUsd;
  checked.notional = notionalOk;
  if (requestOk && !notionalOk) violations.push(ExecutionErrorCode.NotionalExceeded);

  const levOk = Number.isSafeInteger(intent.leverageBps) && intent.leverageBps > 0 &&
    intent.leverageBps <= bounds.maxLeverageBps;
  checked.leverage = levOk;
  if (requestOk && !levOk) violations.push(ExecutionErrorCode.LeverageExceeded);

  const slipOk = Number.isSafeInteger(intent.slippageBps) && intent.slippageBps >= 0 &&
    intent.slippageBps <= bounds.maxSlippageBps;
  checked.slippage = slipOk;
  if (!slipOk) violations.push(ExecutionErrorCode.SlippageExceeded);

  const expiryOk = nowMs < bounds.expiry * 1000;
  checked.expiry = expiryOk;
  if (!expiryOk) violations.push(ExecutionErrorCode.StrategyExpired);

  const activeOk = bounds.active;
  checked.active = activeOk;
  if (!activeOk) violations.push(ExecutionErrorCode.StrategyInactive);

  const dataOk = Number.isFinite(observedAtMs) && observedAtMs > 0 &&
    Number.isFinite(bounds.maxMarketDataAgeMs) && bounds.maxMarketDataAgeMs > 0 &&
    nowMs >= observedAtMs && nowMs - observedAtMs <= bounds.maxMarketDataAgeMs;
  checked.marketDataFreshness = dataOk;
  if (!dataOk) violations.push(ExecutionErrorCode.InvalidMarketData);

  return { ok: violations.length === 0, violations, checked, evaluatedAtMs: nowMs };
}
