import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ELYSIUM_TESTNET_CHAIN_ID } from "@corepilot/shared";
import { dbAvailable } from "./lib/dbAvailable.js";
import { marketsRoutes } from "./routes/markets.js";
import { strategiesRoutes } from "./routes/strategies.js";
import { executorRoutes } from "./routes/executor.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => ({
  ok: true,
  service: "corepilot-api",
  chainId: ELYSIUM_TESTNET_CHAIN_ID,
  db: await dbAvailable(),
}));

await app.register(marketsRoutes);
await app.register(strategiesRoutes);
await app.register(executorRoutes);

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8001);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
