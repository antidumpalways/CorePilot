import assert from "node:assert/strict";
import { test } from "node:test";
import type { TradingAccess } from "@corepilot/shared";
import { inspectTradingAccessAtVenue, verifyTradingAccessAtVenue } from "./verifyTradingAccess.js";

const trader = `0x${"1".repeat(40)}` as const;
const subaccount = `0x${"2".repeat(40)}` as const;
const agentAddress = `0x${"3".repeat(40)}` as const;
const base: TradingAccess = { trader, executionAccount: subaccount, agentAddress,
  isolationMode: "ISOLATED", status: "ACTIVE", verifiedAtMs: Date.now(), expiresAtMs: Date.now() + 60000 };

test("testnet agent and subaccount roles must both bind to trader", async () => {
  const calls: unknown[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.hyperliquid-testnet.xyz/info");
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return new Response(JSON.stringify(body.user === agentAddress
      ? { role: "agent", data: { user: trader } }
      : { role: "subAccount", data: { master: trader } }));
  }) as typeof fetch;
  assert.equal(await verifyTradingAccessAtVenue(base, request), true);
  assert.deepEqual(calls, [
    { type: "userRole", user: agentAddress },
    { type: "userRole", user: subaccount },
  ]);
  assert.equal(await verifyTradingAccessAtVenue({ ...base, executionAccount: trader }, request), false);
});

test("wrong agent owner, missing role, and unavailable venue fail closed", async () => {
  const wrongOwner = (async () => new Response(JSON.stringify({ role: "agent", data: { user: subaccount } }))) as typeof fetch;
  const missing = (async () => new Response(JSON.stringify({ role: "missing" }))) as typeof fetch;
  const offline = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal(await verifyTradingAccessAtVenue(base, wrongOwner), false);
  assert.equal(await verifyTradingAccessAtVenue(base, missing), false);
  assert.equal(await verifyTradingAccessAtVenue(base, offline), false);
  assert.deepEqual(await inspectTradingAccessAtVenue(base, wrongOwner), { ready: false, reason: "AGENT_WRONG_OWNER" });
  assert.deepEqual(await inspectTradingAccessAtVenue(base, missing), { ready: false, reason: "AGENT_NOT_APPROVED" });
  assert.deepEqual(await inspectTradingAccessAtVenue(base, offline), { ready: false, reason: "VENUE_UNAVAILABLE" });
});
