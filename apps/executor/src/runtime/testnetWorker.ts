import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import { hashMessage, isAddress, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createCorePilotClient } from "@corepilot/sdk";
import { authorizationSigningMessage, checkTradingAccess, evaluateOperational,
  isStrategyPolicyV1, isTradingAccessGrantV1, policySigningMessage,
  tradingAccessSigningMessage, type StrategyPolicyV1, type TraderAuthorizationV1,
  type TradingAccess, type TradingAccessGrantV1 } from "@corepilot/shared";
import { cloidForIntent, reconcileTestnetOrder, submitTestnetOrder,
  verifyTestnetAgent, type VenueIntent } from "../execution/hypercoreTestnet.js";

type RecordRow = Record<string, unknown>;
const hex = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);
const number = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value ?? "");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function policyFromRow(row: RecordRow): StrategyPolicyV1 {
  return { chainId: number(row.chain_id), registry: str(row.registry) as `0x${string}`,
    strategyId: number(row.strategy_id), creator: str(row.creator) as `0x${string}`,
    version: number(row.policy_version), market: str(row.market),
    signal: { type: "funding_rate", operator: "lt", thresholdBps: number(row.threshold_bps) },
    action: { type: "open_position", side: str(row.policy_side) as "long" | "short" },
    bounds: { maxNotionalUsd: number(row.policy_max_notional),
      maxLeverageBps: number(row.policy_max_leverage), maxSlippageBps: number(row.policy_max_slippage),
      expiry: number(row.policy_expiry) }, enabled: row.policy_enabled === true };
}

function authorizationFromRow(row: RecordRow): TraderAuthorizationV1 {
  return { authorizationId: str(row.authorization_id), chainId: number(row.chain_id),
    registry: str(row.registry) as `0x${string}`, strategyId: number(row.strategy_id),
    policyVersion: number(row.policy_version), policyHash: str(row.policy_hash) as `0x${string}`,
    trader: str(row.trader) as `0x${string}`, version: 1,
    maxNotionalUsd: number(row.auth_max_notional), maxLeverageBps: number(row.auth_max_leverage),
    maxSlippageBps: number(row.auth_max_slippage), validFromMs: number(row.valid_from_ms),
    validUntilMs: number(row.valid_until_ms) };
}

function accessFromRow(row: RecordRow): TradingAccess {
  return { trader: str(row.trader) as `0x${string}`,
    executionAccount: str(row.execution_account) as `0x${string}`,
    agentAddress: str(row.agent_address) as `0x${string}`,
    isolationMode: str(row.isolation_mode) as TradingAccess["isolationMode"],
    status: str(row.agent_status) as TradingAccess["status"],
    verifiedAtMs: row.verified_at instanceof Date ? row.verified_at.getTime() : null,
    expiresAtMs: row.agent_expires_at instanceof Date ? row.agent_expires_at.getTime() : 0 };
}

