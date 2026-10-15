import assert from "node:assert/strict";
import { test } from "node:test";
import { redactLogValue } from "./logger.js";

test("executor logs redact secret values and raw 32-byte hex", () => {
  const secret = `0x${"a".repeat(64)}`;
  const previous = process.env.HYPERCORE_TESTNET_AGENT_PRIVATE_KEY;
  try {
    process.env.HYPERCORE_TESTNET_AGENT_PRIVATE_KEY = secret;
    assert.equal(redactLogValue(`agent=${secret}`).includes(secret), false);
    assert.equal(redactLogValue(new Error(`failed ${secret}`)).includes(secret), false);
    assert.equal(redactLogValue(`hash=0x${"b".repeat(64)}`).includes(`0x${"b".repeat(64)}`), false);
  } finally {
    if (previous === undefined) delete process.env.HYPERCORE_TESTNET_AGENT_PRIVATE_KEY;
    else process.env.HYPERCORE_TESTNET_AGENT_PRIVATE_KEY = previous;
  }
});
