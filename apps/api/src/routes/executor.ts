import type { FastifyInstance } from "fastify";
import {
  DEFAULT_EXECUTION_FEE_USD,
  PILOT_DISCOUNT_BPS,
  type ConstraintCheck,
  type ExecutionRequest,
  type MarketData,
  type Side,
} from "@corepilot/shared";
import { getDb } from "../db/client.js";
import { marketSnapshots } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";

interface EvaluateParams {
  strategyId: string;
}

interface EvaluateBody {
  market?: string;
  markPrice?: number;
  fundingRateBps?: number;
  side?: Side;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function executorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: EvaluateParams; Body: EvaluateBody | undefined }>(
    "/api/executor/evaluate/:strategyId",
    async (request, reply) => {
      const strategyId = Number.parseInt(request.params.strategyId, 10);
      if (!Number.isFinite(strategyId)) {
        return reply
          .code(400)
          .send({ error: "invalid strategyId", db: false });
      }

      const body = request.body ?? {};
      const market = typeof body.market === "string" ? body.market : "HYPE";
      const side: Side = body.side === "short" ? "short" : "long";
      const markPrice = isFiniteNumber(body.markPrice) ? body.markPrice : 0;
      const fundingRateBps = isFiniteNumber(body.fundingRateBps)
        ? body.fundingRateBps
        : 0;

      // Stub trigger logic: a "funding below" long strategy fires on negative funding.
      const triggered = fundingRateBps < 0;

      const constraints: ConstraintCheck = {
        ok: true,
        violations: [],
        checked: {
          active: true,
          expiry: true,
          marketAllowed: true,
          leverage: true,
          slippage: true,
          notional: true,
        },
      };

      const request0: ExecutionRequest | null = triggered
        ? {
            strategyId,
            market,
            side,
            notionalUsd: Math.min(markPrice > 0 ? markPrice : 100, 1000),
            leverageBps: 300,
            slippageBps: 50,
          }
        : null;

      const feePreview = {
        feeUsd: DEFAULT_EXECUTION_FEE_USD,
        pilotDiscountBps: PILOT_DISCOUNT_BPS,
        discountedFeeUsd:
          DEFAULT_EXECUTION_FEE_USD * (1 - PILOT_DISCOUNT_BPS / 10_000),
      };

      return {
        strategyId,
        triggered,
        constraints,
        request: request0,
        feePreview,
        db: await dbAvailable(),
      };
    },
  );

  app.post<{ Body: Partial<MarketData> | undefined }>(
    "/api/oracle/snapshot",
    async (request, reply) => {
      const body = request.body ?? {};

      if (typeof body.market !== "string" || body.market.trim() === "") {
        return reply.code(400).send({ error: "market is required", db: false });
      }
      if (!isFiniteNumber(body.markPrice)) {
        return reply
          .code(400)
          .send({ error: "markPrice must be a number", db: false });
      }
      if (!isFiniteNumber(body.fundingRateBps)) {
        return reply
          .code(400)
          .send({ error: "fundingRateBps must be a number", db: false });
      }

      const snapshot = {
        market: body.market.trim(),
        markPrice: body.markPrice,
        fundingRateBps: body.fundingRateBps,
        source: typeof body.source === "string" ? body.source : "manual",
        timestamp: isFiniteNumber(body.timestamp) ? body.timestamp : Date.now(),
        signature: typeof body.signature === "string" ? body.signature : null,
      };

      if (!(await dbAvailable())) {
        return { data: snapshot, db: false };
      }
      const db = getDb();
      if (!db) return { data: snapshot, db: false };

      const inserted = await db
        .insert(marketSnapshots)
        .values(snapshot)
        .returning();

      return { data: inserted[0] ?? null, db: true };
    },
  );
}
