import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { hashMessage, verifyMessage } from "viem";
import {
  authorizationChangeMessage, authorizationSigningMessage, effectiveLimits,
  isFundingMatch, isStrategyPolicyV1, isTraderAuthorizationV1, policySigningMessage,
  evaluateOperational,
  type StrategyPolicyV1, type TraderAuthorizationV1,
} from "@corepilot/shared";

const creator = privateKeyToAccount(`0x${"11".repeat(32)}`);
const trader = privateKeyToAccount(`0x${"22".repeat(32)}`);
const registry = `0x${"33".repeat(20)}` as const;
const policy: StrategyPolicyV1 = {
  chainId: 99801, registry, strategyId: 14, creator: creator.address, version: 1,
  market: "HYPE", signal: { type: "funding_rate", operator: "lt", thresholdBps: -1 },
  action: { type: "open_position", side: "long" }, enabled: true,
  bounds: { maxNotionalUsd: 25000, maxLeverageBps: 300, maxSlippageBps: 50, expiry: 2000000000 },
};
const auth: TraderAuthorizationV1 = {
  authorizationId: "00000000-0000-4000-8000-000000000014", chainId: 99801,
  registry, strategyId: 14, policyVersion: 1, policyHash: hashMessage(policySigningMessage(policy)),
  trader: trader.address, version: 1, maxNotionalUsd: 1000, maxLeverageBps: 200,
  maxSlippageBps: 30, validFromMs: 1700000000000, validUntilMs: 1900000000000,
};

test("policy fields are strictly canonical and bind chain, strategy, creator and action", async () => {
  assert.equal(isStrategyPolicyV1(policy), true);
  const signed = await creator.signMessage({ message: policySigningMessage(policy) });
  assert.equal(await verifyMessage({ address: creator.address, message: policySigningMessage(policy), signature: signed }), true);
  for (const modified of [{ ...policy, strategyId: 15 }, { ...policy, registry: `0x${"44".repeat(20)}` as const },
    { ...policy, action: { type: "open_position" as const, side: "short" as const } }]) {
    assert.equal(await verifyMessage({ address: creator.address, message: policySigningMessage(modified), signature: signed }), false);
  }
  assert.equal(isStrategyPolicyV1({ ...policy, signal: { ...policy.signal, thresholdBps: Infinity } }), false);
  assert.equal(isStrategyPolicyV1({ ...policy, extra: "ignored" }), false);
});

test("trader signature binds policy and personal limits; effective limits are stricter", async () => {
  assert.equal(isTraderAuthorizationV1(auth), true);
  const signed = await trader.signMessage({ message: authorizationSigningMessage(auth) });
  assert.equal(await verifyMessage({ address: trader.address, message: authorizationSigningMessage(auth), signature: signed }), true);
  assert.equal(await verifyMessage({ address: trader.address, message: authorizationSigningMessage({ ...auth, maxNotionalUsd: 2000 }), signature: signed }), false);
  assert.deepEqual(effectiveLimits(policy, auth), { maxNotionalUsd: 1000, maxLeverageBps: 200, maxSlippageBps: 30 });
  assert.equal(isTraderAuthorizationV1({ ...auth, validUntilMs: auth.validFromMs }), false);
  assert.equal(isFundingMatch(policy, -1.01), true);
  assert.equal(isFundingMatch(policy, -1), false);
});

test("pause/revoke signatures cannot be replayed for another version or action", async () => {
  const signed = await trader.signMessage({ message: authorizationChangeMessage(auth, 2, "PAUSE") });
  assert.equal(await verifyMessage({ address: trader.address, message: authorizationChangeMessage(auth, 2, "PAUSE"), signature: signed }), true);
  assert.equal(await verifyMessage({ address: trader.address, message: authorizationChangeMessage(auth, 3, "PAUSE"), signature: signed }), false);
  assert.equal(await verifyMessage({ address: trader.address, message: authorizationChangeMessage(auth, 2, "REVOKE"), signature: signed }), false);
});

test("operational preflight enforces signal, authorization, bonds and stricter limits", () => {
  const nowMs = 1800000000000;
  const base = { strategy: { id: 14, active: true, market: "HYPE", expiry: 2000000000,
      maxNotionalUsd: 25000, maxLeverageBps: 300, maxSlippageBps: 50 },
    policy, authorization: auth, authorizationStatus: "ACTIVE" as const,
    snapshot: { market: "HYPE", fundingRateBps: -1.1, timestampMs: nowMs, source: "hypercore-mainnet" as const },
    requested: { notionalUsd: 1000, leverageBps: 200, slippageBps: 30 },
    creatorBonded: true, executorBonded: true, nowMs, maxSnapshotAgeMs: 60000 };
  const ready = evaluateOperational(base);
  assert.equal(ready.ready, true);
  if (ready.ready) assert.deepEqual(ready.effective, { maxNotionalUsd: 1000, maxLeverageBps: 200, maxSlippageBps: 30 });
  const blocked = (change: object) => evaluateOperational({ ...base, ...change });
  assert.deepEqual(blocked({ policy: null }), { ready: false, blocker: "POLICY_MISSING" });
  assert.deepEqual(blocked({ snapshot: { ...base.snapshot, fundingRateBps: -0.9 } }), { ready: false, blocker: "SIGNAL_NOT_MATCHED" });
  assert.deepEqual(blocked({ snapshot: { ...base.snapshot, timestampMs: nowMs - 60001 } }), { ready: false, blocker: "MARKET_DATA_STALE" });
  assert.deepEqual(blocked({ authorization: null }), { ready: false, blocker: "AUTHORIZATION_MISSING" });
  assert.deepEqual(blocked({ authorizationStatus: "PAUSED" }), { ready: false, blocker: "AUTHORIZATION_PAUSED" });
  assert.deepEqual(blocked({ authorizationStatus: "REVOKED" }), { ready: false, blocker: "AUTHORIZATION_REVOKED" });
  assert.deepEqual(blocked({ authorization: { ...auth, validUntilMs: nowMs - 1 } }), { ready: false, blocker: "AUTHORIZATION_EXPIRED" });
  assert.deepEqual(blocked({ requested: { ...base.requested, notionalUsd: 1001 } }), { ready: false, blocker: "NOTIONAL_EXCEEDED" });
  assert.deepEqual(blocked({ requested: { ...base.requested, leverageBps: 201 } }), { ready: false, blocker: "LEVERAGE_EXCEEDED" });
  assert.deepEqual(blocked({ requested: { ...base.requested, slippageBps: 31 } }), { ready: false, blocker: "SLIPPAGE_EXCEEDED" });
  assert.deepEqual(blocked({ creatorBonded: false }), { ready: false, blocker: "CREATOR_BOND_INSUFFICIENT" });
  assert.deepEqual(blocked({ executorBonded: false }), { ready: false, blocker: "EXECUTOR_BOND_INSUFFICIENT" });
});
