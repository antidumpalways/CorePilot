import type {
  ExecutionErrorCode,
  Hex,
  Market,
  Side,
} from "./types.js";

/** Executable phase-1 signal. Funding rate is signed hourly bps. */
export interface FundingRateSignal {
  type: "funding_rate";
  operator: "lt" | "lte" | "gt" | "gte";
  thresholdBps: number;
}

/** @deprecated Use FundingRateSignal; kept for existing MVP consumers. */
export interface FundingRateBelowSignal {
  kind: "FUNDING_RATE_BELOW";
  market: Market;
  /** Signed hourly funding rate in bps; strict less-than. */
  thresholdBps: number;
}

export type SignalDefinition = FundingRateSignal;
/** @deprecated Use SignalDefinition. */
export type Signal = FundingRateBelowSignal;

export type SignalEvaluation =
  | {
      matched: true;
      signalType: SignalDefinition["type"];
      observedValue: number;
      condition: string;
      reason?: string;
      observedAt: number;
      source?: string;
    }
  | {
      matched: false;
      signalType: SignalDefinition["type"];
      observedValue: number;
      condition: string;
      reason: string;
      observedAt: number;
      source?: string;
    };

/** Requested operation, distinct from the signal that caused the request. */
export interface OpenPositionAction {
  type: "open_position";
  side: Side;
}
export type ActionDefinition = OpenPositionAction;
/** @deprecated Use ActionDefinition. */
export type Action = OpenPositionAction;

/** Strategy's allowed execution envelope, carried with a proposed intent. */
export interface ExecutionConstraints {
  market: Market;
  /** Whole USD, not cents or scaled units. */
  maxNotionalUsd: number;
  /** Leverage multiplier in basis points (300 = 3x). */
  maxLeverageBps: number;
  /** Maximum slippage in basis points (50 = 0.50%). */
  maxSlippageBps: number;
  /** Unix expiry in seconds. */
  expiry: number;
  /** Controller-wide maximum market snapshot age in milliseconds. */
  maxMarketDataAgeMs: number;
  strategyId: number;
  active: boolean;
}

/** What the strategy requests; it does not contain evaluation logic/evidence. */
export interface ExecutionIntent {
  strategyId: number;
  market: Market;
  action: ActionDefinition;
  /** Whole USD. */
  notionalUsd: number;
  /** Leverage multiplier in basis points (300 = 3x). */
  leverageBps: number;
  /** Slippage in basis points (50 = 0.50%). */
  slippageBps: number;
  /** Creation time in Unix milliseconds. */
  createdAtMs: number;
}

/** Signal/action policy; signal matching is off-chain. */
export interface Policy {
  strategyId: number;
  signal: SignalDefinition;
  action: ActionDefinition;
}

export type PolicyDecision =
  | { allowed: true; evaluatedAtMs: number; evaluation: Extract<SignalEvaluation, { matched: true }> }
  | { allowed: false; evaluatedAtMs: number; evaluation: SignalEvaluation; reason: string };

/** Strategy bounds plus the controller's market-data freshness limit. */
/** A check result, distinct from the bounds being checked. */
export interface ConstraintEvaluation {
  ok: boolean;
  violations: ExecutionErrorCode[];
  checked: Record<string, boolean>;
  evaluatedAtMs: number;
}

/** Adapter acceptance is a request/dispatch, not confirmation of a venue fill. */
export type ExecutionAdapterResult =
  | {
      status: "SIMULATED";
      mode: "mock";
      executionId: string;
    }
  | {
      status: "ADAPTER_REQUESTED";
      mode: "testnet" | "onchain";
      executionId: string;
      txHash?: Hex;
    }
  | {
      status: "ADAPTER_FAILED";
      mode: "mock" | "testnet" | "onchain";
      reason: string;
      txHash?: Hex;
    };

/**
 * Observable pipeline outcome. On-chain accepted receipts currently record an
 * adapter request, not a Hyperliquid fill. Venue fill is always unconfirmed in
 * this phase; a later fill-proof model must be introduced explicitly.
 */
export type Receipt = {
  strategyId: number;
  timestampMs: number;
  venueFillStatus: "NOT_CONFIRMED";
  /** Decimal uint256 string, when an on-chain receipt was actually recorded. */
  onchainReceiptId?: string;
} & (
  | { status: "POLICY_DENIED"; reason: string }
  | { status: "CONSTRAINTS_REJECTED"; reasons: ExecutionErrorCode[] }
  | { status: "SIMULATED"; adapter: Extract<ExecutionAdapterResult, { status: "SIMULATED" }> }
  | {
      status: "ADAPTER_REQUESTED";
      adapter: Extract<ExecutionAdapterResult, { status: "ADAPTER_REQUESTED" }>;
    }
  | { status: "ADAPTER_FAILED"; adapter: Extract<ExecutionAdapterResult, { status: "ADAPTER_FAILED" }> }
);

export type CapabilitySupport = "supported" | "planned";
export interface CapabilityDefinition {
  kind: "signal" | "action";
  type: string;
  support: CapabilitySupport;
}

/** Only Funding Rate and Open Position are executable in the current runtime. */
export const DOMAIN_CAPABILITIES = [
  { kind: "signal", type: "funding_rate", support: "supported" },
  { kind: "signal", type: "price", support: "planned" },
  { kind: "signal", type: "basis", support: "planned" },
  { kind: "signal", type: "open_interest", support: "planned" },
  { kind: "signal", type: "volume", support: "planned" },
  { kind: "signal", type: "volatility", support: "planned" },
  { kind: "signal", type: "pnl", support: "planned" },
  { kind: "signal", type: "time", support: "planned" },
  { kind: "action", type: "open_position", support: "supported" },
] as const satisfies readonly CapabilityDefinition[];

export function isSignalDefinition(value: unknown): value is SignalDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "funding_rate"
    && (candidate.operator === "lt" || candidate.operator === "lte" || candidate.operator === "gt" || candidate.operator === "gte")
    && typeof candidate.thresholdBps === "number" && Number.isFinite(candidate.thresholdBps);
}

export function isActionDefinition(value: unknown): value is ActionDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "open_position" && (candidate.side === "long" || candidate.side === "short");
}
