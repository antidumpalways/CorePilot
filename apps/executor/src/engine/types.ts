import type { ExecutionIntent, Market, Policy, PolicyDecision, StrategyConfig } from "@corepilot/shared";

/** Normalized input shared by all signal evaluators. Rates are hourly bps. */
export interface MarketContext {
  market: Market;
  markPrice: number;
  fundingRateBps: number;
  timestamp: number;
  source: string;
}

export interface SignalEvaluation {
  matched: boolean;
  observedValue: number;
  condition: string;
  reason?: string;
  observedAt: number;
  metadata: Record<string, unknown>;
}

export interface SignalEvaluator<TSignal = unknown> {
  readonly type: string;
  evaluate(signal: TSignal, marketContext: MarketContext): SignalEvaluation;
}

export type PipelineStage =
  | "SIGNAL_OBSERVED"
  | "CONDITION_MATCHED"
  | "CONDITION_NOT_MATCHED"
  | "INTENT_CREATED"
  | "CONSTRAINTS_PASSED"
  | "CONSTRAINTS_FAILED"
  | "EXECUTION_SUBMITTED"
  | "EXECUTION_SKIPPED";

export interface PipelineEvent {
  stage: PipelineStage;
  strategyId: number;
  at: number;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export interface PipelineResult {
  strategyId: number;
  evaluation?: SignalEvaluation;
  policy?: Policy;
  policyDecision?: PolicyDecision;
  intent?: ExecutionIntent;
  events: PipelineEvent[];
  error?: "UnsupportedSignal" | "InvalidConfiguration" | "MarketMismatch" | "MarketDataUnavailable" | "StaleMarketData" | "IntentConstructionFailed";
  reason?: string;
}

export interface EvaluationOptions {
  nowMs?: number;
  maxMarketDataAgeMs?: number;
}

export type Strategy = StrategyConfig;
