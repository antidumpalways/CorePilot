import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { hashMessage, isAddress, verifyMessage } from "viem";
import { authorizationSigningMessage, evaluateOperational, isFundingMatch,
  type OperationalSnapshot } from "@corepilot/shared";
import { createCorePilotClient } from "@corepilot/sdk";
import { getDb } from "../db/client.js";
import { executionIntents, marketSnapshots, traderAuthorizations, triggerEvents } from "../db/schema.js";
import { fetchHyperliquidSnapshot } from "../lib/hyperliquidSnapshot.js";
import { configuredRegistry } from "../lib/policyIdentity.js";
import { currentPolicy, fromAuthorization, fromPolicy, verifiedPolicy } from "../routes/policies.js";
import { verifiedTradingAccess } from "../routes/tradingAccess.js";

const pollMs = Number(process.env.WATCHER_POLL_MS ?? 15000);
const requestedNotional = Number(process.env.RUNTIME_ORDER_NOTIONAL_USD ?? 12);
const requestedLeverage = Number(process.env.RUNTIME_LEVERAGE_BPS ?? 100);
const requestedSlippage = Number(process.env.RUNTIME_SLIPPAGE_BPS ?? 50);

function safeConfig(): boolean {
  return Number.isSafeInteger(pollMs) && pollMs >= 5000 &&
    Number.isSafeInteger(requestedNotional) && requestedNotional > 0 && requestedNotional <= 25 &&
    Number.isSafeInteger(requestedLeverage) && requestedLeverage >= 100 && requestedLeverage <= 200 &&
    Number.isSafeInteger(requestedSlippage) && requestedSlippage >= 0 && requestedSlippage <= 100 &&
    Boolean(configuredRegistry()) && Boolean(process.env.STAKING_ADDRESS && isAddress(process.env.STAKING_ADDRESS)) &&
    Boolean(process.env.EXECUTOR_ADDRESS && isAddress(process.env.EXECUTOR_ADDRESS));
}

