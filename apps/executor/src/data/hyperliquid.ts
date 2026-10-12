import type { MarketData } from "@corepilot/shared";

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
export async function fetchMarketContext(apiUrl: string, market: string): Promise<MarketData> {
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

  const ctx = ctxs[idx] ?? {};
  const markPrice = Number(ctx.markPx ?? ctx.oraclePx ?? ctx.midPx ?? 0);
  // funding is an hourly rate as a decimal (e.g. 0.0000125 == 0.125 bps)
  const fundingRateBps = Number(ctx.funding ?? 0) * 10_000;

  return {
    market: market.toUpperCase(),
    markPrice,
    fundingRateBps,
    timestamp: Date.now(),
    source: "hyperliquid",
  };
}
