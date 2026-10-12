import {
  bigint,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const strategies = pgTable("strategies", {
  id: serial("id").primaryKey(),
  chainStrategyId: integer("chain_strategy_id"),
  creator: text("creator"),
  name: text("name"),
  description: text("description"),
  market: text("market"),
  strategyType: text("strategy_type"),
  metadataUri: text("metadata_uri"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketSnapshots = pgTable("market_snapshots", {
  id: serial("id").primaryKey(),
  market: text("market"),
  markPrice: doublePrecision("mark_price"),
  fundingRateBps: doublePrecision("funding_rate_bps"),
  source: text("source"),
  timestamp: bigint("timestamp", { mode: "number" }),
  signature: text("signature"),
});

export const executionAttempts = pgTable("execution_attempts", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id"),
  marketSnapshotId: integer("market_snapshot_id"),
  requestedNotional: doublePrecision("requested_notional"),
  status: text("status"),
  txHash: text("tx_hash"),
  externalExecutionId: text("external_execution_id"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const strategyMetrics = pgTable("strategy_metrics", {
  strategyId: integer("strategy_id").primaryKey(),
  executionCount: integer("execution_count").default(0),
  successCount: integer("success_count").default(0),
  rejectedCount: integer("rejected_count").default(0),
  volume: doublePrecision("volume").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type StrategyRow = typeof strategies.$inferSelect;
export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
export type ExecutionAttemptRow = typeof executionAttempts.$inferSelect;
export type StrategyMetricRow = typeof strategyMetrics.$inferSelect;
