import { fetchHyperliquidSnapshot } from "../lib/hyperliquidSnapshot.js";

const snapshot = await fetchHyperliquidSnapshot("HYPE");
process.stdout.write(`${snapshot.source} ${snapshot.market} ${snapshot.fundingRateBps.toFixed(4)} bps receipt=${new Date(snapshot.timestampMs).toISOString()}\n`);
