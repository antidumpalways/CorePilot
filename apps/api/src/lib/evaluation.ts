import type { StrategyRow } from "../db/schema.js";

export type EvaluationBlocker =
  | "DATABASE_UNAVAILABLE"
  | "STRATEGY_NOT_FOUND"
  | "UNSUPPORTED_SIGNAL"
  | "POLICY_AND_LIMITS_UNVERIFIED";

export interface EvaluationPreviewInput {
  market?: string;
  markPrice?: number;
  fundingRateBps?: number;
  side?: "long" | "short";
  authorizationId?: string;
  notionalUsd?: number;
  leverageBps?: number;
  slippageBps?: number;
}

const PREVIEW_KEYS = new Set(["market", "markPrice", "fundingRateBps", "side", "authorizationId", "notionalUsd", "leverageBps", "slippageBps"]);
const CHECK_NAMES = ["active", "expiry", "marketAllowed", "leverage", "slippage", "notional", "marketDataAge"];

/** Legacy preview fields are validated but never treated as strategy policy or oracle evidence. */
export function validateEvaluationBody(value: unknown):
  | { ok: true; preview: EvaluationPreviewInput }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, preview: {} };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "body must be a JSON object" };
  }

  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !PREVIEW_KEYS.has(key));
  if (unknown) return { ok: false, error: `unsupported field: ${unknown}` };

  if (body.market !== undefined &&
      (typeof body.market !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(body.market))) {
    return { ok: false, error: "market must be an uppercase market symbol" };
  }
  if (body.markPrice !== undefined &&
      (typeof body.markPrice !== "number" || !Number.isFinite(body.markPrice) || body.markPrice <= 0)) {
    return { ok: false, error: "markPrice must be a positive finite number" };
  }
  if (body.fundingRateBps !== undefined &&
      (typeof body.fundingRateBps !== "number" || !Number.isFinite(body.fundingRateBps))) {
    return { ok: false, error: "fundingRateBps must be a finite number" };
  }
  if (body.side !== undefined && body.side !== "long" && body.side !== "short") {
    return { ok: false, error: "side must be long or short" };
  }
  if (body.authorizationId !== undefined &&
      (typeof body.authorizationId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(body.authorizationId))) {
    return { ok: false, error: "authorizationId must be a UUID" };
  }
  for (const key of ["notionalUsd", "leverageBps", "slippageBps"] as const) {
    if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || (body[key] as number) < (key === "slippageBps" ? 0 : 1))) {
      return { ok: false, error: `${key} must be a non-negative safe integer` };
    }
  }
  return { ok: true, preview: body as EvaluationPreviewInput };
}

export function parseStrategyId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Deliberately fail closed. DB metadata does not contain a persisted threshold,
 * action, or verified controller limits, so no executable evaluation is possible.
 */
export function unavailableEvaluation(
  strategyId: number,
  blocker: EvaluationBlocker,
  db: boolean,
  strategy?: Pick<StrategyRow, "id" | "market" | "strategyType" | "chainStrategyId" | "provenance">,
) {
  const reason = {
    DATABASE_UNAVAILABLE: "Strategy metadata and policy source are unavailable.",
    STRATEGY_NOT_FOUND: "No local strategy exists for this id.",
    UNSUPPORTED_SIGNAL: "This strategy has no currently supported FundingRate signal.",
    POLICY_AND_LIMITS_UNVERIFIED: "Funding threshold, action, and on-chain limits are not persisted and verified for this strategy.",
  }[blocker];

  return {
    strategyId,
    status: "REQUIRES_POLICY" as const,
    blocker,
    reason,
    strategy: strategy ? {
      identity: { id: strategy.id, chainStrategyId: strategy.chainStrategyId },
      market: strategy.market ? { symbol: strategy.market } : null,
      source: { provenance: strategy.provenance },
    } : null,
    signal: {
      type: strategy?.strategyType === "FUNDING_TRIGGER" ? "funding_rate" as const : null,
      status: "UNVERIFIED" as const,
      matched: null,
      evidence: null,
    },
    action: null,
    intent: null,
    policy: { status: "UNAVAILABLE" as const, allowed: null, reason },
    constraints: {
      status: "UNVERIFIED" as const,
      ok: false,
      violations: [],
      checked: Object.fromEntries(CHECK_NAMES.map((name) => [name, false])) as Record<string, boolean>,
      reason: "No authoritative strategy limits or fresh market evidence were checked.",
    },
    execution: { status: "NOT_REQUESTED" as const },
    receipt: null,
    previewInputs: "IGNORED_NON_AUTHORITATIVE" as const,
    db,
  };
}
