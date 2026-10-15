import type { FundingRateBelowSignal } from "@corepilot/shared";
import type { MarketContext, SignalEvaluation, SignalEvaluator } from "../types.js";

export class FundingRateEvaluator implements SignalEvaluator<FundingRateBelowSignal> {
  readonly type = "funding_rate";

  evaluate(signal: FundingRateBelowSignal, marketContext: MarketContext): SignalEvaluation {
    const observedValue = marketContext.fundingRateBps;
    const matched = observedValue < signal.thresholdBps;
    return {
      matched,
      observedValue,
      condition: `${observedValue} bps < ${signal.thresholdBps} bps`,
      reason: matched ? undefined : "funding rate condition not met",
      observedAt: marketContext.timestamp,
      metadata: {
        signal: "FUNDING_RATE_BELOW",
        market: marketContext.market,
        thresholdBps: signal.thresholdBps,
        source: marketContext.source,
        unit: "hourly_bps",
      },
    };
  }
}
