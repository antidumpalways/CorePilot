import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { executionIntents, marketSnapshots, reconciliationEvents, traderAuthorizations,
  triggerEvents, venueReceipts } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";

export async function runtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { authorizationId: string } }>("/api/runtime/authorization/:authorizationId", async (request, reply) => {
    const id = request.params.authorizationId;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return reply.code(400).send({ error: "INVALID_AUTHORIZATION_ID" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const db = getDb()!;
    const [auth] = await db.select({ authorizationId: traderAuthorizations.authorizationId,
      strategyId: traderAuthorizations.chainStrategyId, trader: traderAuthorizations.trader,
      status: traderAuthorizations.status }).from(traderAuthorizations)
      .where(eq(traderAuthorizations.authorizationId, id)).limit(1);
    if (!auth) return reply.code(404).send({ error: "AUTHORIZATION_NOT_FOUND" });
    const triggers = await db.select().from(triggerEvents)
      .where(eq(triggerEvents.authorizationId, id)).orderBy(desc(triggerEvents.id)).limit(10);
    const intents = await db.select().from(executionIntents)
      .where(eq(executionIntents.authorizationId, id)).orderBy(desc(executionIntents.createdAt)).limit(10);
    const triggerData = await Promise.all(triggers.map(async trigger => {
      const [snapshot] = await db.select({ market: marketSnapshots.market,
        fundingRateBps: marketSnapshots.fundingRateBps, source: marketSnapshots.source,
        observedAtMs: marketSnapshots.timestamp }).from(marketSnapshots)
        .where(eq(marketSnapshots.id, trigger.snapshotId)).limit(1);
      return { id: trigger.id, matched: trigger.matched, reason: trigger.reason,
        policyHash: trigger.policyHash, observedAt: trigger.createdAt,
        snapshot: snapshot ?? null };
    }));
    const intentData = await Promise.all(intents.map(async intent => {
      const [venue] = await db.select().from(venueReceipts)
        .where(eq(venueReceipts.intentId, intent.intentId)).limit(1);
      const events = await db.select({ status: reconciliationEvents.venueStatus,
        observedAt: reconciliationEvents.observedAt }).from(reconciliationEvents)
        .where(eq(reconciliationEvents.intentId, intent.intentId))
        .orderBy(desc(reconciliationEvents.id)).limit(5);
      return { intentId: intent.intentId, triggerId: intent.triggerId,
        status: intent.status, market: intent.market, side: intent.side,
        notionalUsd: intent.notionalUsd, leverageBps: intent.leverageBps,
        slippageBps: intent.slippageBps, executionAccount: intent.executionAccount,
        expiresAt: intent.expiresAt, createdAt: intent.createdAt,
        corePilotReceipt: { policyHash: intent.policyHash, authorizationId: intent.authorizationId,
          triggerId: intent.triggerId, intentId: intent.intentId },
        venueReceipt: venue ? { venue: venue.venue, clientOrderId: venue.clientOrderId,
          orderId: venue.orderId, status: venue.status, filledSize: venue.filledSize,
          averagePrice: venue.averagePrice, lastReconciledAt: venue.lastReconciledAt,
          events } : null };
    }));
    return { authorization: auth, signalSource: "hypercore-mainnet",
      policyLayer: "elysium-testnet", executionVenue: "hypercore-testnet",
      triggers: triggerData, intents: intentData, provenance: "recorded-runtime" };
  });
}
