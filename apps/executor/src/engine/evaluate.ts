import type { ExecutionRequest, MarketData, StrategyConfig } from "@corepilot/shared";
import { StrategyType } from "@corepilot/shared";

export interface TriggerParams {
  /** Trigger when hourly funding (bps) is below this value (signed). */
  fundingBelowBps: number;
  side: "long" | "short";
}

/**
 * Default trigger params per strategy. In a fuller product these are stored off-chain per
 * strategy (metadata) or fetched from the API. For the MVP a single default is used.
 */
export const DEFAULT_FUNDING_TRIGGER: TriggerParams = {
  fundingBelowBps: -1,
  side: "long",
};

export interface EvaluationResult {
  strategyId: number;
  triggered: boolean;
  triggerLabel: string;
  request?: ExecutionRequest;
  reason?: string;
}

/**
 * Evaluate the funding-trigger strategy:
 *   IF fundingRateBps < fundingBelowBps THEN open a bounded position.
 */
export function evaluateStrategy(
  strategy: StrategyConfig,
  data: MarketData,
  params: TriggerParams = DEFAULT_FUNDING_TRIGGER,
): EvaluationResult {
  if (strategy.strategyType !== StrategyType.FundingTrigger) {
    return {
      strategyId: strategy.id,
      triggered: false,
      triggerLabel: "unsupported",
      reason: `unsupported strategy type: ${strategy.strategyType}`,
    };
  }

  const triggered = data.fundingRateBps < params.fundingBelowBps;
  const triggerLabel = `funding(${data.fundingRateBps.toFixed(4)}bps) < ${params.fundingBelowBps}bps`;

  if (!triggered) {
    return { strategyId: strategy.id, triggered: false, triggerLabel, reason: "condition not met" };
  }

  const request: ExecutionRequest = {
    strategyId: strategy.id,
    market: strategy.market,
    side: params.side,
    notionalUsd: strategy.maxNotionalUsd,
    leverageBps: strategy.maxLeverageBps,
    slippageBps: strategy.maxSlippageBps,
  };

  return { strategyId: strategy.id, triggered: true, triggerLabel, request };
}
