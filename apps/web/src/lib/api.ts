import { DEFAULT_MARKETS } from "@corepilot/shared";
import type { StrategyPolicyV1, TraderAuthorizationV1, TradingAccessGrantV1 } from "@corepilot/shared";
import { parseEvaluateResult, type EvaluateResult } from "./evaluation";
export type { EvaluateResult } from "./evaluation";

export type DataSource = "LIVE" | "TESTNET" | "SIMULATED" | "DEMO" | "UNKNOWN";

export interface ApiResult<T> {
  data: T;
  source: DataSource;
  db: boolean;
  error?: string;
}

export interface StrategyView {
  id: number;
  chainStrategyId: number | null;
  name: string;
  description?: string | null;
  creator: string;
  market: string;
  strategyType: string;
  active: boolean | null;
  /** PILOT backing in whole tokens, or null when unknown (not returned by the API). */
  pilotBacking: number | null;
  /** Execution count, or null when unknown. */
  executions: number | null;
  expiry?: number | null;
  maxLeverageBps?: number | null;
  maxSlippageBps?: number | null;
  maxNotionalUsd?: number | null;
}

export interface MarketView {
  market: string;
  markPrice: number | null;
  fundingRateBps: number;
  source: string;
  timestamp: number;
  dataSource: DataSource;
}

export interface ExecutionView {
  id: number;
  strategyId: number;
  status: "EXECUTED" | "REJECTED" | string;
  requestedNotional: number | null;
  txHash?: string | null;
  externalExecutionId?: string | null;
  error?: string | null;
  createdAt?: string | null;
}

export interface ConstraintCheckView {
  ok: boolean;
  violations: string[];
  checked: Record<string, boolean>;
}

export interface HealthResult {
  ok: boolean;
  service: string;
  chainId: number;
  db: boolean;
  network?: { chainId: number };
  components?: Partial<Record<"api" | "database" | "rpc" | "contracts" | "executor", HealthState>>;
}

export type HealthState = "operational" | "degraded" | "unavailable" | "unknown" | "not_instrumented";

export interface CapabilityItem { type: string; support: "supported" | "planned"; }
export interface CapabilityResult {
  signals: CapabilityItem[];
  actions: CapabilityItem[];
  network?: { name: string; chainId: number };
  contracts?: { configured: boolean; addresses: Record<string, boolean>;
    deployment?: { registry: string | null; pilotToken: string | null; staking: string | null } };
  executor?: { status: string };
}

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8001").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 15000;

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "request timed out";
  }
  if (error instanceof Error) return error.message;
  return "unknown error";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifiedPolicy { policy: StrategyPolicyV1; hash: `0x${string}`; status: "VERIFIED" | "DISABLED" }
export interface AuthorizationView { authorization: TraderAuthorizationV1; status: string; policy?: StrategyPolicyV1 | null; reason?: string }
export interface AuthorizationEventView { id: number; authorizationId: string; strategyId: number; action: "PAUSE" | "RESUME" | "REVOKE"; version: number; timestamp: string; provenance: "testnet" }

export function fetchVerifiedPolicy(chainStrategyId: number) {
  return request<VerifiedPolicy>(`/api/policies/${chainStrategyId}`);
}

export function saveSignedPolicy(policy: StrategyPolicyV1, signature: `0x${string}`) {
  return request<VerifiedPolicy>(`/api/policies/${policy.strategyId}`, {
    method: "POST", body: JSON.stringify({ policy, signature }),
  });
}

export function fetchAuthorizations(trader: string) {
  return request<{ data: AuthorizationView[]; provenance: string }>(`/api/authorizations/trader/${trader}`);
}

export function fetchAuthorizationEvents(trader: string) {
  return request<{ data: AuthorizationEventView[]; provenance: string }>(`/api/authorization-events/trader/${trader}`);
}

