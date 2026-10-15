import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { hashMessage, isAddress, verifyMessage, type Hex } from "viem";
import {
  authorizationChangeMessage, authorizationSigningMessage, isStrategyPolicyV1,
  isTraderAuthorizationV1, policySigningMessage, type AuthorizationChange,
  type StrategyPolicyV1, type TraderAuthorizationV1,
} from "@corepilot/shared";
import { getDb } from "../db/client.js";
import { authorizationEvents, strategyPolicies, traderAuthorizations, type StrategyPolicyRow, type TraderAuthorizationRow } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";
import { verifyPolicyIdentity } from "../lib/policyIdentity.js";
import { configuredRegistry } from "../lib/policyIdentity.js";
import { ELYSIUM_TESTNET_CHAIN_ID } from "@corepilot/shared";

const signature = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
const id = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const statusCode = (reason: string) => reason.endsWith("UNCONFIGURED") || reason.endsWith("FAILED") || reason === "DATABASE_UNAVAILABLE" ? 503 : 409;

export function fromPolicy(row: StrategyPolicyRow): StrategyPolicyV1 {
  return { chainId: row.chainId, registry: row.registry as Hex, strategyId: row.chainStrategyId,
    creator: row.creator as Hex, version: row.version, market: row.market,
    signal: { type: "funding_rate", operator: "lt", thresholdBps: row.thresholdBps },
    action: { type: "open_position", side: row.side as "long" | "short" },
    bounds: { maxNotionalUsd: row.maxNotionalUsd, maxLeverageBps: row.maxLeverageBps,
      maxSlippageBps: row.maxSlippageBps, expiry: row.expiry }, enabled: row.enabled };
}

export function fromAuthorization(row: TraderAuthorizationRow): TraderAuthorizationV1 {
  return { authorizationId: row.authorizationId, chainId: row.chainId, registry: row.registry as Hex,
    strategyId: row.chainStrategyId, policyVersion: row.policyVersion, policyHash: row.policyHash as Hex,
    trader: row.trader as Hex, version: row.version, maxNotionalUsd: row.maxNotionalUsd,
    maxLeverageBps: row.maxLeverageBps, maxSlippageBps: row.maxSlippageBps,
    validFromMs: row.validFromMs, validUntilMs: row.validUntilMs };
}

export async function currentPolicy(strategyId: number) {
  const db = getDb();
  const registry = configuredRegistry();
  if (!db || !registry) return null;
  const [row] = await db.select().from(strategyPolicies)
    .where(and(eq(strategyPolicies.chainStrategyId, strategyId),
      eq(strategyPolicies.chainId, ELYSIUM_TESTNET_CHAIN_ID),
      eq(strategyPolicies.registry, registry.toLowerCase()))).orderBy(desc(strategyPolicies.version)).limit(1);
  return row ?? null;
}

export async function verifiedPolicy(row: StrategyPolicyRow): Promise<string | null> {
  const policy = fromPolicy(row);
  if (!isStrategyPolicyV1(policy)) return "POLICY_INVALID";
  const message = policySigningMessage(policy);
  if (hashMessage(message).toLowerCase() !== row.policyHash.toLowerCase()) return "POLICY_HASH_MISMATCH";
  if (!signature(row.signature) || !await verifyMessage({ address: policy.creator, message, signature: row.signature as Hex })) return "POLICY_SIGNATURE_INVALID";
  return verifyPolicyIdentity(policy);
}

