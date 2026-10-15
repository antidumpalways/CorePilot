import type { FundingRateBelowSignal, FundingTriggerParams, Policy, PolicyDecision, StrategyConfig, SignalEvaluation as DomainSignalEvaluation } from "@corepilot/shared";
import { StrategyType } from "@corepilot/shared";
import { getEvaluator, UnsupportedSignalError } from "./evaluatorRegistry.js";
import { buildIntent } from "./intentBuilder.js";
import type { EvaluationOptions, MarketContext, PipelineEvent, PipelineResult } from "./types.js";

function event(
  stage: PipelineEvent["stage"],
  strategyId: number,
  at: number,
  extra: Partial<PipelineEvent> = {},
): PipelineEvent {
  return { stage, strategyId, at, ...extra };
}

export function hasStoredPolicy(strategy: StrategyConfig): strategy is StrategyConfig & { trigger: FundingTriggerParams } {
  return strategy.strategyType === StrategyType.FundingTrigger &&
    strategy.trigger !== undefined &&
    Number.isFinite(strategy.trigger.fundingBelowBps) &&
    (strategy.trigger.side === "long" || strategy.trigger.side === "short");
}

/** Evaluate one strategy in isolation; all expected per-strategy errors become a result. */
export function evaluateStrategy(
  strategy: StrategyConfig,
  market: MarketContext | null | undefined,
  options: EvaluationOptions,
): PipelineResult {
  const nowMs = options.nowMs ?? Date.now();
  const events: PipelineEvent[] = [];
  const fail = (error: NonNullable<PipelineResult["error"]>, reason: string): PipelineResult => ({
    strategyId: strategy.id, events: [...events, event("EXECUTION_SKIPPED", strategy.id, nowMs, { reason })], error, reason,
  });
  if (!market) return fail("MarketDataUnavailable", "market data unavailable");
  const ageMs = nowMs - market.timestamp;
  if (!Number.isFinite(market.timestamp) || ageMs < 0 || ageMs > (options.maxMarketDataAgeMs ?? 60_000) ||
      !Number.isFinite(market.fundingRateBps) || !Number.isFinite(market.markPrice)) {
    return fail("StaleMarketData", "market data is stale");
  }
  if (market.market.toUpperCase() !== strategy.market.toUpperCase()) {
    return fail("MarketMismatch", `market data ${market.market} does not match strategy market ${strategy.market}`);
  }

  let evaluator;
  try {
    evaluator = getEvaluator(strategy.strategyType);
  } catch (error) {
    if (error instanceof UnsupportedSignalError) return fail("UnsupportedSignal", error.message);
    throw error;
  }

  if (!hasStoredPolicy(strategy)) {
    return fail("InvalidConfiguration", "stored per-strategy funding threshold and side are required; global defaults are demo-only");
  }
  const trigger = strategy.trigger;
  const signal: FundingRateBelowSignal = {
    kind: "FUNDING_RATE_BELOW",
    market: strategy.market,
    thresholdBps: trigger.fundingBelowBps,
  };
  const evaluation = evaluator.evaluate(signal, market);
  events.push(event("SIGNAL_OBSERVED", strategy.id, evaluation.observedAt, { metadata: evaluation.metadata }));
  events.push(event(evaluation.matched ? "CONDITION_MATCHED" : "CONDITION_NOT_MATCHED", strategy.id, evaluation.observedAt, {
    metadata: { condition: evaluation.condition }, reason: evaluation.reason,
  }));
  const policy: Policy = {
    strategyId: strategy.id,
    signal: { type: "funding_rate", operator: "lt", thresholdBps: trigger.fundingBelowBps },
    action: { type: "open_position", side: trigger.side },
  };
  const domainEvaluation: DomainSignalEvaluation = evaluation.matched
    ? { matched: true, signalType: "funding_rate", observedValue: evaluation.observedValue,
        condition: evaluation.condition, observedAt: evaluation.observedAt, source: market.source }
    : { matched: false, signalType: "funding_rate", observedValue: evaluation.observedValue,
        condition: evaluation.condition, reason: evaluation.reason ?? "condition not met",
        observedAt: evaluation.observedAt, source: market.source };
  const policyDecision: PolicyDecision = domainEvaluation.matched
    ? { allowed: true, evaluatedAtMs: nowMs, evaluation: domainEvaluation }
    : { allowed: false, evaluatedAtMs: nowMs, evaluation: domainEvaluation,
        reason: domainEvaluation.reason };
  if (!policyDecision.allowed) {
    return { strategyId: strategy.id, evaluation, policy, policyDecision, events, reason: policyDecision.reason };
  }
  try {
    const intent = buildIntent(strategy, evaluation, trigger.side, nowMs);
    events.push(event("INTENT_CREATED", strategy.id, nowMs, { metadata: { market: intent.market, side: intent.action.side } }));
    return { strategyId: strategy.id, evaluation, policy, policyDecision, intent, events };
  } catch (error) {
    return { ...fail("IntentConstructionFailed", String(error)), evaluation, policy, policyDecision };
  }
}
