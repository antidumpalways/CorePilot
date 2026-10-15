import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { isAddress, verifyMessage, type Hex } from "viem";
import { checkTradingAccess, isTradingAccessGrantV1, tradingAccessSigningMessage,
  type TradingAccess, type TradingAccessGrantV1 } from "@corepilot/shared";
import { getDb } from "../db/client.js";
import { tradingAgents, traderAuthorizations, type TraderAuthorizationRow } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";
import { inspectTradingAccessAtVenue, verifyTradingAccessAtVenue } from "../lib/verifyTradingAccess.js";
import { currentPolicy, verifiedPolicy } from "./policies.js";

const isSignature = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);

function fromAgent(row: typeof tradingAgents.$inferSelect): TradingAccess {
  return { trader: row.trader as Hex, executionAccount: row.executionAccount as Hex,
    agentAddress: row.agentAddress as Hex, isolationMode: row.isolationMode as TradingAccess["isolationMode"],
    status: row.status as TradingAccess["status"], verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    expiresAtMs: row.expiresAt.getTime() };
}

async function validGrant(row: typeof tradingAgents.$inferSelect, auth: TraderAuthorizationRow): Promise<boolean> {
  const grant: TradingAccessGrantV1 = { version: 1, authorizationId: row.authorizationId,
    chainId: auth.chainId, registry: auth.registry as Hex, trader: row.trader as Hex,
    executionAccount: row.executionAccount as Hex, agentAddress: row.agentAddress as Hex,
    isolationMode: row.isolationMode as TradingAccessGrantV1["isolationMode"],
    validUntilMs: row.expiresAt.getTime() };
  return isTradingAccessGrantV1(grant) && isSignature(row.grantSignature) &&
    await verifyMessage({ address: grant.trader, message: tradingAccessSigningMessage(grant),
      signature: row.grantSignature as Hex });
}

/** Refresh venue authority before any operational use; cached DB ACTIVE alone is insufficient. */
export async function verifiedTradingAccess(auth: TraderAuthorizationRow): Promise<TradingAccess | null> {
  const db = getDb();
  if (!db || auth.status !== "ACTIVE" || auth.validUntilMs <= Date.now()) return null;
  const [row] = await db.select().from(tradingAgents)
    .where(eq(tradingAgents.authorizationId, auth.authorizationId)).limit(1);
  if (!row || row.status !== "ACTIVE" || row.trader.toLowerCase() !== auth.trader.toLowerCase() ||
      row.expiresAt.getTime() > auth.validUntilMs || !await validGrant(row, auth)) return null;
  const access = fromAgent(row);
  if (checkTradingAccess(access, Date.now(), 60_000)) return null;
  if (!await verifyTradingAccessAtVenue(access)) return null;
  return access;
}

