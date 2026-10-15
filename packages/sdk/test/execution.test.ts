import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecutionIntent } from "@corepilot/shared";
import { executionIntentToControllerRequest, observeOnchainReceipt } from "../src/execution.js";
import type { OnchainExecutionReceipt } from "../src/client.js";

const intent: ExecutionIntent = {
  strategyId: 7, market: "HYPE", action: { type: "open_position", side: "long" },
  notionalUsd: 1000, leverageBps: 300, slippageBps: 50, createdAtMs: 1800000000000,
};

test("intent maps to the controller's whole-USD tuple", () => {
  const request = executionIntentToControllerRequest(intent);
  assert.equal(request.strategyId, 7n);
  assert.equal(request.notionalUsd, 1000n);
  assert.equal(request.isLong, true);
  assert.equal(request.leverageBps, 300n);
  assert.throws(() => executionIntentToControllerRequest({ ...intent, action: { type: "price" } as never }));
});

const raw: OnchainExecutionReceipt = {
  strategyId: 7, executionId: `0x${"a".repeat(64)}`, notionalUsd: 1000,
  accepted: true, status: "ADAPTER_REQUESTED", reason: `0x${"0".repeat(64)}`,
  timestamp: 1800000000, timestampMs: 1800000000000,
  executor: "0x0000000000000000000000000000000000000001",
};

test("accepted receipt means adapter request, never venue fill", () => {
  const observation = observeOnchainReceipt(1, raw);
  assert.equal(observation.status, "ADAPTER_REQUESTED");
  assert.equal(observation.venueFillStatus, "NOT_CONFIRMED");
  if (observation.status === "ADAPTER_REQUESTED") {
    assert.equal(observation.receipt.status, "ADAPTER_REQUESTED");
    assert.equal(observation.receipt.onchainReceiptId, "1");
  }
});

test("executor-reported rejection is not a verified policy denial", () => {
  const observation = observeOnchainReceipt(2, {
    ...raw, status: "EXECUTOR_REJECTION_REPORTED", accepted: false,
    executionId: `0x${"0".repeat(64)}`,
  });
  assert.equal(observation.status, "EXECUTOR_REJECTION_REPORTED");
  assert.equal(observation.venueFillStatus, "NOT_CONFIRMED");
  assert.throws(() => observeOnchainReceipt(3, { ...raw, accepted: false }));
});
