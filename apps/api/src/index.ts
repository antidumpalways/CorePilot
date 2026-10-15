import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { DOMAIN_CAPABILITIES, ELYSIUM_TESTNET_CHAIN_ID } from "@corepilot/shared";
import { dbAvailable } from "./lib/dbAvailable.js";
import { marketsRoutes } from "./routes/markets.js";
import { strategiesRoutes } from "./routes/strategies.js";
import { executorRoutes } from "./routes/executor.js";
import { policiesRoutes } from "./routes/policies.js";
import { operationalRoutes } from "./routes/operational.js";
import { tradingAccessRoutes } from "./routes/tradingAccess.js";
import { startWatcher } from "./runtime/watcher.js";
import { runtimeRoutes } from "./routes/runtime.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const contracts = {
  registry: Boolean(process.env.STRATEGY_REGISTRY_ADDRESS),
  controller: Boolean(process.env.EXECUTION_CONTROLLER_ADDRESS),
  marketData: Boolean(process.env.MARKET_DATA_ORACLE_ADDRESS),
  receipts: Boolean(process.env.RECEIPT_REGISTRY_ADDRESS),
};

app.get("/api/capabilities", async () => ({
  signals: DOMAIN_CAPABILITIES.filter((item) => item.kind === "signal").map(({ type, support }) => ({ type, support })),
  actions: DOMAIN_CAPABILITIES.filter((item) => item.kind === "action").map(({ type, support }) => ({ type, support })),
  network: { name: "elysium-testnet", chainId: ELYSIUM_TESTNET_CHAIN_ID },
  contracts: { configured: Object.values(contracts).some(Boolean), addresses: contracts,
    deployment: { registry: process.env.STRATEGY_REGISTRY_ADDRESS ?? null,
      pilotToken: process.env.PILOT_TOKEN_ADDRESS ?? null,
      staking: process.env.STAKING_ADDRESS ?? null } },
  executor: { status: "not_instrumented" },
}));

app.get("/api/health", async () => {
  const databaseAvailable = await dbAvailable();
  const hasContracts = Object.values(contracts).some(Boolean);
  const components = {
    api: "operational" as const,
    database: process.env.DATABASE_URL ? databaseAvailable ? "operational" as const : "unavailable" as const : "not_instrumented" as const,
    rpc: "unknown" as const,
    contracts: hasContracts ? "unknown" as const : "not_instrumented" as const,
    executor: "not_instrumented" as const,
  };
  return {
    ok: components.api === "operational",
    service: "corepilot-api",
    // Never return a configured RPC URL: provider paths may contain API keys.
    network: { chainId: ELYSIUM_TESTNET_CHAIN_ID },
    provenance: "live",
    components,
    db: databaseAvailable,
  };
});

await app.register(marketsRoutes);
await app.register(strategiesRoutes);
await app.register(executorRoutes);
await app.register(policiesRoutes);
await app.register(operationalRoutes);
await app.register(tradingAccessRoutes);
await app.register(runtimeRoutes);

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8001);

try {
  await app.listen({ port, host: process.env.API_HOST ?? "127.0.0.1" });
  startWatcher({ info: message => app.log.info(message), error: message => app.log.error(message) });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
