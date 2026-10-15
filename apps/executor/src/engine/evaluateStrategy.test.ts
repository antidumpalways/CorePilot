import assert from "node:assert/strict";
import test from "node:test";
import { StrategyType, type ExecutionConstraints, type StrategyConfig } from "@corepilot/shared";
import { checkConstraints } from "./constraints.js";
import { evaluateStrategy, hasStoredPolicy } from "./evaluateStrategy.js";
import { FundingRateEvaluator } from "./evaluators/fundingRate.js";
import { mockExecute } from "../execution/adapter.js";
import type { MarketContext } from "./types.js";

const now = 1_800_000_000_000;
const strategy = (overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  id: 7,
  creator: "0x0000000000000000000000000000000000000000",
  market: "HYPE",
  strategyType: StrategyType.FundingTrigger,
  maxLeverageBps: 300,
  maxSlippageBps: 50,
  maxNotionalUsd: 25_000,
  expiry: now / 1000 + 3600,
  active: true,
  trigger: { fundingBelowBps: -1, side: "long" },
  ...overrides,
});
const market: MarketContext = {
  market: "HYPE", markPrice: 25, fundingRateBps: -1.25,
  timestamp: now, source: "test",
};
const options = { nowMs: now };

test("missing per-strategy policy fails closed despite any global demo defaults", () => {
  const result = evaluateStrategy(strategy({ trigger: undefined }), market, options);
  assert.equal(hasStoredPolicy(strategy({ trigger: undefined })), false);
  assert.equal(result.intent, undefined);
  assert.equal(result.error, "InvalidConfiguration");
  assert.ok(result.events.some((event) => event.stage === "EXECUTION_SKIPPED"));
});

const bounds = (config: StrategyConfig): ExecutionConstraints => ({
  strategyId: config.id, active: config.active, market: config.market,
  maxNotionalUsd: config.maxNotionalUsd, maxLeverageBps: config.maxLeverageBps,
  maxSlippageBps: config.maxSlippageBps, expiry: config.expiry,
  maxMarketDataAgeMs: 60_000,
});

test("funding evaluator matches below threshold and reports normalized bps", () => {
  const result = evaluateStrategy(strategy(), market, options);
  assert.equal(result.evaluation?.matched, true);
  assert.equal(result.evaluation?.observedValue, -1.25);
  assert.equal(result.intent?.action.side, "long");
  assert.equal(result.policy?.signal.type, "funding_rate");
  assert.equal(result.policyDecision?.allowed, true);
  assert.ok(result.events.some((e) => e.stage === "INTENT_CREATED"));
});

test("funding evaluator does not match a rate above threshold", () => {
  const result = evaluateStrategy(strategy(), { ...market, fundingRateBps: 0 }, options);
  assert.equal(result.evaluation?.matched, false);
  assert.equal(result.intent, undefined);
  assert.equal(result.policyDecision?.allowed, false);
  assert.ok(result.events.some((e) => e.stage === "CONDITION_NOT_MATCHED"));
});

test("threshold equality is not a match (strict less-than domain behavior)", () => {
  const signal = { kind: "FUNDING_RATE_BELOW" as const, market: "HYPE", thresholdBps: -1 };
  assert.equal(new FundingRateEvaluator().evaluate(signal, { ...market, fundingRateBps: -1 }).matched, false);
});

test("unsupported signal returns explicit error", () => {
  const result = evaluateStrategy(strategy({ strategyType: "PRICE_TRIGGER" as never }), market, options);
  assert.equal(result.error, "UnsupportedSignal");
});

test("invalid funding config is isolated", () => {
  const result = evaluateStrategy(strategy({ trigger: { fundingBelowBps: Number.NaN, side: "long" } }), market, options);
  assert.equal(result.error, "InvalidConfiguration");
});

test("invalid stored side cannot be replaced by a process-wide default", () => {
  const result = evaluateStrategy(strategy({ trigger: { fundingBelowBps: -1, side: "BUY" as never } }), market, options);
  assert.equal(result.error, "InvalidConfiguration");
  assert.equal(result.intent, undefined);
});

test("mock adapter records simulation, not a venue fill", () => {
  const result = evaluateStrategy(strategy(), market, options);
  assert.ok(result.intent);
  const adapter = mockExecute(result.intent!);
  assert.equal(adapter.status, "SIMULATED");
  assert.equal(adapter.mode, "mock");
});

test("intent creation emits generic stage and constraint violation is rejected", () => {
  const config = strategy({ maxNotionalUsd: 10 });
  const result = evaluateStrategy(config, market, options);
  assert.ok(result.intent);
  assert.ok(result.events.some((e) => e.stage === "INTENT_CREATED"));
  const check = checkConstraints(bounds(config), { ...result.intent!, market: "BTC" }, market.timestamp, now);
  assert.equal(check.ok, false);
  assert.ok(check.violations.includes("MarketNotAllowed"));
});

test("inactive and expired strategies remain individually constraint-checked", () => {
  const inactive = strategy({ active: false });
  const inactiveResult = evaluateStrategy(inactive, market, options);
  assert.ok(inactiveResult.intent);
  assert.ok(checkConstraints(bounds(inactive), inactiveResult.intent!, market.timestamp, now).violations.includes("StrategyInactive"));
  const expired = strategy({ expiry: now / 1000 });
  const expiredResult = evaluateStrategy(expired, market, options);
  assert.ok(expiredResult.intent);
  assert.ok(checkConstraints(bounds(expired), expiredResult.intent!, market.timestamp, now).violations.includes("StrategyExpired"));
});

test("stale observations fail the hard freshness preflight", () => {
  const config = strategy();
  const result = evaluateStrategy(config, market, options);
  assert.ok(result.intent);
  const check = checkConstraints(bounds(config), result.intent!, now - 60_001, now);
  assert.ok(check.violations.includes("InvalidMarketData"));
});

test("zero request values match the controller's InvalidExecutionRequest guard", () => {
  const config = strategy();
  const result = evaluateStrategy(config, market, options);
  assert.ok(result.intent);
  const check = checkConstraints(bounds(config), { ...result.intent!, notionalUsd: 0 }, market.timestamp, now);
  assert.deepEqual(check.violations, ["InvalidExecutionRequest"]);
});

test("market mismatch is rejected before evaluation", () => {
  const result = evaluateStrategy(strategy(), { ...market, market: "BTC" }, options);
  assert.equal(result.error, "MarketMismatch");
  assert.equal(result.evaluation, undefined);
});
