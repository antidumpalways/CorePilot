import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTradingAccess, type TradingAccess } from "@corepilot/shared";

const trader = `0x${"1".repeat(40)}` as const;
const subaccount = `0x${"2".repeat(40)}` as const;
const agent = `0x${"3".repeat(40)}` as const;
const now = 2_000_000;
const base: TradingAccess = { trader, executionAccount: subaccount, agentAddress: agent,
  isolationMode: "ISOLATED", status: "ACTIVE", verifiedAtMs: now - 1000, expiresAtMs: now + 10000 };

test("trading access requires explicit verified identity", () => {
  assert.equal(checkTradingAccess(base, now, 5000), null);
  assert.equal(checkTradingAccess(null, now, 5000), "TRADING_AGENT_UNVERIFIED");
  assert.equal(checkTradingAccess({ ...base, status: "REVOKED" }, now, 5000), "TRADING_AGENT_REVOKED");
  assert.equal(checkTradingAccess({ ...base, verifiedAtMs: now - 6000 }, now, 5000), "AGENT_VERIFICATION_STALE");
  assert.equal(checkTradingAccess({ ...base, executionAccount: trader }, now, 5000), "EXECUTION_ACCOUNT_UNVERIFIED");
  assert.equal(checkTradingAccess({ ...base, isolationMode: "COMPATIBILITY" }, now, 5000), "EXECUTION_ACCOUNT_UNVERIFIED");
  assert.equal(checkTradingAccess({ ...base, isolationMode: "COMPATIBILITY", executionAccount: trader }, now, 5000), null);
});
