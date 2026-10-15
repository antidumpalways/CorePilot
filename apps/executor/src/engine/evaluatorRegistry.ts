import { StrategyType } from "@corepilot/shared";
import { FundingRateEvaluator } from "./evaluators/fundingRate.js";
import type { SignalEvaluator } from "./types.js";

export class UnsupportedSignalError extends Error {
  constructor(readonly signalType: string) {
    super(`unsupported signal: ${signalType}`);
    this.name = "UnsupportedSignalError";
  }
}

const evaluators = new Map<string, SignalEvaluator>([
  [StrategyType.FundingTrigger, new FundingRateEvaluator()],
]);

export function getEvaluator(type: string): SignalEvaluator {
  const evaluator = evaluators.get(type);
  if (!evaluator) throw new UnsupportedSignalError(type);
  return evaluator;
}
