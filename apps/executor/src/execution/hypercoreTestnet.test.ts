import assert from "node:assert/strict";
import { test } from "node:test";
import { cloidForIntent, prepareIocOrder, type VenueIntent } from "./hypercoreTestnet.js";

const now = 2_000_000;
const intent: VenueIntent = { intentId: `0x${"a".repeat(64)}`,
  trader: `0x${"1".repeat(40)}`, agentAddress: `0x${"2".repeat(40)}`,
  executionAccount: `0x${"3".repeat(40)}`, isolationMode: "ISOLATED",
  market: "HYPE", side: "long", notionalUsd: 12,
  leverageBps: 100, slippageBps: 50, expiresAtMs: now + 30000 };
const meta = { universe: [{ name: "HYPE", szDecimals: 2 }] };
const book = { time: now, levels: [[{ px: "19.99" }], [{ px: "20.00" }]] as [{ px: string }[], { px: string }[]] };

test("IOC quote is bounded and cloid is deterministic", () => {
  const order = prepareIocOrder(intent, meta, book, now);
  assert.equal(order.asset, 0);
  assert.equal(order.cloid, cloidForIntent(intent.intentId));
  assert.ok(Number(order.price) <= 20.1);
  assert.ok(Number(order.size) * Number(order.price) <= 12);
  assert.ok(Number(order.size) * 20 >= 10);
});

test("stale book, expired intent and insufficient venue notional block", () => {
  assert.throws(() => prepareIocOrder(intent, meta, { ...book, time: now - 11000 }, now), /STALE/);
  assert.throws(() => prepareIocOrder({ ...intent, expiresAtMs: now }, meta, book, now), /BOUNDS/);
  assert.throws(() => prepareIocOrder({ ...intent, notionalUsd: 10 }, meta, book, now), /MIN_NOTIONAL/);
  assert.throws(() => cloidForIntent("bad"), /INVALID_INTENT/);
});
