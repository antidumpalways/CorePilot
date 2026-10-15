import type { ExecutionIntent, StrategyConfig } from "@corepilot/shared";
import type { SignalEvaluation } from "./types.js";

export function buildIntent(
  strategy: StrategyConfig,
  evaluation: SignalEvaluation,
  side: "long" | "short",
  createdAtMs = Date.now(),
): ExecutionIntent {
  if (!evaluation.matched) throw new Error("cannot create intent for an unmatched signal");
  const intent: ExecutionIntent = {
    strategyId: strategy.id,
    market: strategy.market,
    action: { type: "open_position", side },
    notionalUsd: strategy.maxNotionalUsd,
    leverageBps: strategy.maxLeverageBps,
    slippageBps: strategy.maxSlippageBps,
    createdAtMs,
  };
  if (!Number.isSafeInteger(intent.notionalUsd) || intent.notionalUsd <= 0 ||
      !Number.isSafeInteger(intent.leverageBps) || intent.leverageBps <= 0 ||
      !Number.isSafeInteger(intent.slippageBps) || intent.slippageBps < 0) {
    throw new Error("strategy execution limits are invalid");
  }
  return intent;
}
