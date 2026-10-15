import { test } from "node:test";
import { strict as assert } from "node:assert";
import { boundedGasLimit, bufferedEip1559Fees } from "../src/fees.js";

test("fee headroom stays above a slightly rising base fee", () => {
  const quote = bufferedEip1559Fees(100_050_000n, 10_000n);
  assert.equal(quote.maxFeePerGas, 300_160_000n);
  assert.equal(quote.maxPriorityFeePerGas, 10_000n);
  assert.ok(quote.maxFeePerGas > 100_050_000n);
});

test("fee safety ceiling fails closed", () => {
  assert.throws(() => bufferedEip1559Fees(800_000_000n, 1n), /SAFETY_LIMIT/);
  assert.throws(() => bufferedEip1559Fees(null, 1n), /FEE_UNAVAILABLE/);
});

test("gas estimate has bounded margin and refuses absurd block-limit fallback", () => {
  assert.equal(boundedGasLimit(113_000n, 250_000n), 151_250n);
  assert.throws(() => boundedGasLimit(1_125_899_906_842_624n, 250_000n), /SAFETY_LIMIT/);
});
