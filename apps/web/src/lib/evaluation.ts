/** Only the fail-closed API shape is supported until authoritative policy exists. */
export interface EvaluateResult {
  strategyId: number;
  status: "REQUIRES_POLICY";
  blocker: string;
  reason: string;
  signal: { type: "funding_rate" | null; status: "UNVERIFIED"; matched: null; evidence: null };
  action: null;
  intent: null;
  policy: { status: "UNAVAILABLE"; allowed: null; reason: string };
  constraints: { status: "UNVERIFIED"; ok: false; violations: string[]; checked: Record<string, boolean>; reason: string };
  execution: { status: "NOT_REQUESTED" };
  receipt: null;
  previewInputs: "IGNORED_NON_AUTHORITATIVE";
  db: boolean;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function parseEvaluateResult(value: unknown): EvaluateResult {
  const result = object(value);
  const signal = object(result?.signal);
  const policy = object(result?.policy);
  const constraints = object(result?.constraints);
  const execution = object(result?.execution);
  if (!result || !Number.isSafeInteger(result.strategyId) ||
      result.status !== "REQUIRES_POLICY" || typeof result.blocker !== "string" ||
      typeof result.reason !== "string" || typeof result.db !== "boolean" ||
      !signal || signal.status !== "UNVERIFIED" || signal.matched !== null ||
      signal.evidence !== null || (signal.type !== null && signal.type !== "funding_rate") ||
      result.action !== null || result.intent !== null ||
      !policy || policy.status !== "UNAVAILABLE" || policy.allowed !== null ||
      typeof policy.reason !== "string" ||
      !constraints || constraints.status !== "UNVERIFIED" || constraints.ok !== false ||
      !Array.isArray(constraints.violations) || !object(constraints.checked) ||
      typeof constraints.reason !== "string" ||
      !execution || execution.status !== "NOT_REQUESTED" || result.receipt !== null ||
      result.previewInputs !== "IGNORED_NON_AUTHORITATIVE") {
    throw new Error("unsupported or incomplete evaluation response");
  }
  return value as EvaluateResult;
}