export async function tradingAccessRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/trading-access/check", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).sort().join() !== "agentAddress,authorizationId,executionAccount,isolationMode" ||
        typeof body.authorizationId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(body.authorizationId) ||
        typeof body.executionAccount !== "string" || !isAddress(body.executionAccount) ||
        typeof body.agentAddress !== "string" || !isAddress(body.agentAddress) ||
        (body.isolationMode !== "ISOLATED" && body.isolationMode !== "COMPATIBILITY")) {
      return reply.code(400).send({ error: "INVALID_ACCESS_CHECK" });
    }
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const [auth] = await getDb()!.select().from(traderAuthorizations)
      .where(eq(traderAuthorizations.authorizationId, body.authorizationId)).limit(1);
    if (!auth || auth.status !== "ACTIVE" || auth.validUntilMs <= Date.now()) {
      return reply.code(409).send({ error: "AUTHORIZATION_NOT_ACTIVE" });
    }
    const access: TradingAccess = { trader: auth.trader as Hex,
      executionAccount: body.executionAccount as Hex, agentAddress: body.agentAddress as Hex,
      isolationMode: body.isolationMode, status: "ACTIVE", verifiedAtMs: Date.now(),
      expiresAtMs: auth.validUntilMs };
    return { ...await inspectTradingAccessAtVenue(access), venue: "hypercore-testnet", readOnly: true };
  });

  app.post<{ Body: unknown }>("/api/trading-access", async (request, reply) => {
    const body = request.body as { grant?: unknown; signature?: unknown } | null;
    if (!body || Object.keys(body).sort().join() !== "grant,signature" ||
        !isTradingAccessGrantV1(body.grant) || !isSignature(body.signature)) {
      return reply.code(400).send({ error: "INVALID_SIGNED_TRADING_ACCESS" });
    }
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const grant = body.grant;
    const now = Date.now();
    if (grant.validUntilMs <= now || grant.validUntilMs > now + 30 * 24 * 60 * 60 * 1000) {
      return reply.code(400).send({ error: "TRADING_ACCESS_EXPIRY_INVALID" });
    }
    if (!await verifyMessage({ address: grant.trader,
      message: tradingAccessSigningMessage(grant), signature: body.signature })) {
      return reply.code(403).send({ error: "TRADING_ACCESS_SIGNATURE_INVALID" });
    }
    const db = getDb()!;
    const [auth] = await db.select().from(traderAuthorizations)
      .where(eq(traderAuthorizations.authorizationId, grant.authorizationId)).limit(1);
    if (!auth || auth.status !== "ACTIVE" || auth.validUntilMs <= now ||
        auth.trader.toLowerCase() !== grant.trader.toLowerCase() || auth.chainId !== grant.chainId ||
        auth.registry.toLowerCase() !== grant.registry.toLowerCase() || grant.validUntilMs > auth.validUntilMs) {
      return reply.code(409).send({ error: "AUTHORIZATION_BINDING_INVALID" });
    }
    const policy = await currentPolicy(auth.chainStrategyId);
    if (!policy || !policy.enabled || await verifiedPolicy(policy) ||
        policy.version !== auth.policyVersion || policy.policyHash.toLowerCase() !== auth.policyHash.toLowerCase()) {
      return reply.code(409).send({ error: "POLICY_BINDING_INVALID" });
    }
    const access: TradingAccess = { trader: grant.trader, executionAccount: grant.executionAccount,
      agentAddress: grant.agentAddress, isolationMode: grant.isolationMode, status: "ACTIVE",
      verifiedAtMs: now, expiresAtMs: grant.validUntilMs };
    if (checkTradingAccess(access, now, 60_000) || !await verifyTradingAccessAtVenue(access)) {
      return reply.code(409).send({ error: "VENUE_AGENT_ACCOUNT_UNVERIFIED" });
    }
    try {
      const [row] = await db.insert(tradingAgents).values({ authorizationId: grant.authorizationId,
        trader: grant.trader.toLowerCase(), executionAccount: grant.executionAccount.toLowerCase(),
        agentAddress: grant.agentAddress.toLowerCase(), isolationMode: grant.isolationMode,
        status: "ACTIVE", grantSignature: body.signature, verifiedAt: new Date(now),
        expiresAt: new Date(grant.validUntilMs) }).returning();
      return reply.code(201).send({ id: row.id, authorizationId: row.authorizationId,
        executionAccount: row.executionAccount, agentAddress: row.agentAddress,
        isolationMode: row.isolationMode, status: row.status, verifiedAt: row.verifiedAt });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: "TRADING_ACCESS_ALREADY_EXISTS" });
      }
      throw error;
    }
  });

  app.get<{ Params: { authorizationId: string } }>("/api/trading-access/:authorizationId", async (request, reply) => {
    if (!/^[0-9a-fA-F-]{36}$/.test(request.params.authorizationId)) return reply.code(400).send({ error: "INVALID_AUTHORIZATION_ID" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const db = getDb()!;
    const [auth] = await db.select().from(traderAuthorizations)
      .where(eq(traderAuthorizations.authorizationId, request.params.authorizationId)).limit(1);
    if (!auth) return reply.code(404).send({ error: "AUTHORIZATION_NOT_FOUND" });
    const [row] = await db.select().from(tradingAgents)
      .where(eq(tradingAgents.authorizationId, auth.authorizationId)).limit(1);
    if (!row) return reply.code(404).send({ error: "TRADING_ACCESS_NOT_FOUND" });
    const active = await verifiedTradingAccess(auth);
    return { authorizationId: auth.authorizationId, executionAccount: row.executionAccount,
      agentAddress: row.agentAddress, isolationMode: row.isolationMode,
      status: active ? "ACTIVE" : "UNVERIFIED", verifiedAt: active ? row.verifiedAt : null,
      venue: "hypercore-testnet", nativeAgentLimits: "NOT_ENFORCED_BY_COREPILOT" };
  });
}
