import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  provenance: text("provenance").notNull().default("unknown"),
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
  provenance: text("provenance").notNull().default("unknown"),
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
  provenance: text("provenance").notNull().default("unknown"),
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

/** Creator-signed policy versions bound to one concrete registry deployment. */
export const strategyPolicies = pgTable("strategy_policies", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  registry: text("registry").notNull(),
  chainStrategyId: integer("chain_strategy_id").notNull(),
  creator: text("creator").notNull(),
  version: integer("version").notNull(),
  market: text("market").notNull(),
  thresholdBps: doublePrecision("threshold_bps").notNull(),
  side: text("side").notNull(),
  maxNotionalUsd: integer("max_notional_usd").notNull(),
  maxLeverageBps: integer("max_leverage_bps").notNull(),
  maxSlippageBps: integer("max_slippage_bps").notNull(),
  expiry: bigint("expiry", { mode: "number" }).notNull(),
  enabled: boolean("enabled").notNull(),
  policyHash: text("policy_hash").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ identityVersion: uniqueIndex("policy_identity_version_uq").on(table.chainId, table.registry, table.chainStrategyId, table.version) }));

/** Signed trader limits; status transitions require fresh trader signatures. */
export const traderAuthorizations = pgTable("trader_authorizations", {
  authorizationId: text("authorization_id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  registry: text("registry").notNull(),
  chainStrategyId: integer("chain_strategy_id").notNull(),
  policyVersion: integer("policy_version").notNull(),
  policyHash: text("policy_hash").notNull(),
  trader: text("trader").notNull(),
  version: integer("version").notNull(),
  maxNotionalUsd: integer("max_notional_usd").notNull(),
  maxLeverageBps: integer("max_leverage_bps").notNull(),
  maxSlippageBps: integer("max_slippage_bps").notNull(),
  validFromMs: bigint("valid_from_ms", { mode: "number" }).notNull(),
  validUntilMs: bigint("valid_until_ms", { mode: "number" }).notNull(),
  status: text("status").notNull(),
  signature: text("signature").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const authorizationEvents = pgTable("authorization_events", {
  id: serial("id").primaryKey(),
  authorizationId: text("authorization_id").notNull(),
  trader: text("trader").notNull(),
  version: integer("version").notNull(),
  action: text("action").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ eventVersion: uniqueIndex("authorization_event_version_uq").on(table.authorizationId, table.version) }));

/** Public venue identity only. Agent signing keys must remain in executor secret storage. */
export const tradingAgents = pgTable("trading_agents", {
  id: serial("id").primaryKey(),
  authorizationId: text("authorization_id").notNull(),
  trader: text("trader").notNull(),
  executionAccount: text("execution_account").notNull(),
  agentAddress: text("agent_address").notNull(),
  isolationMode: text("isolation_mode").notNull(),
  status: text("status").notNull().default("UNVERIFIED"),
  grantSignature: text("grant_signature").notNull(),
  verifiedAt: timestamp("verified_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ authorizationAgent: uniqueIndex("trading_agent_authorization_uq").on(table.authorizationId) }));

export const triggerEvents = pgTable("trigger_events", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull(),
  authorizationId: text("authorization_id").notNull(),
  snapshotId: integer("snapshot_id").notNull(),
  policyHash: text("policy_hash").notNull(),
  matched: boolean("matched").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ snapshotAuth: uniqueIndex("trigger_snapshot_authorization_uq").on(table.snapshotId, table.authorizationId) }));

export const executionIntents = pgTable("execution_intents", {
  intentId: text("intent_id").primaryKey(),
  triggerId: integer("trigger_id").notNull().unique(),
  authorizationId: text("authorization_id").notNull(),
  agentId: integer("agent_id").notNull(),
  strategyId: integer("strategy_id").notNull(),
  policyHash: text("policy_hash").notNull(),
  executionAccount: text("execution_account").notNull(),
  market: text("market").notNull(),
  side: text("side").notNull(),
  notionalUsd: integer("notional_usd").notNull(),
  leverageBps: integer("leverage_bps").notNull(),
  slippageBps: integer("slippage_bps").notNull(),
  status: text("status").notNull().default("CREATED"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Never interpret a CorePilot receipt as a venue fill. */
export const venueReceipts = pgTable("venue_receipts", {
  id: serial("id").primaryKey(),
  intentId: text("intent_id").notNull().unique(),
  venue: text("venue").notNull().default("hypercore-testnet"),
  executionAccount: text("execution_account").notNull(),
  clientOrderId: text("client_order_id").notNull().unique(),
  orderId: text("order_id"),
  status: text("status").notNull().default("UNKNOWN"),
  filledSize: text("filled_size"),
  averagePrice: text("average_price"),
  lastReconciledAt: timestamp("last_reconciled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reconciliationEvents = pgTable("reconciliation_events", {
  id: serial("id").primaryKey(),
  intentId: text("intent_id").notNull(),
  venueStatus: text("venue_status").notNull(),
  observedAt: timestamp("observed_at").defaultNow().notNull(),
});

export type StrategyRow = typeof strategies.$inferSelect;
export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
export type ExecutionAttemptRow = typeof executionAttempts.$inferSelect;
export type StrategyMetricRow = typeof strategyMetrics.$inferSelect;
export type StrategyPolicyRow = typeof strategyPolicies.$inferSelect;
export type TraderAuthorizationRow = typeof traderAuthorizations.$inferSelect;
