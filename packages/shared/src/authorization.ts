import type { Address, Hex, Market, Side } from "./types.js";

/** A creator-signed V1 policy tied to a single chain deployment and registry strategy. */
export interface StrategyPolicyV1 {
  chainId: number;
  registry: Address;
  strategyId: number;
  creator: Address;
  version: number;
  market: Market;
  signal: { type: "funding_rate"; operator: "lt"; thresholdBps: number };
  action: { type: "open_position"; side: Side };
  bounds: { maxNotionalUsd: number; maxLeverageBps: number; maxSlippageBps: number; expiry: number };
  enabled: boolean;
}

/** A trader-signed, revocable CorePilot authorization. This is not a Hyperliquid API-agent grant. */
export interface TraderAuthorizationV1 {
  authorizationId: string;
  chainId: number;
  registry: Address;
  strategyId: number;
  policyVersion: number;
  policyHash: Hex;
  trader: Address;
  version: number;
  maxNotionalUsd: number;
  maxLeverageBps: number;
  maxSlippageBps: number;
  validFromMs: number;
  validUntilMs: number;
}

export type AuthorizationStatus = "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";
export type AuthorizationChange = "PAUSE" | "RESUME" | "REVOKE";

/** Exact bytes signed by the creator. Field order and units are protocol V1. */
export function policySigningMessage(p: StrategyPolicyV1): string {
  return ["CorePilot Strategy Policy V1", `chainId:${p.chainId}`, `registry:${p.registry.toLowerCase()}`,
    `strategyId:${p.strategyId}`, `creator:${p.creator.toLowerCase()}`, `version:${p.version}`,
    `market:${p.market.toUpperCase()}`, "signal:funding_rate", "operator:lt",
    `thresholdBps:${p.signal.thresholdBps}`, "action:open_position", `side:${p.action.side}`,
    `maxNotionalUsd:${p.bounds.maxNotionalUsd}`, `maxLeverageBps:${p.bounds.maxLeverageBps}`,
    `maxSlippageBps:${p.bounds.maxSlippageBps}`, `expiry:${p.bounds.expiry}`,
    `enabled:${p.enabled}`].join("\n");
}

/** Exact bytes signed by the trader. The policy hash invalidates stale authorizations. */
export function authorizationSigningMessage(a: TraderAuthorizationV1): string {
  return ["CorePilot Trader Authorization V1", `authorizationId:${a.authorizationId}`,
    `chainId:${a.chainId}`, `registry:${a.registry.toLowerCase()}`, `strategyId:${a.strategyId}`,
    `policyVersion:${a.policyVersion}`, `policyHash:${a.policyHash.toLowerCase()}`,
    `trader:${a.trader.toLowerCase()}`, `version:${a.version}`,
    `maxNotionalUsd:${a.maxNotionalUsd}`, `maxLeverageBps:${a.maxLeverageBps}`,
    `maxSlippageBps:${a.maxSlippageBps}`, `validFromMs:${a.validFromMs}`,
    `validUntilMs:${a.validUntilMs}`].join("\n");
}

export function authorizationChangeMessage(a: TraderAuthorizationV1, nextVersion: number, change: AuthorizationChange): string {
  return ["CorePilot Authorization State V1", `authorizationId:${a.authorizationId}`,
    `chainId:${a.chainId}`, `registry:${a.registry.toLowerCase()}`, `strategyId:${a.strategyId}`,
    `policyHash:${a.policyHash.toLowerCase()}`, `trader:${a.trader.toLowerCase()}`,
    `nextVersion:${nextVersion}`, `change:${change}`].join("\n");
}

const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const hex32 = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Rejects malformed or ambiguous signable payloads before message construction. */
export function isStrategyPolicyV1(value: unknown): value is StrategyPolicyV1 {
  if (!exactKeys(value, ["chainId", "registry", "strategyId", "creator", "version", "market", "signal", "action", "bounds", "enabled"])) return false;
  const signal = value.signal;
  const action = value.action;
  const bounds = value.bounds;
  return integer(value.chainId, 1) && address(value.registry) && integer(value.strategyId, 1) &&
    address(value.creator) && integer(value.version, 1) &&
    typeof value.market === "string" && /^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(value.market) &&
    exactKeys(signal, ["type", "operator", "thresholdBps"]) &&
    signal.type === "funding_rate" && signal.operator === "lt" &&
    typeof signal.thresholdBps === "number" && Number.isFinite(signal.thresholdBps) &&
    Number.isSafeInteger(signal.thresholdBps * 1000) &&
    exactKeys(action, ["type", "side"]) && action.type === "open_position" &&
    (action.side === "long" || action.side === "short") &&
    exactKeys(bounds, ["maxNotionalUsd", "maxLeverageBps", "maxSlippageBps", "expiry"]) &&
    integer(bounds.maxNotionalUsd, 1) && integer(bounds.maxLeverageBps, 1) &&
    integer(bounds.maxSlippageBps, 0) && integer(bounds.expiry, 1) &&
    typeof value.enabled === "boolean";
}

export function isTraderAuthorizationV1(value: unknown): value is TraderAuthorizationV1 {
  if (!exactKeys(value, ["authorizationId", "chainId", "registry", "strategyId", "policyVersion", "policyHash", "trader", "version", "maxNotionalUsd", "maxLeverageBps", "maxSlippageBps", "validFromMs", "validUntilMs"])) return false;
  return typeof value.authorizationId === "string" && /^[0-9a-fA-F-]{36}$/.test(value.authorizationId) &&
    integer(value.chainId, 1) && address(value.registry) && integer(value.strategyId, 1) &&
    integer(value.policyVersion, 1) && hex32(value.policyHash) && address(value.trader) &&
    integer(value.version, 1) && integer(value.maxNotionalUsd, 1) &&
    integer(value.maxLeverageBps, 1) && integer(value.maxSlippageBps, 0) &&
    integer(value.validFromMs, 1) && integer(value.validUntilMs, 1) &&
    value.validUntilMs > value.validFromMs;
}

export function effectiveLimits(policy: StrategyPolicyV1, authorization: TraderAuthorizationV1) {
  return {
    maxNotionalUsd: Math.min(policy.bounds.maxNotionalUsd, authorization.maxNotionalUsd),
    maxLeverageBps: Math.min(policy.bounds.maxLeverageBps, authorization.maxLeverageBps),
    maxSlippageBps: Math.min(policy.bounds.maxSlippageBps, authorization.maxSlippageBps),
  };
}

export function isFundingMatch(policy: StrategyPolicyV1, fundingRateBps: number): boolean {
  return policy.signal.type === "funding_rate" && policy.signal.operator === "lt" &&
    Number.isFinite(fundingRateBps) && fundingRateBps < policy.signal.thresholdBps;
}
