import type { OperationalSnapshot } from "@corepilot/shared";

const MAINNET_API = "https://api.hyperliquid.xyz";

/** Live HyperCore mainnet signal. timestampMs is local receipt time, not venue event time. */
export async function fetchHyperliquidSnapshot(market: string, request: typeof fetch = fetch): Promise<OperationalSnapshot> {
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(market)) throw new Error("Invalid market");
  const response = await request(`${MAINNET_API}/info`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HyperCore mainnet info HTTP ${response.status}`);
  const result = await response.json() as [{ universe: { name: string }[] }, { funding?: string }[]];
  if (!Array.isArray(result) || !Array.isArray(result[0]?.universe) || !Array.isArray(result[1])) {
    throw new Error("HyperCore mainnet info shape invalid");
  }
  const index = result[0].universe.findIndex(asset => asset.name === market);
  const funding = index >= 0 ? Number(result[1][index]?.funding) : NaN;
  if (!Number.isFinite(funding)) throw new Error("Hyperliquid funding unavailable");
  return { market, fundingRateBps: funding * 10_000,
    timestampMs: Date.now(), source: "hypercore-mainnet" };
}