async function pendingIntent(pool: Pool): Promise<RecordRow | null> {
  const result = await pool.query<RecordRow>(`
    SELECT i.intent_id, i.trigger_id, i.authorization_id, i.agent_id, i.strategy_id,
      i.policy_hash, i.execution_account, i.market, i.side, i.notional_usd,
      i.leverage_bps, i.slippage_bps, i.expires_at,
      a.chain_id, a.registry, a.trader, a.version AS auth_version,
      a.max_notional_usd AS auth_max_notional, a.max_leverage_bps AS auth_max_leverage,
      a.max_slippage_bps AS auth_max_slippage, a.valid_from_ms, a.valid_until_ms,
      a.status AS auth_status, a.signature AS auth_signature,
      p.creator, p.version AS policy_version, p.threshold_bps, p.side AS policy_side,
      p.max_notional_usd AS policy_max_notional, p.max_leverage_bps AS policy_max_leverage,
      p.max_slippage_bps AS policy_max_slippage, p.expiry AS policy_expiry,
      p.enabled AS policy_enabled, p.signature AS policy_signature,
      ag.agent_address, ag.isolation_mode, ag.status AS agent_status,
      ag.grant_signature, ag.verified_at, ag.expires_at AS agent_expires_at,
      t.matched, t.policy_hash AS trigger_policy_hash,
      m.market AS snapshot_market, m.funding_rate_bps, m.source AS snapshot_source,
      m.timestamp AS snapshot_timestamp
    FROM execution_intents i
    JOIN trader_authorizations a ON a.authorization_id = i.authorization_id
    JOIN strategy_policies p ON p.chain_strategy_id = i.strategy_id
      AND p.policy_hash = i.policy_hash AND p.chain_id = a.chain_id AND p.registry = a.registry
    JOIN trading_agents ag ON ag.id = i.agent_id AND ag.authorization_id = a.authorization_id
    JOIN trigger_events t ON t.id = i.trigger_id AND t.authorization_id = a.authorization_id
    JOIN market_snapshots m ON m.id = t.snapshot_id
    WHERE i.status = 'CREATED'
      AND NOT EXISTS (SELECT 1 FROM strategy_policies newer
        WHERE newer.chain_id=p.chain_id AND newer.registry=p.registry
          AND newer.chain_strategy_id=p.chain_strategy_id AND newer.version>p.version)
    ORDER BY i.created_at ASC LIMIT 1`);
  return result.rows[0] ?? null;
}

