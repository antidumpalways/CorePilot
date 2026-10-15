import assert from "node:assert/strict";
import { test } from "node:test";
import type { StrategyPolicyV1 } from "@corepilot/shared";
import { expiryLabel, marketCondition, previewEffectiveLimits, primaryStrategyAction } from "../src/lib/strategyUx";

const base = { connected: true, correctChain: true, loading: false, policyVerified: true,
  executable: true, draft: false, reviewing: false, pending: false };

test("primary action follows wallet, verification, and authorization state", () => {
  assert.equal(primaryStrategyAction({ ...base, connected: false }).action, "connect");
  assert.equal(primaryStrategyAction({ ...base, correctChain: false }).action, "switch");
  assert.equal(primaryStrategyAction({ ...base, loading: true }).action, "loading");
  assert.equal(primaryStrategyAction({ ...base, policyVerified: false }).action, "unavailable");
  assert.equal(primaryStrategyAction({ ...base, executable: null }).action, "unavailable");
  assert.equal(primaryStrategyAction(base).action, "use");
  assert.equal(primaryStrategyAction({ ...base, draft: true }).action, "review");
  assert.equal(primaryStrategyAction({ ...base, reviewing: true }).action, "authorize");
  assert.equal(primaryStrategyAction({ ...base, authorization: { authorization: {} as never, status: "ACTIVE" } }).action, "active");
  assert.equal(primaryStrategyAction({ ...base, authorization: { authorization: {} as never, status: "PAUSED" } }).action, "resume");
  assert.equal(primaryStrategyAction({ ...base, authorization: { authorization: {} as never, status: "EXPIRED" } }).action, "renew");
  assert.equal(primaryStrategyAction({ ...base, authorization: { authorization: {} as never, status: "REVOKED" } }).action, "new");
});

const policy = { bounds: { maxNotionalUsd: 2000, maxLeverageBps: 300, maxSlippageBps: 50 },
  signal: { type: "funding_rate", operator: "lt", thresholdBps: -1 } } as StrategyPolicyV1;

test("effective authority is capped before signing", () => {
  assert.deepEqual(previewEffectiveLimits(policy, { maxNotionalUsd: 5000, maxLeverageBps: 500, maxSlippageBps: 30 }),
    { maxNotionalUsd: 2000, maxLeverageBps: 300, maxSlippageBps: 30 });
});

test("market match is never a fill and stale data is not called triggered", () => {
  const snapshot = { fundingRateBps: -1.14, timestamp: Date.now() } as never;
  assert.equal(marketCondition(policy, snapshot, "LIVE").label, "CONDITION MET");
  assert.equal(marketCondition(policy, snapshot, "SIMULATED").label, "MATCHED · SIMULATED");
  assert.equal(marketCondition(policy, { ...snapshot, timestamp: Date.now() - 600_000 }, "LIVE").label, "STALE SNAPSHOT");
  assert.equal(expiryLabel(Date.now() - 1), "Expired");
});