export function saveSignedAuthorization(authorization: TraderAuthorizationV1, signature: `0x${string}`) {
  return request<{ authorizationId: string; status: string }>("/api/authorizations", {
    method: "POST", body: JSON.stringify({ authorization, signature }),
  });
}

export function changeAuthorizationState(authorizationId: string, action: "PAUSE" | "RESUME" | "REVOKE", version: number, signature: `0x${string}`) {
  return request<{ authorizationId: string; status: string; version: number }>(`/api/authorizations/${authorizationId}/state`, {
    method: "POST", body: JSON.stringify({ action, version, signature }),
  });
}

export interface TradingAccessView {
  authorizationId: string;
  executionAccount: string;
  agentAddress: string;
  isolationMode: "ISOLATED" | "COMPATIBILITY";
  status: "ACTIVE" | "UNVERIFIED";
  verifiedAt: string | null;
  venue: "hypercore-testnet";
  nativeAgentLimits: string;
}

export function fetchTradingAccess(authorizationId: string) {
  return request<TradingAccessView>(`/api/trading-access/${authorizationId}`);
}

export function checkTradingAccess(input: { authorizationId: string; executionAccount: string;
  agentAddress: string; isolationMode: "ISOLATED" | "COMPATIBILITY" }) {
  return request<{ ready: boolean; reason: string; venue: "hypercore-testnet"; readOnly: true }>(
    "/api/trading-access/check", { method: "POST", body: JSON.stringify(input) });
}

export function saveSignedTradingAccess(grant: TradingAccessGrantV1, signature: `0x${string}`) {
  return request<TradingAccessView>("/api/trading-access", {
    method: "POST", body: JSON.stringify({ grant, signature }),
  });
}

export interface RuntimeTraceView {
  signalSource: "hypercore-mainnet";
  policyLayer: "elysium-testnet";
  executionVenue: "hypercore-testnet";
  triggers: { id: number; matched: boolean; reason: string; observedAt: string;
    snapshot: { market: string | null; fundingRateBps: number | null; source: string | null; observedAtMs: number | null } | null }[];
  intents: { intentId: string; status: string; market: string; side: string;
    createdAt: string; corePilotReceipt: { policyHash: string; authorizationId: string;
      triggerId: number; intentId: string };
    venueReceipt: { venue: string; clientOrderId: string; orderId: string | null;
      status: string; filledSize: string | null; averagePrice: string | null;
      lastReconciledAt: string | null } | null }[];
}

export function fetchRuntimeTrace(authorizationId: string) {
  return request<RuntimeTraceView>(`/api/runtime/authorization/${authorizationId}`);
}

/* ------------------------------------------------------------------ */
/* Demo / simulated fallbacks                                          */
/* ------------------------------------------------------------------ */

const DEMO_STRATEGIES: StrategyView[] = [
  {
    id: 1,
    chainStrategyId: null,
    name: "HYPE Funding Fade",
    description:
      "Open a bounded long when HYPE hourly funding prints below the trigger. Max 3x, 50bps slippage.",
    creator: "0x8f3a1c4d9b7e2a5c6d1f0e8b3a2c4d5e6f708192",
    market: "HYPE",
    strategyType: "FUNDING_TRIGGER",
    active: true,
    pilotBacking: 5000,
    executions: 12,
    expiry: 0,
    maxLeverageBps: 300,
    maxSlippageBps: 50,
    maxNotionalUsd: 25000,
  },
  {
    id: 2,
    chainStrategyId: null,
    name: "BTC Basis Capture",
    description:
      "Long BTC when the hourly funding rate is deeply negative. Constraint-bounded notional.",
    creator: "0x2b7d9e0f1a3c5e7b9d1f3a5c7e9b0d2f4a6c8e10",
    market: "BTC",
    strategyType: "FUNDING_TRIGGER",
    active: true,
    pilotBacking: 8000,
    executions: 5,
    expiry: 0,
    maxLeverageBps: 200,
    maxSlippageBps: 30,
    maxNotionalUsd: 50000,
  },
  {
    id: 3,
    chainStrategyId: null,
    name: "ETH Mean Reversion",
    description:
      "Funding-triggered ETH entry with tight slippage. Currently paused by the creator.",
    creator: "0x5c1e3a7b9d0f2e4a6c8b0d2f4a6c8e1b3d5f7091",
    market: "ETH",
    strategyType: "FUNDING_TRIGGER",
    active: false,
    pilotBacking: 2500,
    executions: 3,
    expiry: 0,
    maxLeverageBps: 300,
    maxSlippageBps: 40,
    maxNotionalUsd: 15000,
  },
];

