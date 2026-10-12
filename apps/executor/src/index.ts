import {
  createWalletClient,
  http,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createCorePilotClient,
  executionControllerAbi,
  marketToBytes32,
  type CorePilotClient,
} from "@corepilot/sdk";
import type { StrategyConfig } from "@corepilot/shared";
import { StrategyType } from "@corepilot/shared";
import { config, hasChainConfig } from "./config.js";
import { log } from "./logger.js";
import { elysiumTestnet } from "./chain.js";
import { fetchMarketContext } from "./data/hyperliquid.js";
import { evaluateStrategy, DEFAULT_FUNDING_TRIGGER } from "./engine/evaluate.js";
import { checkConstraints } from "./engine/constraints.js";
import { mockExecute } from "./execution/adapter.js";
import { submitSnapshot } from "./oracle.js";

function buildWallet(key?: `0x${string}`): WalletClient | undefined {
  if (!key) return undefined;
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: elysiumTestnet, transport: http(config.rpcUrl) });
}

async function runDemo(): Promise<void> {
  const data = await fetchMarketContext(config.hyperliquidApiUrl, "HYPE").catch((e) => {
    log.warn("market data fetch failed:", String(e));
    return null;
  });
  if (!data) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const demoStrategy: StrategyConfig = {
    id: 0,
    creator: "0x0000000000000000000000000000000000000000",
    market: "HYPE",
    strategyType: StrategyType.FundingTrigger,
    maxLeverageBps: 300,
    maxSlippageBps: 50,
    maxNotionalUsd: 25_000,
    expiry: nowSec + 86_400,
    active: true,
  };

  log.info("demo: HYPE mark", data.markPrice, "| funding", data.fundingRateBps.toFixed(4), "bps");
  const res = evaluateStrategy(demoStrategy, data, DEFAULT_FUNDING_TRIGGER);
  log.info(
    `demo evaluation: ${res.triggered ? "TRIGGERED" : "not triggered"} (${res.triggerLabel})`,
  );
  if (res.triggered && res.request) {
    const r = mockExecute(res.request);
    log.info("demo simulated execution:", r.executionId);
  }
}

async function tick(
  client: CorePilotClient,
  wallet: WalletClient | undefined,
  snapshotWallet: WalletClient | undefined,
): Promise<void> {
  const strategies = await client.read.listStrategies();
  const active = strategies.filter((s) => s.active);
  if (active.length === 0) {
    log.info("no active strategies");
    return;
  }

  for (const s of active) {
    let data;
    try {
      data = await fetchMarketContext(config.hyperliquidApiUrl, s.market);
    } catch (e) {
      log.warn(`market data failed for ${s.market}:`, String(e));
      continue;
    }

    if (snapshotWallet && config.addresses.marketData) {
      try {
        await submitSnapshot(snapshotWallet, config.chainId, config.addresses.marketData, data);
      } catch (e) {
        log.warn("snapshot submit failed:", String(e));
      }
    }

    const ev = evaluateStrategy(s, data, DEFAULT_FUNDING_TRIGGER);
    if (!ev.triggered || !ev.request) {
      log.info(`strategy #${s.id}: ${ev.reason ?? "idle"} (${ev.triggerLabel})`);
      continue;
    }

    const check = checkConstraints(s, ev.request, Math.floor(Date.now() / 1000));
    if (!check.ok) {
      log.warn(`strategy #${s.id} rejected: ${check.violations.join(", ")}`);
      continue;
    }

    if (config.enableLiveExecution && wallet && config.addresses.controller) {
      try {
        const hash = await wallet.writeContract({
          address: config.addresses.controller,
          abi: executionControllerAbi,
          functionName: "execute",
          args: [
            {
              strategyId: BigInt(ev.request.strategyId),
              market: marketToBytes32(ev.request.market),
              isLong: ev.request.side === "long",
              notionalUsd: BigInt(ev.request.notionalUsd),
              leverageBps: BigInt(ev.request.leverageBps),
              slippageBps: BigInt(ev.request.slippageBps),
            },
          ],
          chain: wallet.chain ?? null,
          account: wallet.account!,
        });
        log.info(`strategy #${s.id} executed on-chain:`, hash);
      } catch (e) {
        log.error(`strategy #${s.id} on-chain execute failed:`, String(e));
      }
    } else {
      const r = mockExecute(ev.request);
      log.info(`strategy #${s.id} simulated execution (${r.mode}):`, r.executionId);
    }
  }
}

async function main(): Promise<void> {
  log.info("CorePilot executor starting");
  log.info("mode:", hasChainConfig ? "chain" : "demo (no contract addresses configured)");

  if (!hasChainConfig) {
    await runDemo();
    log.info("Set contract addresses + EXECUTION_CONTROLLER_ADDRESS to run the full loop.");
    return;
  }

  const client = createCorePilotClient({ rpcUrl: config.rpcUrl, addresses: config.addresses });
  const wallet = buildWallet(config.executorPrivateKey);
  const snapshotWallet = buildWallet(config.oracleSignerPrivateKey) ?? wallet;

  await tick(client, wallet, snapshotWallet);
  setInterval(() => {
    tick(client, wallet, snapshotWallet).catch((e) => log.error("tick failed:", String(e)));
  }, config.pollMs);
}

main().catch((e) => {
  log.error("fatal:", e);
  process.exit(1);
});
