import {
  createWalletClient,
  http,
  parseEventLogs,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createCorePilotClient,
  executionControllerAbi,
  executionIntentToControllerRequest,
  type CorePilotClient,
} from "@corepilot/sdk";
import type { ExecutionConstraints, Receipt, StrategyConfig } from "@corepilot/shared";
import { StrategyType } from "@corepilot/shared";
import { config, hasChainConfig } from "./config.js";
import { log } from "./logger.js";
import { elysiumTestnet } from "./chain.js";
import { fetchMarketContext } from "./data/hyperliquid.js";
import { evaluateStrategy, hasStoredPolicy } from "./engine/evaluateStrategy.js";
import { checkConstraints } from "./engine/constraints.js";
import { mockExecute } from "./execution/adapter.js";
import { submitSnapshot } from "./oracle.js";

function buildWallet(key?: `0x${string}`): WalletClient | undefined {
  if (!key) return undefined;
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: elysiumTestnet, transport: http(config.rpcUrl) });
}

async function runDemo(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = nowSec * 1000;
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
    trigger: { fundingBelowBps: config.fundingTriggerBps, side: config.side },
  };
  const data = {
    market: "HYPE", markPrice: 25, fundingRateBps: config.fundingTriggerBps - 0.25,
    timestamp: nowMs, source: "deterministic-demo",
  };
  log.info("demo-only policy: global funding threshold/side; never used for chain strategies");
  const result = evaluateStrategy(demoStrategy, data, { nowMs });
  for (const item of result.events) log.info(JSON.stringify(item));
  if (!result.intent) return;
  const demoBounds: ExecutionConstraints = {
    strategyId: demoStrategy.id, active: demoStrategy.active, market: demoStrategy.market,
    maxNotionalUsd: demoStrategy.maxNotionalUsd, maxLeverageBps: demoStrategy.maxLeverageBps,
    maxSlippageBps: demoStrategy.maxSlippageBps, expiry: demoStrategy.expiry,
    maxMarketDataAgeMs: 60_000,
  };
  const check = checkConstraints(demoBounds, result.intent, data.timestamp, nowMs);
  const constraintEvent = {
    stage: check.ok ? "CONSTRAINTS_PASSED" as const : "CONSTRAINTS_FAILED" as const,
    strategyId: demoStrategy.id,
    at: nowMs,
    metadata: { checked: check.checked, violations: check.violations },
    reason: check.ok ? undefined : check.violations.join(", "),
  };
  result.events.push(constraintEvent);
  log.info(JSON.stringify(constraintEvent));
  if (!check.ok) {
    result.events.push({ stage: "EXECUTION_SKIPPED", strategyId: demoStrategy.id, at: nowMs, reason: constraintEvent.reason });
    return;
  }
  // Demo mode is permanently simulation-only, even if live execution is configured.
  const simulated = mockExecute(result.intent);
  if (simulated.status !== "SIMULATED") throw new Error("mock adapter did not simulate");
  const submitted = {
    stage: "EXECUTION_SUBMITTED" as const,
    strategyId: demoStrategy.id,
    at: nowMs,
    metadata: { mode: simulated.mode, executionId: simulated.executionId },
  };
  result.events.push(submitted);
  log.info(JSON.stringify(submitted));
  const receipt: Receipt = { status: "SIMULATED", strategyId: demoStrategy.id,
    timestampMs: nowMs, venueFillStatus: "NOT_CONFIRMED", adapter: simulated };
  log.info(JSON.stringify({ stage: "RECEIPT", ...receipt }));
}