const DEMO_MARKET_PRICES: Record<string, number> = {
  HYPE: 31.42,
  BTC: 104250.5,
  ETH: 3380.75,
};

function demoMarket(symbol: string): MarketView {
  const market = symbol.toUpperCase();
  const price = DEMO_MARKET_PRICES[market] ?? 100;
  return {
    market,
    markPrice: price,
    fundingRateBps: -1.82,
    source: "simulated",
    timestamp: Date.now(),
    dataSource: "SIMULATED",
  };
}

const DEMO_EXECUTIONS: ExecutionView[] = [
  {
    id: 11,
    strategyId: 1,
    status: "ADAPTER_REQUESTED",
    requestedNotional: 8200,
    txHash: "0x9f1c2e3d4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c",
    externalExecutionId: "hl-order-448192",
    error: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    id: 10,
    strategyId: 1,
    status: "REJECTED",
    requestedNotional: 41000,
    txHash: null,
    externalExecutionId: null,
    error: "NotionalExceeded",
    createdAt: new Date(Date.now() - 1000 * 60 * 96).toISOString(),
  },
  {
    id: 9,
    strategyId: 1,
    status: "ADAPTER_REQUESTED",
    requestedNotional: 6100,
    txHash: "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
    externalExecutionId: "hl-order-447931",
    error: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
];

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */

interface ApiStrategyRow {
  identity?: { id?: number; chainStrategyId?: number | null };
  source?: { provenance?: string | null };
  signal?: unknown;
  action?: unknown;
  id?: number;
  chainStrategyId?: number | null;
  creator?: string | null;
  name?: string | null;
  description?: string | null;
  market?: string | { symbol?: string } | null;
  strategyType?: string | null;
  active?: boolean | null;
  expiry?: number | null;
  pilotBacking?: number | null;
  constraints?: { maxNotionalUsd?: number; maxLeverageBps?: number; maxSlippageBps?: number } | null;
  createdAt?: string | null;
}

interface ApiMarketRow {
  id?: number;
  market?: string | null;
  markPrice?: number | null;
  fundingRateBps?: number | null;
  source?: string | null;
  timestamp?: number | null;
}

interface ApiExecutionRow {
  executionId?: string | null;
  reason?: string | null;
  transaction?: string | null;
  timestamp?: string | null;
  provenance?: string | null;
  id?: number;
  strategyId?: number | null;
  status?: string | null;
  requestedNotional?: number | null;
  txHash?: string | null;
  externalExecutionId?: string | null;
  error?: string | null;
  createdAt?: string | null;
}

function toStrategyView(row: ApiStrategyRow): StrategyView {
  const id = row.identity?.id ?? row.id ?? Number(row.chainStrategyId ?? 0);
  return {
    id,
    chainStrategyId: row.identity?.chainStrategyId ?? row.chainStrategyId ?? null,
    name: row.name?.trim() || `Strategy #${id}`,
    description: row.description ?? null,
    creator: row.creator ?? "",
    market: (typeof row.market === "object" && row.market !== null ? (row.market as { symbol?: string }).symbol : row.market ?? "—")?.toUpperCase() ?? "—",
    strategyType: row.strategyType ?? "SIGNAL UNINDEXED",
    active: row.active ?? null,
    pilotBacking: typeof row.pilotBacking === "number" ? row.pilotBacking : null,
    executions: null,
    expiry: typeof row.expiry === "number" ? row.expiry : null,
    maxLeverageBps: row.constraints?.maxLeverageBps ?? null,
    maxSlippageBps: row.constraints?.maxSlippageBps ?? null,
    maxNotionalUsd: row.constraints?.maxNotionalUsd ?? null,
  };
}

function toMarketSource(source: string | null | undefined): DataSource {
  const value = (source ?? "").toLowerCase();
  if (value.includes("hyperliquid") || value.includes("hypercore")) return "LIVE";
  if (value === "elysium-oracle" || value === "oracle") return "LIVE";
  if (value === "simulated" || value === "mock") return "SIMULATED";
  return "UNKNOWN";
}

function toProvenance(value: string | null | undefined): DataSource {
  switch (value?.toLowerCase()) {
    case "live": return "LIVE";
    case "testnet": return "TESTNET";
    case "simulated": return "SIMULATED";
    case "demo": return "DEMO";
    default: return "UNKNOWN";
  }
}

function toMarketView(row: ApiMarketRow): MarketView {
  if (typeof row.fundingRateBps !== "number" || !Number.isFinite(row.fundingRateBps) ||
      typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) {
    throw new Error("incomplete market snapshot");
  }
  const source = row.source ?? "unknown";
  return {
    market: (row.market ?? "—").toUpperCase(),
    markPrice: typeof row.markPrice === "number" && Number.isFinite(row.markPrice) ? row.markPrice : null,
    fundingRateBps: row.fundingRateBps,
    source,
    timestamp: row.timestamp,
    dataSource: toMarketSource(source),
  };
}

function toExecutionView(row: ApiExecutionRow): ExecutionView {
  return {
    id: typeof row.id === "number" ? row.id : 0,
    strategyId: typeof row.strategyId === "number" ? row.strategyId : 0,
    status: row.status ?? "UNKNOWN",
    requestedNotional: typeof row.requestedNotional === "number" ? row.requestedNotional : null,
    txHash: row.transaction ?? row.txHash ?? null,
    externalExecutionId: row.executionId ?? row.externalExecutionId ?? null,
    error: row.reason ?? row.error ?? null,
    createdAt: row.timestamp ?? row.createdAt ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function fetchHealth(): Promise<ApiResult<HealthResult | null>> {
  try {
    const json = await request<Partial<HealthResult>>("/api/health");
    return {
      data: {
        ok: Boolean(json.ok),
        service: json.service ?? "corepilot-api",
        chainId: typeof json.chainId === "number" ? json.chainId : 99801,
        db: Boolean(json.db),
        network: json.network,
        components: json.components,
      },
      source: "TESTNET",
      db: Boolean(json.db),
    };
  } catch (error) {
    return { data: null, source: "DEMO", db: false, error: errorMessage(error) };
  }
}

export async function fetchCapabilities(): Promise<ApiResult<CapabilityResult>> {
  try {
    const json = await request<CapabilityResult>("/api/capabilities");
    return { data: json, source: "TESTNET", db: false };
  } catch (error) {
    return {
      data: {
        signals: [{ type: "funding_rate", support: "supported" }],
        actions: [{ type: "open_position", support: "supported" }],
      },
      source: "DEMO",
      db: false,
      error: errorMessage(error),
    };
  }
}

export async function fetchMarkets(): Promise<ApiResult<string[]>> {
  try {
    const json = await request<{ data: string[] | null; db: boolean }>("/api/markets");
    const rows = Array.isArray(json.data) ? json.data.filter((m) => typeof m === "string") : [];
    if (rows.length === 0) {
      return {
        data: [...DEFAULT_MARKETS],
        source: "DEMO",
        db: Boolean(json.db),
        error: "API returned no markets; using a demo market list",
      };
    }
    return { data: rows, source: "UNKNOWN", db: Boolean(json.db) };
  } catch (error) {
    return { data: [...DEFAULT_MARKETS], source: "DEMO", db: false, error: errorMessage(error) };
  }
}

export async function fetchMarketData(symbol: string): Promise<ApiResult<MarketView>> {
  try {
    const json = await request<{ data: ApiMarketRow | null; db: boolean }>(
      `/api/market/${encodeURIComponent(symbol)}`,
    );
    if (!json.data) throw new Error("no snapshot available");
    const view = toMarketView(json.data);
    return { data: view, source: view.dataSource, db: Boolean(json.db) };
  } catch (error) {
    return { data: demoMarket(symbol), source: "SIMULATED", db: false, error: errorMessage(error) };
  }
}

export async function fetchStrategies(): Promise<ApiResult<StrategyView[]>> {
  try {
    const json = await request<{ data: ApiStrategyRow[] | null; db: boolean }>("/api/strategies");
    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length === 0 && !json.db) {
      return {
        data: DEMO_STRATEGIES,
        source: "DEMO",
        db: Boolean(json.db),
        error: "API returned no strategies",
      };
    }
    return { data: rows.map(toStrategyView), source: rows.length ? toProvenance(rows[0].source?.provenance) : "UNKNOWN", db: Boolean(json.db) };
  } catch (error) {
    return { data: DEMO_STRATEGIES, source: "DEMO", db: false, error: errorMessage(error) };
  }
}

export async function fetchStrategy(id: number): Promise<ApiResult<StrategyView | null>> {
  try {
    const json = await request<{ data: ApiStrategyRow | null; db: boolean }>(
      `/api/strategies/${id}`,
    );
    if (!json.data && json.db) return { data: null, source: "UNKNOWN", db: true };
    if (!json.data) throw new Error("strategy not found");
    return { data: toStrategyView(json.data), source: toProvenance(json.data.source?.provenance), db: Boolean(json.db) };
  } catch (error) {
    const demo = DEMO_STRATEGIES.find((s) => s.id === id) ?? null;
    return { data: demo, source: "DEMO", db: false, error: errorMessage(error) };
  }
}

export async function fetchExecutions(id: number): Promise<ApiResult<ExecutionView[]>> {
  try {
    const json = await request<{ data: ApiExecutionRow[] | null; db: boolean }>(
      `/api/strategies/${id}/executions`,
    );
    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length === 0 && !json.db) {
      return {
        data: DEMO_EXECUTIONS.filter((e) => e.strategyId === id),
        source: "DEMO",
        db: Boolean(json.db),
        error: "API returned no executions",
      };
    }
    return { data: rows.map(toExecutionView), source: rows.length ? toProvenance(rows[0].provenance) : "UNKNOWN", db: Boolean(json.db) };
  } catch (error) {
    return {
      data: DEMO_EXECUTIONS.filter((e) => e.strategyId === id),
      source: "DEMO",
      db: false,
      error: errorMessage(error),
    };
  }
}

export interface EvaluateParams {
  market?: string;
  markPrice?: number;
  fundingRateBps?: number;
  side?: "long" | "short";
}

export async function evaluateStrategy(
  strategyId: number,
): Promise<ApiResult<EvaluateResult | null>> {
  try {
    const json = parseEvaluateResult(await request<unknown>(`/api/executor/evaluate/${strategyId}`, {
      method: "POST",
      body: JSON.stringify({}),
    }));
    if (json.strategyId !== strategyId) throw new Error("evaluation response strategy ID mismatch");
    return {
      data: json,
      // The endpoint does not verify a chain policy or limits, even when DB metadata exists.
      source: "UNKNOWN",
      db: Boolean(json.db),
    };
  } catch (error) {
    return { data: null, source: "UNKNOWN", db: false, error: errorMessage(error) };
  }
}
