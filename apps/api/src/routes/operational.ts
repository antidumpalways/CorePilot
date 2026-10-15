import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { isAddress, verifyMessage } from "viem";
import { authorizationSigningMessage, evaluateOperational, type RequestedTrade } from "@corepilot/shared";
import { createCorePilotClient } from "@corepilot/sdk";
import { getDb } from "../db/client.js";
import { traderAuthorizations } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";
import { fetchHyperliquidSnapshot } from "../lib/hyperliquidSnapshot.js";
import { configuredRegistry } from "../lib/policyIdentity.js";
import { currentPolicy, fromAuthorization, fromPolicy, verifiedPolicy } from "./policies.js";
import { verifiedTradingAccess } from "./tradingAccess.js";

type Body = RequestedTrade & { authorizationId: string };
function parseBody(value: unknown): Body | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join() !== "authorizationId,leverageBps,notionalUsd,slippageBps") return null;
  if (typeof body.authorizationId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(body.authorizationId)) return null;
  for (const key of ["notionalUsd", "leverageBps", "slippageBps"] as const) {
    if (!Number.isSafeInteger(body[key]) || (body[key] as number) < (key === "slippageBps" ? 0 : 1)) return null;
  }
  return { authorizationId: body.authorizationId,
    notionalUsd: body.notionalUsd as number, leverageBps: body.leverageBps as number,
    slippageBps: body.slippageBps as number };
}

export async function operationalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { strategyId: string }; Body: unknown }>("/api/executor/preflight/:strategyId", async (request, reply) => {
    const strategyId = /^[1-9]\d*$/.test(request.params.strategyId) ? Number(request.params.strategyId) : NaN;
    const body = parseBody(request.body);
    if (!Number.isSafeInteger(strategyId) || !body) return reply.code(400).send({ error: "INVALID_PREFLIGHT_REQUEST" });
    if (!await dbAvailable()) return reply.code(503).send({ status: "BLOCKED", blocker: "DATABASE_UNAVAILABLE" });
    const registry = configuredRegistry();
    const staking = process.env.STAKING_ADDRESS;
    const executor = process.env.EXECUTOR_ADDRESS;
    if (!registry || !staking || !isAddress(staking) || !executor || !isAddress(executor)) {
      return reply.code(503).send({ status: "BLOCKED", blocker: "CHAIN_CONFIGURATION_INCOMPLETE" });
    }
    const row = await currentPolicy(strategyId);
    if (!row) return { status: "BLOCKED", blocker: "POLICY_MISSING" };
    const policyReason = await verifiedPolicy(row);
    if (policyReason) return { status: "BLOCKED", blocker: policyReason };
    const policy = fromPolicy(row);
    const [authorizationRow] = await getDb()!.select().from(traderAuthorizations)
      .where(eq(traderAuthorizations.authorizationId, body.authorizationId)).limit(1);
    if (!authorizationRow) return { status: "BLOCKED", blocker: "AUTHORIZATION_MISSING" };
    const authorization = fromAuthorization(authorizationRow);
    if (authorization.strategyId !== strategyId || authorization.policyVersion !== policy.version ||
        authorization.policyHash.toLowerCase() !== row.policyHash.toLowerCase() ||
        authorization.registry.toLowerCase() !== registry.toLowerCase() || authorization.chainId !== policy.chainId) {
      return { status: "BLOCKED", blocker: "AUTHORIZATION_UNVERIFIED" };
    }
    if (!await verifyMessage({ address: authorization.trader,
      message: authorizationSigningMessage({ ...authorization, version: 1 }),
      signature: authorizationRow.signature as `0x${string}` })) {
      return { status: "BLOCKED", blocker: "AUTHORIZATION_UNVERIFIED" };
    }
    const client = createCorePilotClient({ rpcUrl: process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz",
      addresses: { registry, staking, controller: process.env.EXECUTION_CONTROLLER_ADDRESS as `0x${string}` | undefined } });
    try {
      if (await client.publicClient.getChainId() !== policy.chainId) return { status: "BLOCKED", blocker: "CHAIN_MISMATCH" };
      const [strategy, creatorBonded, executorBonded, snapshot] = await Promise.all([
        client.read.getStrategyRecord(strategyId), client.read.isCreatorBonded(strategyId),
        client.read.isExecutorBonded(executor), fetchHyperliquidSnapshot(policy.market),
      ]);
      const decision = evaluateOperational({ strategy, policy, authorization,
        authorizationStatus: authorizationRow.status as "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED",
        snapshot, requested: { notionalUsd: body.notionalUsd, leverageBps: body.leverageBps,
          slippageBps: body.slippageBps }, creatorBonded, executorBonded,
        nowMs: Date.now(), maxSnapshotAgeMs: 60_000 });
      // CorePilot authorization is not native HyperCore agent authority. Recheck
      // the signed account binding and live testnet venue role on every ready preflight.
      const access = decision.ready ? await verifiedTradingAccess(authorizationRow) : null;
      const guardedDecision = decision.ready && !access
        ? { ready: false as const, blocker: "TRADING_AGENT_UNVERIFIED" as const }
        : decision;
      return { status: guardedDecision.ready ? "READY_TO_CREATE_INTENT" : "BLOCKED",
        blocker: guardedDecision.ready ? undefined : guardedDecision.blocker,
        decision: guardedDecision, policyHash: row.policyHash, authorizationId: authorization.authorizationId,
        executionAccount: access?.executionAccount ?? null, agentAddress: access?.agentAddress ?? null,
        isolationMode: access?.isolationMode ?? null,
        snapshot: { market: snapshot.market, fundingRateBps: snapshot.fundingRateBps,
          observedAtMs: snapshot.timestampMs, source: snapshot.source },
        provenance: "live-mainnet-signal", dispatch: "NOT_REQUESTED", venue: "UNVERIFIED" };
    } catch {
      return reply.code(503).send({ status: "BLOCKED", blocker: "CHAIN_OR_VENUE_DATA_UNAVAILABLE" });
    }
  });
}
