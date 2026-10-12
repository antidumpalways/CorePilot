import { DEFAULT_MARKETS } from "@corepilot/shared";

export type DataSource = "LIVE" | "TESTNET" | "SIMULATED" | "DEMO";

export interface ApiResult<T> {
  data: T;
  source: DataSource;
  db: boolean;
  error?: string;
}

export interface StrategyView {
  id: number;
  name: string;
  description?: string | null;
  creator: string;
  market: string;
  strategyType: string;
  active: boolean;
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
  markPrice: number;
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

export interface EvaluateResult {
  strategyId: number;
  triggered: boolean;
  constraints: ConstraintCheckView;
  request: {
    strategyId: number;
    market: string;
    side: string;
    notionalUsd: number;
    leverageBps: number;
    slippageBps: number;
  } | null;
  feePreview: {
    feeUsd: number;
    pilotDiscountBps: number;
    discountedFeeUsd: number;
  };
  dataSource: DataSource;
}

export interface HealthResult {
  ok: boolean;
  service: string;
  chainId: number;
  db: boolean;
}

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8001").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 5000;

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
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Demo / simulated fallbacks                                          */
/* ------------------------------------------------------------------ */

const DEMO_STRATEGIES: StrategyView[] = [
  {
    id: 1,
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
    status: "EXECUTED",
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
    status: "EXECUTED",
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
  id?: number;
  chainStrategyId?: number | null;
  creator?: string | null;
  name?: string | null;
  description?: string | null;
  market?: string | null;
  strategyType?: string | null;
  active?: boolean | null;
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
  const id = typeof row.id === "number" ? row.id : Number(row.chainStrategyId ?? 0);
  return {
    id,
    name: row.name?.trim() || `Strategy #${id}`,
    description: row.description ?? null,
    creator: row.creator ?? "",
    market: (row.market ?? "—").toUpperCase(),
    strategyType: row.strategyType ?? "FUNDING_TRIGGER",
    active: row.active ?? true,
    pilotBacking: null,
    executions: null,
    expiry: null,
    maxLeverageBps: null,
    maxSlippageBps: null,
    maxNotionalUsd: null,
  };
}

function toMarketSource(source: string | null | undefined): DataSource {
  const value = (source ?? "").toLowerCase();
  if (value.includes("hyperliquid") || value.includes("hypercore")) return "LIVE";
  if (value === "elysium-oracle" || value === "oracle") return "LIVE";
  if (value === "simulated" || value === "mock") return "SIMULATED";
  return "TESTNET";
}

function toMarketView(row: ApiMarketRow): MarketView {
  const source = row.source ?? "unknown";
  return {
    market: (row.market ?? "—").toUpperCase(),
    markPrice: typeof row.markPrice === "number" ? row.markPrice : 0,
    fundingRateBps: typeof row.fundingRateBps === "number" ? row.fundingRateBps : 0,
    source,
    timestamp: typeof row.timestamp === "number" ? row.timestamp : Date.now(),
    dataSource: toMarketSource(source),
  };
}

function toExecutionView(row: ApiExecutionRow): ExecutionView {
  return {
    id: typeof row.id === "number" ? row.id : 0,
    strategyId: typeof row.strategyId === "number" ? row.strategyId : 0,
    status: row.status ?? "REJECTED",
    requestedNotional: typeof row.requestedNotional === "number" ? row.requestedNotional : null,
    txHash: row.txHash ?? null,
    externalExecutionId: row.externalExecutionId ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt ?? null,
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
      },
      source: "TESTNET",
      db: Boolean(json.db),
    };
  } catch (error) {
    return { data: null, source: "DEMO", db: false, error: errorMessage(error) };
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
        error: "API returned no markets",
      };
    }
    return { data: rows, source: "LIVE", db: Boolean(json.db) };
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
    if (rows.length === 0) {
      return {
        data: DEMO_STRATEGIES,
        source: "DEMO",
        db: Boolean(json.db),
        error: "API returned no strategies",
      };
    }
    return { data: rows.map(toStrategyView), source: "TESTNET", db: Boolean(json.db) };
  } catch (error) {
    return { data: DEMO_STRATEGIES, source: "DEMO", db: false, error: errorMessage(error) };
  }
}

export async function fetchStrategy(id: number): Promise<ApiResult<StrategyView | null>> {
  try {
    const json = await request<{ data: ApiStrategyRow | null; db: boolean }>(
      `/api/strategies/${id}`,
    );
    if (!json.data) throw new Error("strategy not found");
    return { data: toStrategyView(json.data), source: "TESTNET", db: Boolean(json.db) };
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
    if (rows.length === 0) {
      return {
        data: DEMO_EXECUTIONS.filter((e) => e.strategyId === id),
        source: "DEMO",
        db: Boolean(json.db),
        error: "API returned no executions",
      };
    }
    return { data: rows.map(toExecutionView), source: "TESTNET", db: Boolean(json.db) };
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
  params: EvaluateParams = {},
): Promise<ApiResult<EvaluateResult>> {
  const market = params.market ?? "HYPE";
  try {
    const json = await request<{
      strategyId: number;
      triggered: boolean;
      constraints: ConstraintCheckView;
      request: EvaluateResult["request"];
      feePreview: EvaluateResult["feePreview"];
      db: boolean;
    }>(`/api/executor/evaluate/${strategyId}`, {
      method: "POST",
      body: JSON.stringify(params),
    });
    return {
      data: {
        strategyId: json.strategyId,
        triggered: Boolean(json.triggered),
        constraints: json.constraints,
        request: json.request,
        feePreview: json.feePreview,
        dataSource: "TESTNET",
      },
      source: "TESTNET",
      db: Boolean(json.db),
    };
  } catch (error) {
    return {
      data: simulateEvaluation(strategyId, market, params),
      source: "SIMULATED",
      db: false,
      error: errorMessage(error),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Local simulation (used only when the API is unreachable)            */
/* ------------------------------------------------------------------ */

function simulateEvaluation(
  strategyId: number,
  market: string,
  params: EvaluateParams,
): EvaluateResult {
  const markPrice = params.markPrice ?? demoMarket(market).markPrice;
  const fundingRateBps = params.fundingRateBps ?? -1.82;
  const side = params.side ?? "long";
  const triggered = fundingRateBps < -1;

  const constraints: ConstraintCheckView = {
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

  return {
    strategyId,
    triggered,
    constraints,
    request: triggered
      ? {
          strategyId,
          market: market.toUpperCase(),
          side,
          notionalUsd: Math.min(markPrice > 0 ? markPrice : 100, 1000),
          leverageBps: 300,
          slippageBps: 50,
        }
      : null,
    feePreview: {
      feeUsd: 1.5,
      pilotDiscountBps: 1500,
      discountedFeeUsd: 1.5 * (1 - 1500 / 10_000),
    },
    dataSource: "SIMULATED",
  };
}
