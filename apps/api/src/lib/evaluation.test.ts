import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { executorRoutes } from "../routes/executor.js";
import { parseStrategyId, unavailableEvaluation, validateEvaluationBody } from "./evaluation.js";
import { parseEvaluateResult } from "../../../web/src/lib/evaluation.js";

test("strategy IDs must be canonical positive safe integers", () => {
  assert.equal(parseStrategyId("1"), 1);
  for (const raw of ["0", "-1", "1x", "01", "1.5", "9007199254740992", ""]) {
    assert.equal(parseStrategyId(raw), null);
  }
});

test("preview input rejects unsupported policy and malformed market data", () => {
  assert.equal(validateEvaluationBody({ market: "HYPE", fundingRateBps: -1.5 }).ok, true);
  for (const body of [
    null,
    [],
    { thresholdBps: -1 },
    { signal: { type: "funding_rate", thresholdBps: -1 } },
    { market: "" },
    { markPrice: 0 },
    { fundingRateBps: "-1" },
    { side: "buy" },
  ]) {
    assert.equal(validateEvaluationBody(body).ok, false);
  }
});

test("unavailable result never asserts a match, policy permission, intent, or checked limits", () => {
  const result = unavailableEvaluation(7, "POLICY_AND_LIMITS_UNVERIFIED", true, {
    id: 7,
    chainStrategyId: 8,
    market: "HYPE",
    strategyType: "FUNDING_TRIGGER",
    provenance: "unknown",
  });
  assert.equal(result.signal.matched, null);
  assert.equal(result.policy.allowed, null);
  assert.equal(result.intent, null);
  assert.equal(result.constraints.ok, false);
  assert.ok(Object.values(result.constraints.checked).every((checked) => checked === false));
  assert.equal(result.execution.status, "NOT_REQUESTED");
  assert.equal(result.receipt, null);
  assert.equal(parseEvaluateResult(result).db, true);
});

test("evaluate route fails closed when database is unavailable", async () => {
  const oldUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const app = Fastify();
  try {
    await app.register(executorRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/api/executor/evaluate/7",
      payload: { market: "HYPE", fundingRateBps: -2, markPrice: 40, side: "long" },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    const webResult = parseEvaluateResult(result);
    assert.equal(webResult.status, "REQUIRES_POLICY");
    assert.equal(result.blocker, "DATABASE_UNAVAILABLE");
    assert.equal(result.signal.matched, null);
    assert.equal(result.intent, null);
    assert.equal(result.constraints.ok, false);
    assert.equal(result.execution.status, "NOT_REQUESTED");
    assert.equal(result.receipt, null);
    assert.equal(result.triggered, undefined);
    assert.throws(() => parseEvaluateResult({ ...result, status: "TRIGGERED" }));
    assert.throws(() => parseEvaluateResult({ ...result, constraints: { ...result.constraints, ok: true } }));

    const invalid = await app.inject({
      method: "POST",
      url: "/api/executor/evaluate/7",
      payload: { thresholdBps: -1 },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  }
});
