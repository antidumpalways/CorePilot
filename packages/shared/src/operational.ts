import type { StrategyPolicyV1, TraderAuthorizationV1, AuthorizationStatus } from "./authorization.js";
import { effectiveLimits, isFundingMatch } from "./authorization.js";
import type { Side } from "./types.js";

export interface OperationalSnapshot {
  market: string;
  fundingRateBps: number;
  timestampMs: number;
  source: "hypercore-mainnet";
}

export interface OperationalStrategy {
  id: number;
  active: boolean;
  market: string;
  expiry: number;
  maxNotionalUsd: number;
  maxLeverageBps: number;
  maxSlippageBps: number;
}

export interface RequestedTrade { notionalUsd: number; leverageBps: number; slippageBps: number }
export type OperationalBlocker =
  "STRATEGY_INACTIVE" | "STRATEGY_EXPIRED" | "POLICY_MISSING" | "POLICY_DISABLED" |
  "MARKET_DATA_MISSING" | "MARKET_DATA_STALE" | "MARKET_DATA_UNVERIFIED" |
  "SIGNAL_NOT_MATCHED" | "AUTHORIZATION_MISSING" | "AUTHORIZATION_PAUSED" |
  "AUTHORIZATION_REVOKED" | "AUTHORIZATION_EXPIRED" | "AUTHORIZATION_UNVERIFIED" |
  "MARKET_MISMATCH" | "NOTIONAL_EXCEEDED" | "LEVERAGE_EXCEEDED" |
  "SLIPPAGE_EXCEEDED" | "CREATOR_BOND_INSUFFICIENT" | "EXECUTOR_BOND_INSUFFICIENT" |
  "EXECUTION_ACCOUNT_UNVERIFIED" | "TRADING_AGENT_UNVERIFIED";

export type OperationalEvaluation =
  | { ready: false; blocker: OperationalBlocker }
  | { ready: true; market: string; side: Side; trade: RequestedTrade;
      effective: { maxNotionalUsd: number; maxLeverageBps: number; maxSlippageBps: number };
      policyVersion: number; authorizationVersion: number };

/** Pure fail-closed preflight. Callers must verify signatures, chain identity and source before invoking. */
export function evaluateOperational(input: {
  strategy: OperationalStrategy;
  policy?: StrategyPolicyV1 | null;
  authorization?: TraderAuthorizationV1 | null;
  authorizationStatus?: AuthorizationStatus | "UNVERIFIED";
  snapshot?: OperationalSnapshot | null;
  requested: RequestedTrade;
  creatorBonded: boolean;
  executorBonded: boolean;
  nowMs: number;
  maxSnapshotAgeMs: number;
}): OperationalEvaluation {
  const { strategy, policy, authorization, authorizationStatus, snapshot, requested, nowMs } = input;
  const reject = (blocker: OperationalBlocker): OperationalEvaluation => ({ ready: false, blocker });
  if (!strategy.active) return reject("STRATEGY_INACTIVE");
  if (strategy.expiry * 1000 <= nowMs) return reject("STRATEGY_EXPIRED");
  if (!policy || policy.strategyId !== strategy.id) return reject("POLICY_MISSING");
  if (!policy.enabled || policy.bounds.expiry * 1000 <= nowMs) return reject("POLICY_DISABLED");
  if (!snapshot) return reject("MARKET_DATA_MISSING");
  if (snapshot.source !== "hypercore-mainnet" || !Number.isFinite(snapshot.fundingRateBps)) return reject("MARKET_DATA_UNVERIFIED");
  const age = nowMs - snapshot.timestampMs;
  if (!Number.isFinite(age) || age < 0 || age > input.maxSnapshotAgeMs) return reject("MARKET_DATA_STALE");
  if (snapshot.market !== strategy.market || snapshot.market !== policy.market) return reject("MARKET_MISMATCH");
  if (!isFundingMatch(policy, snapshot.fundingRateBps)) return reject("SIGNAL_NOT_MATCHED");
  if (!authorization) return reject("AUTHORIZATION_MISSING");
  if (authorizationStatus === "PAUSED") return reject("AUTHORIZATION_PAUSED");
  if (authorizationStatus === "REVOKED") return reject("AUTHORIZATION_REVOKED");
  if (authorizationStatus === "EXPIRED" || nowMs >= authorization.validUntilMs) return reject("AUTHORIZATION_EXPIRED");
  if (authorizationStatus !== "ACTIVE" || authorization.validFromMs > nowMs ||
      authorization.strategyId !== strategy.id || authorization.policyVersion !== policy.version) return reject("AUTHORIZATION_UNVERIFIED");
  const limits = effectiveLimits(policy, authorization);
  const effective = { maxNotionalUsd: Math.min(limits.maxNotionalUsd, strategy.maxNotionalUsd),
    maxLeverageBps: Math.min(limits.maxLeverageBps, strategy.maxLeverageBps),
    maxSlippageBps: Math.min(limits.maxSlippageBps, strategy.maxSlippageBps) };
  if (!Number.isSafeInteger(requested.notionalUsd) || requested.notionalUsd <= 0 || requested.notionalUsd > effective.maxNotionalUsd) return reject("NOTIONAL_EXCEEDED");
  if (!Number.isSafeInteger(requested.leverageBps) || requested.leverageBps <= 0 || requested.leverageBps > effective.maxLeverageBps) return reject("LEVERAGE_EXCEEDED");
  if (!Number.isSafeInteger(requested.slippageBps) || requested.slippageBps < 0 || requested.slippageBps > effective.maxSlippageBps) return reject("SLIPPAGE_EXCEEDED");
  if (!input.creatorBonded) return reject("CREATOR_BOND_INSUFFICIENT");
  if (!input.executorBonded) return reject("EXECUTOR_BOND_INSUFFICIENT");
  return { ready: true, market: strategy.market, side: policy.action.side, trade: requested,
    effective, policyVersion: policy.version, authorizationVersion: authorization.version };
}
