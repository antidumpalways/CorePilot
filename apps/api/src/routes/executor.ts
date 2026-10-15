import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { MarketData } from "@corepilot/shared";
import { getDb } from "../db/client.js";
import { marketSnapshots, strategies } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";
import { parseStrategyId, unavailableEvaluation, validateEvaluationBody } from "../lib/evaluation.js";

interface EvaluateParams { strategyId: string }
const provenanceValues = ["live", "testnet", "simulated", "demo", "unknown"] as const;
type Provenance = typeof provenanceValues[number];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validMarket(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value.trim());
}

export async function executorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: EvaluateParams; Body: unknown }>(
    "/api/executor/evaluate/:strategyId",
    async (request, reply) => {
      const strategyId = parseStrategyId(request.params.strategyId);
      if (strategyId === null) return reply.code(400).send({ error: "invalid strategyId" });
      const validated = validateEvaluationBody(request.body);
      if (!validated.ok) return reply.code(400).send({ error: validated.error });

      if (!(await dbAvailable())) return unavailableEvaluation(strategyId, "DATABASE_UNAVAILABLE", false);
      const db = getDb();
      if (!db) return unavailableEvaluation(strategyId, "DATABASE_UNAVAILABLE", false);
      const rows = await db.select().from(strategies).where(eq(strategies.id, strategyId)).limit(1);
      const strategy = rows[0];
      if (!strategy) return unavailableEvaluation(strategyId, "STRATEGY_NOT_FOUND", true);

      // Caller preview data is non-authoritative; stored strategy policy and limits are absent.
      const result = unavailableEvaluation(strategyId, "POLICY_AND_LIMITS_UNVERIFIED", true, strategy);
      return {
        ...result,
        provenance: "unknown",
        stages: [
          { stage: "signal", status: result.signal.status, result: result.signal },
          { stage: "condition", status: "not_evaluated", reason: result.reason },
          { stage: "policy", ...result.policy },
          { stage: "constraints", ...result.constraints },
          { stage: "execution", ...result.execution },
          { stage: "receipt", status: result.receipt ? "recorded" : "not_available", receipt: result.receipt },
        ],
      };
    },
  );

  app.post<{ Body: Partial<MarketData> & { provenance?: Provenance } | undefined }>(
    "/api/oracle/snapshot",
    async (request, reply) => {
      const body = request.body ?? {};
      if (!validMarket(body.market)) return reply.code(400).send({ error: "market must be an alphanumeric market symbol" });
      if (!isFiniteNumber(body.markPrice) || body.markPrice <= 0) return reply.code(400).send({ error: "markPrice must be a positive finite number" });
      if (!isFiniteNumber(body.fundingRateBps)) return reply.code(400).send({ error: "fundingRateBps must be a finite number" });
      if (body.timestamp !== undefined && (!isFiniteNumber(body.timestamp) || body.timestamp <= 0)) return reply.code(400).send({ error: "timestamp must be a finite positive number" });
      if (body.provenance !== undefined && !provenanceValues.includes(body.provenance)) return reply.code(400).send({ error: "invalid provenance" });

      const snapshot = {
        market: body.market.trim().toUpperCase(),
        markPrice: body.markPrice,
        fundingRateBps: body.fundingRateBps,
        source: typeof body.source === "string" && body.source.trim() ? body.source.trim() : "manual",
        timestamp: body.timestamp ?? Date.now(),
        signature: typeof body.signature === "string" ? body.signature : null,
        provenance: body.provenance ?? "unknown",
      };
      if (!(await dbAvailable())) return { data: snapshot, db: false };
      const db = getDb();
      if (!db) return { data: snapshot, db: false };
      const inserted = await db.insert(marketSnapshots).values(snapshot).returning();
      return { data: inserted[0] ?? null, db: true };
    },
  );
}