export async function runWatcherCycle(): Promise<{ observed: number; triggers: number; intents: number }> {
  if (!safeConfig()) throw new Error("WATCHER_CONFIGURATION_INCOMPLETE");
  const db = getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db.select().from(traderAuthorizations).where(eq(traderAuthorizations.status, "ACTIVE"));
  // No active trader means no on-chain work. Avoid exhausting the public RPC
  // while the creator is completing the first strategy/bond flow.
  if (rows.length === 0) return { observed: 0, triggers: 0, intents: 0 };
  const registry = configuredRegistry()!;
  const client = createCorePilotClient({ rpcUrl: process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz",
    addresses: { registry, staking: process.env.STAKING_ADDRESS as `0x${string}` } });
  if (await client.publicClient.getChainId() !== 99801) throw new Error("CHAIN_MISMATCH");
  const executorBonded = await client.read.isExecutorBonded(process.env.EXECUTOR_ADDRESS as `0x${string}`);
  const snapshots = new Map<string, { value: OperationalSnapshot; id: number }>();
  let triggers = 0;
  let intents = 0;
  for (const row of rows) {
    try {
      const now = Date.now();
      if (row.validUntilMs <= now) continue;
      const authorization = fromAuthorization(row);
      if (!await verifyMessage({ address: authorization.trader,
        message: authorizationSigningMessage({ ...authorization, version: 1 }),
        signature: row.signature as `0x${string}` })) continue;
      const policyRow = await currentPolicy(row.chainStrategyId);
      if (!policyRow || await verifiedPolicy(policyRow) || !policyRow.enabled ||
          policyRow.policyHash.toLowerCase() !== row.policyHash.toLowerCase() ||
          policyRow.version !== row.policyVersion) continue;
      const policy = fromPolicy(policyRow);
      let snapshot = snapshots.get(policy.market);
      if (!snapshot) {
        const value = await fetchHyperliquidSnapshot(policy.market);
        const [stored] = await db.insert(marketSnapshots).values({ market: value.market,
          fundingRateBps: value.fundingRateBps, source: value.source, timestamp: value.timestampMs,
          provenance: "live-mainnet-receipt" }).returning({ id: marketSnapshots.id });
        snapshot = { value, id: stored.id };
        snapshots.set(policy.market, snapshot);
      }
      const matched = isFundingMatch(policy, snapshot.value.fundingRateBps);
      const [strategy, creatorBonded] = await Promise.all([
        client.read.getStrategyRecord(row.chainStrategyId),
        client.read.isCreatorBonded(row.chainStrategyId),
      ]);
      const decision = evaluateOperational({ strategy, policy, authorization,
        authorizationStatus: row.status as "ACTIVE", snapshot: snapshot.value,
        requested: { notionalUsd: requestedNotional, leverageBps: requestedLeverage,
          slippageBps: requestedSlippage }, creatorBonded, executorBonded,
        nowMs: Date.now(), maxSnapshotAgeMs: 60_000 });
      const access = decision.ready ? await verifiedTradingAccess(row) : null;
      const reason = !matched ? "SIGNAL_NOT_MATCHED" : !decision.ready ? decision.blocker :
        !access ? "TRADING_AGENT_UNVERIFIED" : "READY";
      const result = await db.transaction(async tx => {
        // Serialize evaluations of one authorization across concurrent watcher processes.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${row.authorizationId}))`);
        const [last] = await tx.select().from(triggerEvents)
          .where(eq(triggerEvents.authorizationId, row.authorizationId))
          .orderBy(desc(triggerEvents.id)).limit(1);
        if (last?.matched === matched) return { trigger: false, intent: false };
        const [event] = await tx.insert(triggerEvents).values({ strategyId: row.chainStrategyId,
          authorizationId: row.authorizationId, snapshotId: snapshot.id,
          policyHash: policyRow.policyHash, matched, reason }).returning({ id: triggerEvents.id });
        if (!matched || !decision.ready || !access) return { trigger: true, intent: false };
        const [unresolved] = await tx.select({ intentId: executionIntents.intentId }).from(executionIntents)
          .where(and(eq(executionIntents.authorizationId, row.authorizationId),
            inArray(executionIntents.status, ["CREATED", "SUBMITTING", "SUBMITTED", "OPEN", "UNKNOWN"]))).limit(1);
        if (unresolved) return { trigger: true, intent: false };
        const canonical = ["CorePilot Intent V1", row.authorizationId, policyRow.policyHash,
          snapshot.id, event.id, access.executionAccount.toLowerCase(), access.agentAddress.toLowerCase(),
          policy.market, policy.action.side, requestedNotional, requestedLeverage, requestedSlippage].join("\n");
        await tx.insert(executionIntents).values({ intentId: hashMessage(canonical),
          triggerId: event.id, authorizationId: row.authorizationId,
          agentId: (await tx.query.tradingAgents.findFirst({ where: (agent, { eq }) => eq(agent.authorizationId, row.authorizationId) }))!.id,
          strategyId: row.chainStrategyId, policyHash: policyRow.policyHash,
          executionAccount: access.executionAccount.toLowerCase(), market: policy.market,
          side: policy.action.side, notionalUsd: requestedNotional,
          leverageBps: requestedLeverage, slippageBps: requestedSlippage,
          status: "CREATED", expiresAt: new Date(Date.now() + 30_000) });
        return { trigger: true, intent: true };
      });
      if (result.trigger) triggers++;
      if (result.intent) intents++;
    } catch (error) {
      // One invalid authorization/market cannot authorize or block a different trader.
      console.error("watcher authorization cycle failed", row.authorizationId, error instanceof Error ? error.message : "UNKNOWN");
    }
  }
  return { observed: snapshots.size, triggers, intents };
}

/** Opt-in in-process MVP watcher; never dispatches venue orders by itself. */
export function startWatcher(log: { info: (message: string) => void; error: (message: string) => void }): void {
  if (process.env.WATCHER_ENABLED !== "true") return;
  if (!safeConfig()) { log.error("Watcher disabled: configuration incomplete"); return; }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runWatcherCycle();
      if (result.triggers || result.intents) log.info(`Watcher: ${result.triggers} trigger(s), ${result.intents} intent(s)`);
    } catch (error) { log.error(`Watcher cycle failed: ${error instanceof Error ? error.message : "UNKNOWN"}`); }
    finally { running = false; }
  };
  void tick();
  setInterval(() => void tick(), pollMs).unref();
}
