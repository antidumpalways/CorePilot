import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { executionAttempts, strategies } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";

interface StrategyIdParams {
  id: string;
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export async function strategiesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/strategies", async (_request, _reply) => {
    if (!(await dbAvailable())) return { data: [], db: false };
    const db = getDb();
    if (!db) return { data: [], db: false };

    const rows = await db
      .select()
      .from(strategies)
      .orderBy(desc(strategies.createdAt));

    return { data: rows, db: true };
  });

  app.get<{ Params: StrategyIdParams }>(
    "/api/strategies/:id",
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "invalid strategy id", db: false });
      }

      if (!(await dbAvailable())) return { data: null, db: false };
      const db = getDb();
      if (!db) return { data: null, db: false };

      const rows = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, id))
        .limit(1);

      return { data: rows[0] ?? null, db: true };
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

      return { data: rows, db: true };
    },
  );
}
