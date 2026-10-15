import type { Address } from "./types.js";

/** CorePilot authorization and venue-native agent permission are separate grants. */
export type ExecutionIsolationMode = "ISOLATED" | "COMPATIBILITY";
export type TradingAgentStatus = "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "UNVERIFIED";

export interface TradingAccess {
  trader: Address;
  executionAccount: Address;
  agentAddress: Address;
  isolationMode: ExecutionIsolationMode;
  status: TradingAgentStatus;
  verifiedAtMs: number | null;
  expiresAtMs: number;
}

/** Explicit trader consent for a specific venue agent. Not a venue-native permission limit. */
export interface TradingAccessGrantV1 {
  version: 1;
  authorizationId: string;
  chainId: number;
  registry: Address;
  trader: Address;
  executionAccount: Address;
  agentAddress: Address;
  isolationMode: ExecutionIsolationMode;
  validUntilMs: number;
}

export function tradingAccessSigningMessage(grant: TradingAccessGrantV1): string {
  return ["CorePilot Trading Access Grant V1", `authorizationId:${grant.authorizationId}`,
    `chainId:${grant.chainId}`, `registry:${grant.registry.toLowerCase()}`,
    `trader:${grant.trader.toLowerCase()}`, `executionAccount:${grant.executionAccount.toLowerCase()}`,
    `agentAddress:${grant.agentAddress.toLowerCase()}`, `isolationMode:${grant.isolationMode}`,
    `validUntilMs:${grant.validUntilMs}`].join("\n");
}

export function isTradingAccessGrantV1(value: unknown): value is TradingAccessGrantV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["version", "authorizationId", "chainId", "registry", "trader", "executionAccount",
    "agentAddress", "isolationMode", "validUntilMs"];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return false;
  const address = (candidate: unknown) => typeof candidate === "string" && /^0x[0-9a-fA-F]{40}$/.test(candidate);
  return record.version === 1 && typeof record.authorizationId === "string" &&
    /^[0-9a-fA-F-]{36}$/.test(record.authorizationId) && Number.isSafeInteger(record.chainId) &&
    (record.chainId as number) > 0 && address(record.registry) && address(record.trader) &&
    address(record.executionAccount) && address(record.agentAddress) &&
    (record.isolationMode === "ISOLATED" || record.isolationMode === "COMPATIBILITY") &&
    Number.isSafeInteger(record.validUntilMs) && (record.validUntilMs as number) > 0;
}

export type TradingAccessBlocker =
  "TRADING_AGENT_UNVERIFIED" | "TRADING_AGENT_REVOKED" | "TRADING_AGENT_EXPIRED" |
  "AGENT_VERIFICATION_STALE" | "EXECUTION_ACCOUNT_UNVERIFIED";

/** This local guard supplements, but never replaces, a fresh venue userRole/account check. */
export function checkTradingAccess(access: TradingAccess | null, nowMs: number,
  maxVerificationAgeMs: number): TradingAccessBlocker | null {
  if (!access || access.status === "PENDING" || access.status === "UNVERIFIED") return "TRADING_AGENT_UNVERIFIED";
  if (access.status === "REVOKED") return "TRADING_AGENT_REVOKED";
  if (access.status === "EXPIRED") return "TRADING_AGENT_EXPIRED";
  if (access.status !== "ACTIVE") return "TRADING_AGENT_UNVERIFIED";
  if (!Number.isSafeInteger(access.expiresAtMs) || access.expiresAtMs <= nowMs) return "TRADING_AGENT_EXPIRED";
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxVerificationAgeMs) || maxVerificationAgeMs <= 0) return "AGENT_VERIFICATION_STALE";
  if (!Number.isSafeInteger(access.verifiedAtMs) || access.verifiedAtMs === null ||
      access.verifiedAtMs > nowMs || nowMs - access.verifiedAtMs > maxVerificationAgeMs) return "AGENT_VERIFICATION_STALE";
  const isAddress = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address);
  if (!isAddress(access.trader) || !isAddress(access.executionAccount) ||
      !isAddress(access.agentAddress) || access.agentAddress.toLowerCase() === access.trader.toLowerCase()) {
    return "EXECUTION_ACCOUNT_UNVERIFIED";
  }
  if (access.isolationMode !== "ISOLATED" && access.isolationMode !== "COMPATIBILITY") return "EXECUTION_ACCOUNT_UNVERIFIED";
  if (access.isolationMode === "COMPATIBILITY" &&
      access.executionAccount.toLowerCase() !== access.trader.toLowerCase()) return "EXECUTION_ACCOUNT_UNVERIFIED";
  if (access.isolationMode === "ISOLATED" &&
      access.executionAccount.toLowerCase() === access.trader.toLowerCase()) return "EXECUTION_ACCOUNT_UNVERIFIED";
  return null;
}