async function revalidate(row: RecordRow, agentAddress: `0x${string}`): Promise<VenueIntent> {
  const now = Date.now();
  const policy = policyFromRow(row);
  const auth = authorizationFromRow(row);
  const access = accessFromRow(row);
  if (!isStrategyPolicyV1(policy) || !hex(row.policy_signature) ||
      !same(hashMessage(policySigningMessage(policy)), str(row.policy_hash)) ||
      !await verifyMessage({ address: policy.creator, message: policySigningMessage(policy),
        signature: row.policy_signature })) throw new Error("POLICY_UNVERIFIED");
  if (row.auth_status !== "ACTIVE" || !hex(row.auth_signature) ||
      !await verifyMessage({ address: auth.trader, message: authorizationSigningMessage(auth),
        signature: row.auth_signature }) || auth.validFromMs > now || auth.validUntilMs <= now ||
      !same(auth.policyHash, str(row.policy_hash)) || auth.policyVersion !== policy.version) {
    throw new Error("AUTHORIZATION_UNVERIFIED");
  }
  const grant: TradingAccessGrantV1 = { version: 1, authorizationId: auth.authorizationId,
    chainId: auth.chainId, registry: auth.registry, trader: auth.trader,
    executionAccount: access.executionAccount, agentAddress: access.agentAddress,
    isolationMode: access.isolationMode, validUntilMs: access.expiresAtMs };
  if (!isTradingAccessGrantV1(grant) || !hex(row.grant_signature) ||
      !await verifyMessage({ address: auth.trader, message: tradingAccessSigningMessage(grant),
        signature: row.grant_signature }) || checkTradingAccess(access, now, 60_000) ||
      !same(access.agentAddress, agentAddress) || !same(access.executionAccount, str(row.execution_account)) ||
      !await verifyTestnetAgent({ intentId: str(row.intent_id), trader: auth.trader,
        agentAddress: access.agentAddress, executionAccount: access.executionAccount,
        isolationMode: access.isolationMode, market: policy.market, side: policy.action.side,
        notionalUsd: number(row.notional_usd), leverageBps: number(row.leverage_bps),
        slippageBps: number(row.slippage_bps), expiresAtMs: (row.expires_at as Date).getTime() }, agentAddress)) {
    throw new Error("TRADING_AGENT_UNVERIFIED");
  }
  if (row.matched !== true || !same(str(row.trigger_policy_hash), str(row.policy_hash)) ||
      !same(str(row.snapshot_market), policy.market) ||
      str(row.snapshot_source) !== "hypercore-mainnet" || !integer(row.notional_usd) ||
      !integer(row.leverage_bps) || !integer(row.slippage_bps) ||
      !(row.expires_at instanceof Date) || row.expires_at.getTime() <= now) throw new Error("INTENT_INVALID_OR_EXPIRED");
  const registry = process.env.STRATEGY_REGISTRY_ADDRESS;
  const staking = process.env.STAKING_ADDRESS;
  const executorKey = process.env.EXECUTOR_PRIVATE_KEY;
  if (!registry || !isAddress(registry) || !same(registry, policy.registry) ||
      !staking || !isAddress(staking) || !executorKey || !/^0x[0-9a-fA-F]{64}$/.test(executorKey)) {
    throw new Error("ELYSIUM_CONFIGURATION_INCOMPLETE");
  }
  const executorAddress = privateKeyToAccount(executorKey as `0x${string}`).address;
  const client = createCorePilotClient({ rpcUrl: process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz",
    addresses: { registry, staking } });
  if (await client.publicClient.getChainId() !== 99801 ||
      !await client.publicClient.getBytecode({ address: registry })) throw new Error("ELYSIUM_DEPLOYMENT_UNVERIFIED");
  const [strategy, creatorBonded, executorBonded] = await Promise.all([
    client.read.getStrategyRecord(policy.strategyId), client.read.isCreatorBonded(policy.strategyId),
    client.read.isExecutorBonded(executorAddress),
  ]);
  if (!same(strategy.market, policy.market) || !same(strategy.creator, policy.creator)) throw new Error("POLICY_CHAIN_MISMATCH");
  const decision = evaluateOperational({ strategy, policy, authorization: auth,
    authorizationStatus: "ACTIVE", snapshot: { market: str(row.snapshot_market),
      fundingRateBps: number(row.funding_rate_bps), timestampMs: number(row.snapshot_timestamp),
      source: "hypercore-mainnet" }, requested: { notionalUsd: number(row.notional_usd),
      leverageBps: number(row.leverage_bps), slippageBps: number(row.slippage_bps) },
    creatorBonded, executorBonded, nowMs: Date.now(), maxSnapshotAgeMs: 60_000 });
  if (!decision.ready) throw new Error(decision.blocker);
  return { intentId: str(row.intent_id), trader: auth.trader, agentAddress: access.agentAddress,
    executionAccount: access.executionAccount, isolationMode: access.isolationMode,
    market: policy.market, side: policy.action.side, notionalUsd: number(row.notional_usd),
    leverageBps: number(row.leverage_bps), slippageBps: number(row.slippage_bps),
    expiresAtMs: row.expires_at.getTime() };
}

