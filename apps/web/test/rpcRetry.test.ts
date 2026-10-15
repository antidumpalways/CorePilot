import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isRpcRateLimit, retryRpcRead } from "../src/lib/rpcRetry.js";

test("rate-limited reads retry with bounded backoff", async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await retryRpcRead(async () => {
    calls++;
    if (calls < 3) throw new Error("Rate Limit Exceeded");
    return 42;
  }, async ms => { delays.push(ms); });
  assert.equal(value, 42);
  assert.deepEqual(delays, [1500, 3000]);
});

test("non-rate-limit failure is not retried", async () => {
  let calls = 0;
  await assert.rejects(retryRpcRead(async () => { calls++; throw new Error("execution reverted"); }), /execution reverted/);
  assert.equal(calls, 1);
  assert.equal(isRpcRateLimit(new Error("HTTP 429")), true);
});