async function tick(
  client: CorePilotClient,
  wallet: WalletClient | undefined,
  snapshotWallet: WalletClient | undefined,
): Promise<void> {
  const strategies = await client.read.listStrategies();
  if (strategies.length === 0) {
    log.info("no strategies");
    return;
  }

  for (const s of strategies) {
    try {
      if (!hasStoredPolicy(s)) {
        const receipt: Receipt = { status: "POLICY_DENIED", strategyId: s.id,
          timestampMs: Date.now(), venueFillStatus: "NOT_CONFIRMED",
          reason: "no verified stored per-strategy funding policy; SDK chain read provides bounds only" };
        log.warn(JSON.stringify({
          stage: "EXECUTION_SKIPPED", strategyId: s.id, at: Date.now(),
          reason: receipt.reason,
        }));
        log.warn(JSON.stringify({ stage: "RECEIPT", ...receipt }));
        continue;
      }
      let data;
      try {
        data = await fetchMarketContext(config.hyperliquidApiUrl, s.market);
      } catch (e) {
        log.warn(`market data failed for ${s.market}:`, String(e));
        continue;
      }

      const ev = evaluateStrategy(s, data, {});
      for (const item of ev.events) log.info(JSON.stringify(item));
      if (!ev.intent) {
        const receipt: Receipt = { status: "POLICY_DENIED", strategyId: s.id,
          timestampMs: Date.now(), venueFillStatus: "NOT_CONFIRMED",
          reason: ev.reason ?? "policy did not permit intent" };
        log.info(JSON.stringify({ stage: "RECEIPT", ...receipt }));
        continue;
      }

      if (!config.addresses.controller) throw new Error("controller address is missing");
      const maxMarketDataAgeMs = Number(await client.publicClient.readContract({
        address: config.addresses.controller, abi: executionControllerAbi,
        functionName: "maxMarketDataAgeMs",
      }));
      const bounds: ExecutionConstraints = {
        strategyId: s.id, active: s.active, market: s.market,
        maxNotionalUsd: s.maxNotionalUsd, maxLeverageBps: s.maxLeverageBps,
        maxSlippageBps: s.maxSlippageBps, expiry: s.expiry, maxMarketDataAgeMs,
      };

      const constraintAt = Date.now();
      const check = checkConstraints(bounds, ev.intent, data.timestamp, constraintAt);
      const constraintEvent = {
        stage: check.ok ? "CONSTRAINTS_PASSED" as const : "CONSTRAINTS_FAILED" as const,
        strategyId: s.id,
        at: constraintAt,
        metadata: { checked: check.checked, violations: check.violations },
        reason: check.ok ? undefined : check.violations.join(", "),
      };
      ev.events.push(constraintEvent);
      if (!check.ok) {
        ev.events.push({ stage: "EXECUTION_SKIPPED", strategyId: s.id, at: constraintAt, reason: constraintEvent.reason });
        log.warn(JSON.stringify(constraintEvent));
        const receipt: Receipt = { status: "CONSTRAINTS_REJECTED", strategyId: s.id,
          timestampMs: constraintAt, venueFillStatus: "NOT_CONFIRMED", reasons: check.violations };
        log.warn(JSON.stringify({ stage: "RECEIPT", ...receipt }));
        continue;
      }
      log.info(JSON.stringify(constraintEvent));

      if (config.enableLiveExecution) {
        try {
          if (!wallet || !snapshotWallet || !config.addresses.marketData) {
            throw new Error("live execution requires executor wallet, snapshot signer and oracle address");
          }
          const snapshotHash = await submitSnapshot(snapshotWallet, config.chainId, config.addresses.marketData, data);
          const snapshotReceipt = await client.publicClient.waitForTransactionReceipt({ hash: snapshotHash });
          if (snapshotReceipt.status !== "success") throw new Error("oracle snapshot transaction reverted");
          const hash = await wallet.writeContract({
          address: config.addresses.controller,
          abi: executionControllerAbi,
          functionName: "execute",
          args: [executionIntentToControllerRequest(ev.intent)],
          chain: wallet.chain ?? null,
          account: wallet.account!,
          });
          const mined = await client.publicClient.waitForTransactionReceipt({ hash });
          if (mined.status !== "success") throw new Error("controller transaction reverted");
          const accepted = parseEventLogs({ abi: executionControllerAbi,
            logs: mined.logs, eventName: "AdapterRequestAccepted" })
            .find((item) => item.address.toLowerCase() === config.addresses.controller!.toLowerCase() &&
              item.args.strategyId === BigInt(s.id));
          if (!accepted) throw new Error("mined transaction lacks AdapterRequestAccepted event");
          const submitted = { stage: "EXECUTION_SUBMITTED" as const, strategyId: s.id, at: Date.now(), metadata: { txHash: hash } };
          ev.events.push(submitted);
          log.info(JSON.stringify(submitted));
          const receipt: Receipt = { status: "ADAPTER_REQUESTED", strategyId: s.id,
            timestampMs: Date.now(), venueFillStatus: "NOT_CONFIRMED",
            adapter: { status: "ADAPTER_REQUESTED", mode: "onchain",
              executionId: accepted.args.requestId, txHash: hash } };
          log.info(JSON.stringify({ stage: "RECEIPT", ...receipt }));
        } catch (e) {
          const skipped = { stage: "EXECUTION_SKIPPED" as const, strategyId: s.id, at: Date.now(), reason: String(e) };
          ev.events.push(skipped);
          log.error(JSON.stringify(skipped));
          const receipt: Receipt = { status: "ADAPTER_FAILED", strategyId: s.id,
            timestampMs: Date.now(), venueFillStatus: "NOT_CONFIRMED",
            adapter: { status: "ADAPTER_FAILED", mode: "onchain", reason: String(e) } };
          log.error(JSON.stringify({ stage: "RECEIPT", ...receipt }));
        }
      } else {
        const r = mockExecute(ev.intent);
        if (r.status !== "SIMULATED") throw new Error("mock adapter did not simulate");
        const submitted = { stage: "EXECUTION_SUBMITTED" as const, strategyId: s.id, at: Date.now(), metadata: { mode: r.mode, executionId: r.executionId } };
        ev.events.push(submitted);
        log.info(JSON.stringify(submitted));
        const receipt: Receipt = { status: "SIMULATED", strategyId: s.id,
          timestampMs: Date.now(), venueFillStatus: "NOT_CONFIRMED", adapter: r };
        log.info(JSON.stringify({ stage: "RECEIPT", ...receipt }));
      }
    } catch (e) {
      log.error(`strategy #${s.id} processing failed; continuing:`, String(e));
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
