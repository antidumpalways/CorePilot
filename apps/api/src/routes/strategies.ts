import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { createCorePilotClient, type StrategyRecord } from "@corepilot/sdk";
import { ELYSIUM_TESTNET_CHAIN_ID } from "@corepilot/shared";
import { getDb } from "../db/client.js";
import { executionAttempts, strategies } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";

function normalizeStrategy(row: typeof strategies.$inferSelect) {
  return {
    identity: { id: row.id, chainStrategyId: row.chainStrategyId },
    creator: row.creator,
    name: row.name,
    description: row.description,
    strategyType: row.strategyType,
    market: row.market ? { symbol: row.market } : null,
    // The current index does not store signal/action parameters or on-chain constraints.
    signal: null,
    action: null,
    constraints: null,
    active: null,
    expiry: null,
    source: { provenance: row.provenance, metadataUri: row.metadataUri },
    createdAt: row.createdAt,
  };
}

const CHAIN_CACHE_MS = 15_000;
const MAX_CHAIN_ROWS = 100;
let chainCache: { at: number; rows: ReturnType<typeof normalizeChainStrategy>[] } | null = null;

function normalizeChainStrategy(record: StrategyRecord, bonded: bigint) {
  return {
    identity: { id: record.id, chainStrategyId: record.id },
    creator: record.creator,
    name: `${record.market} Funding Strategy #${record.id}`,
    description: null,
    market: { symbol: record.market },
    strategyType: record.strategyType,
    signal: null,
    action: null,
    constraints: { maxNotionalUsd: record.maxNotionalUsd, maxLeverageBps: record.maxLeverageBps,
      maxSlippageBps: record.maxSlippageBps },
    active: record.active,
    expiry: record.expiry,
    pilotBacking: Number(bonded / 10n ** 18n),
    source: { provenance: "testnet", metadataUri: null },
    createdAt: null,
  };
}

async function chainStrategies() {
  if (chainCache && chainCache.rows.length > 0 && Date.now() - chainCache.at < CHAIN_CACHE_MS) return chainCache.rows;
  const registry = process.env.STRATEGY_REGISTRY_ADDRESS as `0x${string}` | undefined;
  const staking = process.env.STAKING_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.ELYSIUM_RPC_URL;
  if (!registry || !staking || !rpcUrl) return [];
  const client = createCorePilotClient({ rpcUrl, addresses: { registry, staking } });
  if (await client.publicClient.getChainId() !== ELYSIUM_TESTNET_CHAIN_ID) throw new Error("CHAIN_MISMATCH");
  const nextId = await client.read.nextStrategyId();
  const rows: ReturnType<typeof normalizeChainStrategy>[] = [];
  for (let id = nextId - 1; id >= Math.max(1, nextId - MAX_CHAIN_ROWS); id--) {
    const record = await client.read.getStrategyRecord(id);
    const bonded = await client.read.getCreatorBond(id);
    rows.push(normalizeChainStrategy(record, bonded));
  }
  chainCache = { at: Date.now(), rows };
  return rows;
}

function normalizeExecution(row: typeof executionAttempts.$inferSelect) {
  return {
    strategyId: row.strategyId,
    executionId: row.externalExecutionId,
    status: row.status,
    reason: row.error,
    transaction: row.txHash,
    timestamp: row.createdAt,
    provenance: row.provenance,
  };
}

interface StrategyIdParams {
  id: string;
}

function parseId(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function strategiesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/strategies", async (_request, _reply) => {
    const available = await dbAvailable();
    const db = getDb();
    const rows = available && db ? await db.select().from(strategies).orderBy(desc(strategies.createdAt)) : [];
    let live: Awaited<ReturnType<typeof chainStrategies>> = [];
    let chainError: string | null = null;
    try { live = await chainStrategies(); }
    catch (error) { chainError = error instanceof Error ? error.message : "Chain registry unavailable"; }
    const indexed = rows.map(normalizeStrategy);
    const liveIds = new Set<number | null>(live.map(row => row.identity.chainStrategyId));
    return { data: [...live, ...indexed.filter(row => !liveIds.has(row.identity.chainStrategyId))], db: available,
      chainError };
  });

  app.get<{ Params: StrategyIdParams }>(
    "/api/strategies/:id",
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "invalid strategy id", db: false });
      }

      const live = await chainStrategies().catch(() => []);
      const onChain = live.find(row => row.identity.id === id);
      if (onChain) return { data: onChain, db: await dbAvailable() };
      if (!(await dbAvailable())) return { data: null, db: false };
      const db = getDb();
      if (!db) return { data: null, db: false };

      const rows = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, id))
        .limit(1);

      return { data: rows[0] ? normalizeStrategy(rows[0]) : null, db: true };
    },
  );

  app.get<{ Params: StrategyIdParams }>(
    "/api/strategies/:id/executions",
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "invalid strategy id", db: false });
      }

      if (!(await dbAvailable())) return { data: [], db: false };
      const db = getDb();
      if (!db) return { data: [], db: false };

      const rows = await db
        .select()
        .from(executionAttempts)
        .where(eq(executionAttempts.strategyId, id))
        .orderBy(desc(executionAttempts.createdAt));

      return { data: rows.map(normalizeExecution), db: true };
    },
  );
}
