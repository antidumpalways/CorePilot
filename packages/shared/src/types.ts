export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** A market symbol, e.g. "HYPE", "BTC", "ETH". */
export type Market = string;

export const StrategyType = {
  FundingTrigger: "FUNDING_TRIGGER",
} as const;
export type StrategyType = (typeof StrategyType)[keyof typeof StrategyType];

export type Side = "long" | "short";

export type PaymentAsset = "USDC" | "PILOT";

export type ExecutionStatus = "EXECUTED" | "REJECTED";

/**
 * Error codes mirror the custom errors in `ExecutionController.sol`.
 * Keep these in sync with the contract.
 */
export const ExecutionErrorCode = {
  StrategyInactive: "StrategyInactive",
  StrategyExpired: "StrategyExpired",
  ExecutionCapacityExceeded: "ExecutionCapacityExceeded",
  LeverageExceeded: "LeverageExceeded",
  SlippageExceeded: "SlippageExceeded",
  MarketNotAllowed: "MarketNotAllowed",
  InvalidMarketData: "InvalidMarketData",
  NotionalExceeded: "NotionalExceeded",
} as const;
export type ExecutionErrorCode =
  (typeof ExecutionErrorCode)[keyof typeof ExecutionErrorCode];

/** Strategy trigger parameters for the funding-trigger strategy type. */
export interface FundingTriggerParams {
  /** Trigger when the hourly funding rate (in bps, signed) is below this value. */
  fundingBelowBps: number;
  side: Side;
}

/** On-chain strategy configuration. */
export interface StrategyConfig {
  id: number;
  creator: Address;
  market: Market;
  strategyType: StrategyType;
  /** Max leverage in bps (300 = 3x). */
  maxLeverageBps: number;
  /** Max slippage in bps (50 = 0.50%). */
  maxSlippageBps: number;
  /** Max notional in whole USD. */
  maxNotionalUsd: number;
  /** Unix expiry (seconds). */
  expiry: number;
  active: boolean;
  /** Serialized trigger params (kept off-chain for MVP). */
  trigger?: FundingTriggerParams;
}

/** Market snapshot consumed by the strategy evaluator. */
export interface MarketData {
  market: Market;
  /** Mark price in USD. */
  markPrice: number;
  /** Hourly funding rate in bps (signed). e.g. -1.4 == -0.014%/hr. */
  fundingRateBps: number;
  /** Snapshot timestamp (ms). */
  timestamp: number;
  /** Data source identifier, e.g. "hyperliquid". */
  source: string;
  /** Optional signature (for the on-chain oracle). */
  signature?: Hex;
}

export interface ConstraintCheck {
  ok: boolean;
  violations: ExecutionErrorCode[];
  checked: Record<string, boolean>;
}

/** A requested execution produced by the evaluator. */
export interface ExecutionRequest {
  strategyId: number;
  market: Market;
  side: Side;
  notionalUsd: number;
  leverageBps: number;
  slippageBps: number;
}

export interface ExecutionReceipt {
  strategyId: number;
  intentNonce: string;
  status: ExecutionStatus;
  market: Market;
  markPrice?: number;
  fundingRateBps?: number;
  requestedNotionalUsd: number;
  maxNotionalUsd: number;
  /** External execution id (e.g. Hyperliquid order id / mock id). */
  executionId?: string;
  /** Elysium transaction hash. */
  txHash?: Hex;
  reason?: string;
  timestamp: number;
}

export interface FeeSplitBps {
  creatorBps: number;
  executorBps: number;
  treasuryBps: number;
  buybackBps: number;
}

export interface FeeBreakdown {
  totalUsd: number;
  creatorUsd: number;
  executorUsd: number;
  treasuryUsd: number;
  buybackUsd: number;
  paidIn: PaymentAsset;
}