async function claim(client: PoolClient, intent: VenueIntent): Promise<boolean> {
  await client.query("BEGIN");
  try {
    const updated = await client.query(`UPDATE execution_intents SET status = 'SUBMITTING'
      WHERE intent_id = $1 AND status = 'CREATED' AND expires_at > NOW()
      AND EXISTS (SELECT 1 FROM trader_authorizations a WHERE a.authorization_id = execution_intents.authorization_id AND a.status = 'ACTIVE')
      AND EXISTS (SELECT 1 FROM trading_agents ag WHERE ag.id = execution_intents.agent_id AND ag.status = 'ACTIVE')
      RETURNING intent_id`, [intent.intentId]);
    if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`INSERT INTO venue_receipts
      (intent_id, venue, execution_account, client_order_id, status)
      VALUES ($1, 'hypercore-testnet', $2, $3, 'SUBMITTING')`,
    [intent.intentId, intent.executionAccount.toLowerCase(), cloidForIntent(intent.intentId)]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function recordEvidence(pool: Pool, intentId: string, state: string,
  orderId: string | null, filledSize: string | null, averagePrice: string | null,
  venueStatus: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE venue_receipts SET status=$2, order_id=COALESCE($3,order_id),
      filled_size=COALESCE($4,filled_size), average_price=COALESCE($5,average_price), last_reconciled_at=NOW()
      WHERE intent_id=$1`, [intentId, state, orderId, filledSize, averagePrice]);
    await client.query("UPDATE execution_intents SET status=$2 WHERE intent_id=$1", [intentId, state]);
    await client.query(`INSERT INTO reconciliation_events (intent_id, venue_status)
      VALUES ($1,$2)`, [intentId, venueStatus.slice(0, 200)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function reconcilePending(pool: Pool): Promise<void> {
  const rows = await pool.query<{ intent_id: string; execution_account: `0x${string}`; client_order_id: `0x${string}` }>(`
    SELECT vr.intent_id, vr.execution_account, vr.client_order_id FROM venue_receipts vr
    WHERE vr.status IN ('SUBMITTING','SUBMITTED','OPEN','UNKNOWN')
      AND vr.created_at > NOW() - INTERVAL '5 minutes'
      AND (SELECT COUNT(*) FROM reconciliation_events re WHERE re.intent_id=vr.intent_id) < 3
    ORDER BY vr.created_at ASC LIMIT 5`);
  for (const row of rows.rows) {
    try {
      const evidence = await reconcileTestnetOrder(row.execution_account, row.client_order_id);
      await recordEvidence(pool, row.intent_id, evidence.state, evidence.orderId,
        evidence.filledSize, evidence.averagePrice, evidence.venueStatus);
    } catch {
      await recordEvidence(pool, row.intent_id, "UNKNOWN", null, null, null, "RECONCILIATION_UNAVAILABLE");
    }
  }
}

export async function runTestnetWorkerCycle(pool: Pool, agentKey: `0x${string}`): Promise<void> {
  await reconcilePending(pool);
  const row = await pendingIntent(pool);
  if (!row) return;
  const agent = privateKeyToAccount(agentKey);
  let intent: VenueIntent;
  try { intent = await revalidate(row, agent.address); }
  catch (error) {
    const reason = error instanceof Error ? error.message : "VALIDATION_FAILED";
    if (reason === "INTENT_INVALID_OR_EXPIRED" || reason === "AUTHORIZATION_UNVERIFIED" ||
        reason === "POLICY_UNVERIFIED" || reason === "TRADING_AGENT_UNVERIFIED") {
      await pool.query("UPDATE execution_intents SET status='REJECTED' WHERE intent_id=$1 AND status='CREATED'", [row.intent_id]);
    }
    return;
  }
  const client = await pool.connect();
  try { if (!await claim(client, intent)) return; }
  finally { client.release(); }
  try {
    const evidence = await submitTestnetOrder(intent, agentKey);
    await recordEvidence(pool, intent.intentId, evidence.state, evidence.orderId,
      evidence.filledSize, evidence.averagePrice, evidence.venueStatus);
  } catch {
    // Delivery may have happened before a timeout. Never resend the same intent.
    await recordEvidence(pool, intent.intentId, "UNKNOWN", null, null, null, "SUBMISSION_UNCERTAIN");
  }
}

export async function startTestnetWorker(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const agentKey = process.env.HYPERCORE_TESTNET_AGENT_PRIVATE_KEY;
  if (process.env.EXECUTOR_ENABLE_TESTNET_ORDERS !== "true" || !url ||
      !agentKey || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
    throw new Error("TESTNET_WORKER_DISABLED_OR_UNCONFIGURED");
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    await pool.query("SELECT 1");
    // No automatic mainnet fallback: the adapter pins testnet transport.
    for (;;) {
      try { await runTestnetWorkerCycle(pool, agentKey as `0x${string}`); }
      catch { console.error("Testnet worker cycle failed; no automatic resend"); }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } finally { await pool.end(); }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/testnetWorker.ts")) {
  startTestnetWorker().catch(error => { console.error(error instanceof Error ? error.message : "WORKER_FAILED"); process.exitCode = 1; });
}
