import type { MarketContext } from "../engine/types.js";

interface HLAssetCtx {
  funding?: string;
  markPx?: string;
  oraclePx?: string;
  midPx?: string;
}
interface HLMeta {
  universe: Array<{ name: string }>;
}

/**
 * Fetch the current mark price and funding rate for a market from Hyperliquid.
 * Uses the public `metaAndAssetCtxs` info request (no key required).
 */
export async function fetchMarketContext(apiUrl: string, market: string): Promise<MarketContext> {
  const res = await fetch(`${apiUrl}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  if (!res.ok) throw new Error(`hyperliquid info responded ${res.status}`);
  const json = (await res.json()) as [HLMeta, HLAssetCtx[]];
  const [meta, ctxs] = json;

  const idx = meta.universe.findIndex((u) => u.name.toUpperCase() === market.toUpperCase());
  if (idx < 0) throw new Error(`hyperliquid market not found: ${market}`);

  const ctx = ctxs[idx];
  if (!ctx || ctx.funding === undefined ||
      (ctx.markPx === undefined && ctx.oraclePx === undefined && ctx.midPx === undefined)) {
    throw new Error(`hyperliquid market data incomplete: ${market}`);
  }
  const markPrice = Number(ctx.markPx ?? ctx.oraclePx ?? ctx.midPx);
  // funding is an hourly rate as a decimal (e.g. 0.0000125 == 0.125 bps)
  const fundingRateBps = Number(ctx.funding) * 10_000;
  if (!Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(fundingRateBps)) {
    throw new Error(`hyperliquid market data invalid: ${market}`);
  }

  return {
    market: market.toUpperCase(),
    markPrice,
    fundingRateBps,
    timestamp: Date.now(),
    source: "hyperliquid",
  };
}