export async function policiesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { strategyId: string } }>("/api/policies/:strategyId", async (request, reply) => {
    const strategyId = id(request.params.strategyId);
    if (!strategyId) return reply.code(400).send({ error: "INVALID_STRATEGY_ID" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    if (!configuredRegistry()) return reply.code(503).send({ error: "REGISTRY_UNCONFIGURED" });
    const row = await currentPolicy(strategyId);
    if (!row) return reply.code(404).send({ error: "POLICY_NOT_FOUND" });
    const reason = await verifiedPolicy(row);
    if (reason) return reply.code(statusCode(reason)).send({ error: reason });
    return { policy: fromPolicy(row), hash: row.policyHash, signature: row.signature, status: row.enabled ? "VERIFIED" : "DISABLED" };
  });

  app.post<{ Params: { strategyId: string }; Body: unknown }>("/api/policies/:strategyId", async (request, reply) => {
    const strategyId = id(request.params.strategyId);
    if (!strategyId) return reply.code(400).send({ error: "INVALID_STRATEGY_ID" });
    const body = request.body as { policy?: unknown; signature?: unknown } | null;
    if (!body || Object.keys(body).sort().join() !== "policy,signature" ||
        !isStrategyPolicyV1(body.policy) || !signature(body.signature) || body.policy.strategyId !== strategyId) {
      return reply.code(400).send({ error: "INVALID_SIGNED_POLICY" });
    }
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    if (!configuredRegistry()) return reply.code(503).send({ error: "REGISTRY_UNCONFIGURED" });
    const policy = body.policy;
    const message = policySigningMessage(policy);
    if (!await verifyMessage({ address: policy.creator, message, signature: body.signature })) return reply.code(403).send({ error: "POLICY_SIGNATURE_INVALID" });
    const reason = await verifyPolicyIdentity(policy);
    if (reason) return reply.code(statusCode(reason)).send({ error: reason });
    const previous = await currentPolicy(strategyId);
    if (policy.version !== (previous?.version ?? 0) + 1) return reply.code(409).send({ error: "POLICY_VERSION_CONFLICT" });
    const db = getDb()!;
    try {
      const [row] = await db.insert(strategyPolicies).values({ chainId: policy.chainId, registry: policy.registry.toLowerCase(),
        chainStrategyId: strategyId, creator: policy.creator.toLowerCase(), version: policy.version,
        market: policy.market, thresholdBps: policy.signal.thresholdBps, side: policy.action.side,
        maxNotionalUsd: policy.bounds.maxNotionalUsd, maxLeverageBps: policy.bounds.maxLeverageBps,
        maxSlippageBps: policy.bounds.maxSlippageBps, expiry: policy.bounds.expiry, enabled: policy.enabled,
        policyHash: hashMessage(message), signature: body.signature }).returning();
      return reply.code(201).send({ policy: fromPolicy(row), hash: row.policyHash, status: row.enabled ? "VERIFIED" : "DISABLED" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return reply.code(409).send({ error: "POLICY_VERSION_CONFLICT" });
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/api/authorizations", async (request, reply) => {
    const body = request.body as { authorization?: unknown; signature?: unknown } | null;
    if (!body || Object.keys(body).sort().join() !== "authorization,signature" ||
        !isTraderAuthorizationV1(body.authorization) || !signature(body.signature)) return reply.code(400).send({ error: "INVALID_SIGNED_AUTHORIZATION" });
    const auth = body.authorization;
    if (auth.version !== 1 || auth.validFromMs > Date.now() || auth.validUntilMs <= Date.now()) return reply.code(400).send({ error: "AUTHORIZATION_TIME_INVALID" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    if (!configuredRegistry()) return reply.code(503).send({ error: "REGISTRY_UNCONFIGURED" });
    const policyRow = await currentPolicy(auth.strategyId);
    if (!policyRow) return reply.code(409).send({ error: "POLICY_NOT_FOUND" });
    const reason = await verifiedPolicy(policyRow);
    if (reason) return reply.code(statusCode(reason)).send({ error: reason });
    const policy = fromPolicy(policyRow);
    if (!policy.enabled || auth.chainId !== policy.chainId || auth.registry.toLowerCase() !== policy.registry.toLowerCase() ||
        auth.policyVersion !== policy.version || auth.policyHash.toLowerCase() !== policyRow.policyHash.toLowerCase()) return reply.code(409).send({ error: "POLICY_BINDING_MISMATCH" });
    if (auth.maxNotionalUsd > policy.bounds.maxNotionalUsd || auth.maxLeverageBps > policy.bounds.maxLeverageBps ||
        auth.maxSlippageBps > policy.bounds.maxSlippageBps) return reply.code(400).send({ error: "AUTHORIZATION_EXCEEDS_POLICY" });
    if (!await verifyMessage({ address: auth.trader, message: authorizationSigningMessage(auth), signature: body.signature })) return reply.code(403).send({ error: "AUTHORIZATION_SIGNATURE_INVALID" });
    try {
      await getDb()!.insert(traderAuthorizations).values({ authorizationId: auth.authorizationId,
        chainId: auth.chainId, registry: auth.registry.toLowerCase(), chainStrategyId: auth.strategyId,
        policyVersion: auth.policyVersion, policyHash: auth.policyHash.toLowerCase(), trader: auth.trader.toLowerCase(),
        version: auth.version, maxNotionalUsd: auth.maxNotionalUsd, maxLeverageBps: auth.maxLeverageBps,
        maxSlippageBps: auth.maxSlippageBps, validFromMs: auth.validFromMs, validUntilMs: auth.validUntilMs,
        status: "ACTIVE", signature: body.signature });
      return reply.code(201).send({ authorizationId: auth.authorizationId, status: "ACTIVE" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return reply.code(409).send({ error: "AUTHORIZATION_EXISTS" });
      throw error;
    }
  });

  app.get<{ Params: { trader: string } }>("/api/authorizations/trader/:trader", async (request, reply) => {
    if (!isAddress(request.params.trader)) return reply.code(400).send({ error: "INVALID_TRADER" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const db = getDb()!;
    const rows = await db.select().from(traderAuthorizations)
      .where(eq(traderAuthorizations.trader, request.params.trader.toLowerCase()))
      .orderBy(desc(traderAuthorizations.updatedAt));
    const data = [];
    for (const row of rows) {
      const auth = fromAuthorization(row);
      const policyRow = await currentPolicy(auth.strategyId);
      const policyReason = policyRow ? await verifiedPolicy(policyRow) : "POLICY_MISSING";
      const signatureValid = signature(row.signature) && await verifyMessage({ address: auth.trader,
        message: authorizationSigningMessage({ ...auth, version: 1 }), signature: row.signature as Hex });
      const bound = policyRow && auth.chainId === policyRow.chainId &&
        auth.registry.toLowerCase() === policyRow.registry.toLowerCase() &&
        auth.policyVersion === policyRow.version && auth.policyHash.toLowerCase() === policyRow.policyHash.toLowerCase();
      const status = !signatureValid || policyReason || !bound ? "UNVERIFIED" :
        row.status === "REVOKED" ? "REVOKED" : Date.now() >= auth.validUntilMs ? "EXPIRED" :
        !policyRow?.enabled ? "POLICY_DISABLED" : row.status;
      data.push({ authorization: auth, status, policy: policyRow && !policyReason ? fromPolicy(policyRow) : null,
        reason: policyReason ?? (!bound ? "POLICY_BINDING_MISMATCH" : undefined) });
    }
    return { data, provenance: "testnet" };
  });

  app.get<{ Params: { trader: string } }>("/api/authorization-events/trader/:trader", async (request, reply) => {
    if (!isAddress(request.params.trader)) return reply.code(400).send({ error: "INVALID_TRADER" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const trader = request.params.trader.toLowerCase();
    const db = getDb()!;
    const [events, authorizations] = await Promise.all([
      db.select().from(authorizationEvents).where(eq(authorizationEvents.trader, trader)).orderBy(desc(authorizationEvents.createdAt)),
      db.select().from(traderAuthorizations).where(eq(traderAuthorizations.trader, trader)),
    ]);
    const byId = new Map(authorizations.map(row => [row.authorizationId, row]));
    const data = [];
    for (const event of events) {
      const row = byId.get(event.authorizationId);
      if (!row || !["PAUSE", "RESUME", "REVOKE"].includes(event.action) || !signature(event.signature)) continue;
      const authorization = fromAuthorization(row);
      const message = authorizationChangeMessage(authorization, event.version, event.action as AuthorizationChange);
      if (!await verifyMessage({ address: authorization.trader, message, signature: event.signature as Hex })) continue;
      data.push({ id: event.id, authorizationId: event.authorizationId, strategyId: row.chainStrategyId,
        action: event.action, version: event.version, timestamp: event.createdAt.toISOString(), provenance: "testnet" });
    }
    return { data, provenance: "testnet" };
  });

  app.post<{ Params: { authorizationId: string }; Body: unknown }>("/api/authorizations/:authorizationId/state", async (request, reply) => {
    const body = request.body as { action?: unknown; version?: unknown; signature?: unknown } | null;
    if (!body || Object.keys(body).sort().join() !== "action,signature,version" ||
        !["PAUSE", "RESUME", "REVOKE"].includes(String(body.action)) || !Number.isSafeInteger(body.version) || !signature(body.signature)) return reply.code(400).send({ error: "INVALID_STATE_CHANGE" });
    if (!await dbAvailable()) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const db = getDb()!;
    const [row] = await db.select().from(traderAuthorizations).where(eq(traderAuthorizations.authorizationId, request.params.authorizationId)).limit(1);
    if (!row) return reply.code(404).send({ error: "AUTHORIZATION_NOT_FOUND" });
    if (body.version !== row.version + 1 || row.status === "REVOKED" ||
        (body.action !== "REVOKE" && Date.now() >= row.validUntilMs) ||
        (body.action === "RESUME" && row.status !== "PAUSED") ||
        (body.action === "PAUSE" && row.status !== "ACTIVE")) return reply.code(409).send({ error: "INVALID_STATE_TRANSITION" });
    const auth = fromAuthorization(row);
    if (body.action === "RESUME") {
      const policyRow = await currentPolicy(auth.strategyId);
      if (!policyRow || !policyRow.enabled || await verifiedPolicy(policyRow) ||
          auth.policyVersion !== policyRow.version || auth.policyHash.toLowerCase() !== policyRow.policyHash.toLowerCase()) {
        return reply.code(409).send({ error: "POLICY_BINDING_MISMATCH" });
      }
    }
    if (!await verifyMessage({ address: auth.trader, message: authorizationChangeMessage(auth, body.version as number, body.action as AuthorizationChange), signature: body.signature })) return reply.code(403).send({ error: "STATE_SIGNATURE_INVALID" });
    const nextStatus = body.action === "REVOKE" ? "REVOKED" : body.action === "PAUSE" ? "PAUSED" : "ACTIVE";
    const updated = await db.transaction(async tx => {
      const changed = await tx.update(traderAuthorizations).set({ status: nextStatus, version: body.version as number,
        updatedAt: new Date() }).where(and(eq(traderAuthorizations.authorizationId, row.authorizationId),
        eq(traderAuthorizations.version, row.version))).returning();
      if (!changed.length) return false;
      await tx.insert(authorizationEvents).values({ authorizationId: row.authorizationId, trader: row.trader,
        version: body.version as number, action: body.action as string, signature: body.signature as Hex });
      return true;
    });
    if (!updated) return reply.code(409).send({ error: "STATE_VERSION_CONFLICT" });
    return { authorizationId: row.authorizationId, status: nextStatus, version: body.version };
  });
}
