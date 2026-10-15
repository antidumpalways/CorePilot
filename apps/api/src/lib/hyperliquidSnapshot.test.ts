import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchHyperliquidSnapshot } from "./hyperliquidSnapshot.js";

test("funding signal uses mainnet info and labels receipt time honestly", async () => {
  let url = "";
  const request = (async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify([
      { universe: [{ name: "HYPE" }] }, [{ funding: "-0.0001" }],
    ]), { status: 200 });
  }) as typeof fetch;
  const before = Date.now();
  const snapshot = await fetchHyperliquidSnapshot("HYPE", request);
  assert.equal(url, "https://api.hyperliquid.xyz/info");
  assert.equal(snapshot.source, "hypercore-mainnet");
  assert.equal(snapshot.fundingRateBps, -1);
  assert.ok(snapshot.timestampMs >= before && snapshot.timestampMs <= Date.now());
});

test("missing or malformed market data fails closed", async () => {
  const request = (async () => new Response(JSON.stringify([
    { universe: [{ name: "BTC" }] }, [{ funding: "nope" }],
  ]))) as typeof fetch;
  await assert.rejects(fetchHyperliquidSnapshot("HYPE", request));
  await assert.rejects(fetchHyperliquidSnapshot("../../x", request));
});
