import "dotenv/config";
import { getDb } from "./db/client.js";
import {
  marketSnapshots,
  strategies,
  strategyMetrics,
} from "./db/schema.js";
import { dbAvailable } from "./lib/dbAvailable.js";

const now = Date.now();

const STRATEGIES = [
  {
    chainStrategyId: 1,
    creator: "0x0000000000000000000000000000000000000001",
    name: "HYPE Funding Long",
    description: "Long HYPE when hourly funding drops below zero.",
    market: "HYPE",
    strategyType: "FUNDING_TRIGGER",
    metadataUri: "ipfs://corepilot/hype-funding-long",
  },
  {
    chainStrategyId: 2,
    creator: "0x0000000000000000000000000000000000000002",
    name: "BTC Momentum Short",
    description: "Short BTC on sustained negative funding.",
    market: "BTC",
    strategyType: "FUNDING_TRIGGER",
    metadataUri: "ipfs://corepilot/btc-momentum-short",
  },
  {
    chainStrategyId: 3,
    creator: "0x0000000000000000000000000000000000000003",
    name: "ETH Neutral Basis",
    description: "Capture basis on ETH funding extremes.",
    market: "ETH",
    strategyType: "FUNDING_TRIGGER",
    metadataUri: "ipfs://corepilot/eth-neutral-basis",
  },
];

const SNAPSHOTS = [
  {
    market: "HYPE",
    markPrice: 42.15,
    fundingRateBps: -1.4,
    source: "hyperliquid",
    timestamp: now - 3_600_000,
    signature: null,
  },
  {
    market: "BTC",
    markPrice: 68_450.5,
    fundingRateBps: 0.8,
    source: "hyperliquid",
    timestamp: now - 3_600_000,
    signature: null,
  },
  {
    market: "ETH",
    markPrice: 3_320.75,
    fundingRateBps: -2.1,
    source: "hyperliquid",
    timestamp: now - 3_600_000,
    signature: null,
  },
];

async function main(): Promise<void> {
  if (!(await dbAvailable())) {
    console.log("[seed] DATABASE_URL not set or database unreachable; skipping.");
    return;
  }

  const db = getDb();
  if (!db) {
    console.log("[seed] database client unavailable; skipping.");
    return;
  }

  const insertedStrategies = await db
    .insert(strategies)
    .values(STRATEGIES)
    .returning();

  await db.insert(marketSnapshots).values(SNAPSHOTS).onConflictDoNothing();

  await db
    .insert(strategyMetrics)
    .values(
      insertedStrategies.map((strategy, index) => ({
        strategyId: strategy.id,
        executionCount: index + 2,
        successCount: index + 1,
        rejectedCount: 1,
        volume: 1_000 * (index + 1),
      })),
    )
    .onConflictDoNothing();

  console.log(
    `[seed] inserted ${insertedStrategies.length} strategies and ${SNAPSHOTS.length} snapshots.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[seed] failed:", error);
    process.exit(1);
  });
