import { effectiveLimits, type StrategyPolicyV1, type TraderAuthorizationV1 } from "@corepilot/shared";
import type { AuthorizationView, DataSource, MarketView } from "./api";

export type StrategyAction = "connect" | "switch" | "loading" | "unavailable" | "use" | "review" | "authorize" | "pending" | "active" | "resume" | "renew" | "new";

export function primaryStrategyAction(input: {
  connected: boolean; correctChain: boolean; loading: boolean; policyVerified: boolean;
  executable: boolean | null; authorization?: AuthorizationView; draft: boolean;
  reviewing: boolean; pending: boolean;
}): { action: StrategyAction; label: string; helper?: string } {
  if (input.pending) return { action: "pending", label: "Authorizing…" };
  if (!input.connected) return { action: "connect", label: "Connect Wallet" };
  if (!input.correctChain) return { action: "switch", label: "Switch to Elysium Testnet" };
  if (input.loading) return { action: "loading", label: "Loading Strategy…" };
  if (!input.policyVerified) return { action: "unavailable", label: "Strategy Unavailable", helper: "Authoritative strategy policy could not be verified." };
  if (input.executable !== true) return { action: "unavailable", label: "Strategy Unavailable", helper: input.executable === false ? "Creator strategy is not eligible on-chain." : "On-chain eligibility could not be verified." };
  const rawStatus = input.authorization?.status;
  const status = input.authorization && (rawStatus === "ACTIVE" || rawStatus === "PAUSED") &&
    input.authorization.authorization.validUntilMs <= Date.now() ? "EXPIRED" : rawStatus;
  if (status === "ACTIVE" && !input.draft) return { action: "active", label: "Strategy Active" };
  if (status === "PAUSED" && !input.draft) return { action: "resume", label: "Resume Strategy" };
  if (input.reviewing) return { action: "authorize", label: "Authorize Strategy" };
  if (input.draft) return { action: "review", label: "Review Authorization" };
  if (status === "EXPIRED") return { action: "renew", label: "Renew Authorization" };
  if (status === "REVOKED") return { action: "new", label: "Create New Authorization" };
  return { action: "use", label: "Use Strategy" };
}

export function previewEffectiveLimits(policy: StrategyPolicyV1, limits: Pick<TraderAuthorizationV1, "maxNotionalUsd" | "maxLeverageBps" | "maxSlippageBps">) {
  return effectiveLimits(policy, limits as TraderAuthorizationV1);
}

export function expiryLabel(validUntilMs: number, now = Date.now()): string {
  const remaining = validUntilMs - now;
  if (remaining <= 0) return "Expired";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.ceil((remaining % 86_400_000) / 3_600_000);
  return `Expires in ${days ? `${days}d ` : ""}${hours}h`;
}

export function marketCondition(policy: StrategyPolicyV1 | null, snapshot: MarketView | null | undefined, source: DataSource) {
  if (!policy || !snapshot || !Number.isFinite(snapshot.fundingRateBps)) return { label: "UNVERIFIED", distance: "No verified rule or snapshot" };
  if (!Number.isFinite(snapshot.timestamp) || Date.now() - snapshot.timestamp > 5 * 60_000 || snapshot.timestamp > Date.now() + 60_000) return { label: "STALE SNAPSHOT", distance: "Waiting for fresh market data" };
  const delta = snapshot.fundingRateBps - policy.signal.thresholdBps;
  const simulated = source === "DEMO" || source === "SIMULATED";
  return {
    label: delta < 0 ? (simulated ? "MATCHED · SIMULATED" : "CONDITION MET") : "WAITING",
    distance: delta < 0 ? `${Math.abs(delta).toFixed(2)} bps below trigger` : `${delta.toFixed(2)} bps above trigger`,
  };
}

export function actionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Action failed";
  if (/DEPLOYMENT_MISMATCH/i.test(message)) return "Web and API use different contract deployments. Hard-refresh this tab, then check the PILOT balance and allowance again before retrying.";
  if (/ELYSIUM_GAS_ESTIMATE_ABOVE_SAFETY_LIMIT/i.test(message)) return "Gas estimate is unsafe, so no transaction was sent. Refresh, verify Elysium network, then retry after checking the contract state.";
  if (/Rate Limit Exceeded/i.test(message) && /testnet-rpc\.elysium\.kinetiq\.xyz/i.test(message)) return "The wallet's saved Elysium RPC is rate-limited. Update that network's RPC in your wallet extension to the Alchemy endpoint, then resume the existing strategy ID. Do not publish a duplicate.";
  if (/max fee per gas less than block base fee|fee cap less than block base fee/i.test(message)) return "Elysium gas fee changed before submission. No strategy was created by this rejected request. Refresh the page and retry with a fresh wallet fee quote.";
  if (/rejected|denied|cancelled/i.test(message)) return "Wallet request rejected. Review the action and try again when ready.";
  if (/DATABASE_UNAVAILABLE|fetch failed|Failed to fetch/i.test(message)) return "CorePilot API is unavailable. No authorization was confirmed; retry when service returns.";
  if (/POLICY_BINDING_MISMATCH|POLICY_VERSION_CONFLICT/i.test(message)) return "Strategy policy changed. Refresh and review the latest limits before signing again.";
  if (/AUTHORIZATION_TIME_INVALID|EXPIRED/i.test(message)) return "Authorization time is invalid or expired. Refresh and create a new authorization.";
  return message.replaceAll("_", " ");
}
