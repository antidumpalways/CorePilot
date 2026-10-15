import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { isTradingAccessGrantV1, tradingAccessSigningMessage } from "@corepilot/shared";
import { tradingAccessRoutes } from "../routes/tradingAccess.js";

const account = privateKeyToAccount(`0x${"4".repeat(64)}`);
const grant = { version: 1, authorizationId: "00000000-0000-4000-8000-000000000001",
  chainId: 99801, registry: `0x${"5".repeat(40)}`, trader: account.address,
  executionAccount: `0x${"6".repeat(40)}`, agentAddress: `0x${"7".repeat(40)}`,
  isolationMode: "ISOLATED", validUntilMs: Date.now() + 60_000 } as const;

test("trading access signature binds agent, account and explicit isolation choice", async () => {
  assert.equal(isTradingAccessGrantV1(grant), true);
  const signature = await account.signMessage({ message: tradingAccessSigningMessage(grant) });
  assert.equal(await verifyMessage({ address: account.address,
    message: tradingAccessSigningMessage(grant), signature }), true);
  assert.equal(await verifyMessage({ address: account.address,
    message: tradingAccessSigningMessage({ ...grant, isolationMode: "COMPATIBILITY" }), signature }), false);
  assert.equal(await verifyMessage({ address: account.address,
    message: tradingAccessSigningMessage({ ...grant, agentAddress: `0x${"8".repeat(40)}` }), signature }), false);
  assert.equal(isTradingAccessGrantV1({ ...grant, privateKey: "secret" }), false);
});

test("trading access enrollment rejects malformed grants and unavailable DB", async () => {
  const oldUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const app = Fastify();
  try {
    await app.register(tradingAccessRoutes);
    const malformed = await app.inject({ method: "POST", url: "/api/trading-access",
      payload: { grant: { ...grant, isolationMode: "AUTO" }, signature: `0x${"0".repeat(130)}` } });
    assert.equal(malformed.statusCode, 400);
    const unavailable = await app.inject({ method: "POST", url: "/api/trading-access",
      payload: { grant, signature: `0x${"0".repeat(130)}` } });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().error, "DATABASE_UNAVAILABLE");
  } finally {
    await app.close();
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  }
});
