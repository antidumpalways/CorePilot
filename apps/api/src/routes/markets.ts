import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { marketSnapshots } from "../db/schema.js";
import { dbAvailable } from "../lib/dbAvailable.js";

interface MarketParams {
  symbol: string;
}

export async function marketsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/markets", async (_request, _reply) => {
    if (!(await dbAvailable())) return { data: [], db: false };
    const db = getDb();
    if (!db) return { data: [], db: false };

    const rows = await db
      .selectDistinct({ market: marketSnapshots.market })
      .from(marketSnapshots);

    const markets = rows
      .map((row) => row.market)
      .filter((market): market is string => typeof market === "string");

    return { data: markets, db: true };
  });

  app.get<{ Params: MarketParams }>(
    "/api/market/:symbol",
    async (request, reply) => {
      const symbol = request.params.symbol?.trim();
      if (!symbol || !/^[A-Za-z0-9_-]{1,32}$/.test(symbol)) {
        return reply.code(400).send({ error: "symbol must be a valid market symbol", db: false });
      }

      if (!(await dbAvailable())) return { data: null, db: false };
      const db = getDb();
      if (!db) return { data: null, db: false };

      const rows = await db
        .select()
        .from(marketSnapshots)
        .where(eq(marketSnapshots.market, symbol.toUpperCase()))
        .orderBy(desc(marketSnapshots.timestamp))
        .limit(1);

      return { data: rows[0] ?? null, db: true };
    },
  );
}
