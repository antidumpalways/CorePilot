import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

export interface VenueIntent {
  intentId: string;
  trader: Address;
  agentAddress: Address;
  executionAccount: Address;
  isolationMode: "ISOLATED" | "COMPATIBILITY";
  market: string;
  side: "long" | "short";
  notionalUsd: number;
  leverageBps: number;
  slippageBps: number;
  expiresAtMs: number;
}

export interface PreparedOrder { asset: number; price: string; size: string; cloid: `0x${string}` }
export type VenueOrderState = "SUBMITTED" | "OPEN" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN";
export interface VenueOrderEvidence { state: VenueOrderState; orderId: string | null;
  cloid: `0x${string}`; filledSize: string | null; averagePrice: string | null; venueStatus: string }

const transport = new HttpTransport({ isTestnet: true, timeout: 8000 });
const info = new InfoClient({ transport });
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const trimZeros = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

export function cloidForIntent(intentId: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(intentId)) throw new Error("INVALID_INTENT_ID");
  return `0x${intentId.slice(2, 34).toLowerCase()}`;
}

export function prepareIocOrder(intent: VenueIntent, meta: { universe: { name: string; szDecimals: number }[] },
  book: { time: number; levels: [{ px: string }[], { px: string }[]] } | null,
  nowMs = Date.now()): PreparedOrder {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(intent.expiresAtMs) || intent.expiresAtMs <= nowMs ||
      !Number.isSafeInteger(intent.notionalUsd) || intent.notionalUsd < 10 || intent.notionalUsd > 25 ||
      !Number.isSafeInteger(intent.leverageBps) || intent.leverageBps < 100 || intent.leverageBps > 200 ||
      intent.leverageBps % 100 !== 0 || !Number.isSafeInteger(intent.slippageBps) ||
      intent.slippageBps < 0 || intent.slippageBps > 100 ||
      !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(intent.market)) throw new Error("INTENT_BOUNDS_INVALID");
  const asset = meta.universe.findIndex(item => item.name === intent.market);
  if (asset < 0 || !book || !Number.isSafeInteger(book.time) || nowMs - book.time < 0 ||
      nowMs - book.time > 10_000) throw new Error("TESTNET_BOOK_STALE_OR_MISSING");
  const decimals = meta.universe[asset].szDecimals;
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 6) throw new Error("VENUE_LOT_INVALID");
  const best = Number(intent.side === "long" ? book.levels[1][0]?.px : book.levels[0][0]?.px);
  if (!Number.isFinite(best) || best <= 0) throw new Error("TESTNET_BOOK_EMPTY");
  const rawLimit = best * (intent.side === "long" ? 1 + intent.slippageBps / 10000 : 1 - intent.slippageBps / 10000);
  const priceDecimals = Math.max(0, Math.min(6 - decimals, 4 - Math.floor(Math.log10(rawLimit))));
  const priceScale = 10 ** priceDecimals;
  const price = (intent.side === "long" ? Math.floor(rawLimit * priceScale + 1e-9) :
    Math.ceil(rawLimit * priceScale - 1e-9)) / priceScale;
  const sizeScale = 10 ** decimals;
  const size = Math.floor(intent.notionalUsd / Math.max(best, price) * sizeScale + 1e-9) / sizeScale;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 ||
      size * best < 10 || size * Math.max(best, price) > intent.notionalUsd + 1e-6) {
    throw new Error("VENUE_MIN_NOTIONAL_OR_SIZE_INVALID");
  }
  return { asset, price: trimZeros(price.toFixed(priceDecimals)),
    size: trimZeros(size.toFixed(decimals)), cloid: cloidForIntent(intent.intentId) };
}

export async function verifyTestnetAgent(intent: VenueIntent, derivedAgentAddress: Address): Promise<boolean> {
  if (!same(derivedAgentAddress, intent.agentAddress)) return false;
  const role = await info.userRole({ user: intent.agentAddress });
  if (role.role !== "agent" || !same(role.data.user, intent.trader)) return false;
  if (intent.isolationMode === "COMPATIBILITY") return same(intent.executionAccount, intent.trader);
  if (intent.isolationMode !== "ISOLATED" || same(intent.executionAccount, intent.trader)) return false;
  const account = await info.userRole({ user: intent.executionAccount });
  return account.role === "subAccount" && same(account.data.master, intent.trader);
}

/** A single testnet-only IOC order. Caller must persist SUBMITTING + cloid before invoking. */
export async function submitTestnetOrder(intent: VenueIntent, agentPrivateKey: `0x${string}`): Promise<VenueOrderEvidence> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(agentPrivateKey)) throw new Error("TESTNET_AGENT_KEY_MISSING");
  const wallet = privateKeyToAccount(agentPrivateKey);
  if (!await verifyTestnetAgent(intent, wallet.address)) throw new Error("VENUE_AGENT_ACCOUNT_UNVERIFIED");
  const [meta, book] = await Promise.all([info.metaAndAssetCtxs(), info.l2Book({ coin: intent.market })]);
  const prepared = prepareIocOrder(intent, meta[0], book);
  const exchange = new ExchangeClient({ transport, wallet, defaultExpiresAfter: () => Math.min(intent.expiresAtMs, Date.now() + 10_000) });
  const options = intent.isolationMode === "ISOLATED" ? { vaultAddress: intent.executionAccount } : undefined;
  // CorePilot's leverage bound is not a native agent permission. Set account leverage
  // explicitly before ordering; failure aborts the order.
  await exchange.updateLeverage({ asset: prepared.asset, isCross: false,
    leverage: intent.leverageBps / 100 }, options);
  if (Date.now() >= intent.expiresAtMs) throw new Error("INTENT_EXPIRED");
  const response = await exchange.order({ orders: [{ a: prepared.asset,
    b: intent.side === "long", p: prepared.price, s: prepared.size, r: false,
    t: { limit: { tif: "Ioc" } }, c: prepared.cloid }], grouping: "na" }, options);
  const first = response.response.data.statuses[0];
  if (typeof first === "object" && "filled" in first) return { state: "FILLED",
    orderId: String(first.filled.oid), cloid: prepared.cloid,
    filledSize: first.filled.totalSz, averagePrice: first.filled.avgPx, venueStatus: "filled" };
  if (typeof first === "object" && "resting" in first) return { state: "OPEN",
    orderId: String(first.resting.oid), cloid: prepared.cloid,
    filledSize: null, averagePrice: null, venueStatus: "open" };
  return { state: "UNKNOWN", orderId: null, cloid: prepared.cloid,
    filledSize: null, averagePrice: null, venueStatus: String(first ?? "missingStatus") };
}

export async function reconcileTestnetOrder(account: Address, cloid: `0x${string}`): Promise<VenueOrderEvidence> {
  const result = await info.orderStatus({ user: account, oid: cloid });
  if (result.status === "unknownOid") return { state: "UNKNOWN", orderId: null, cloid,
    filledSize: null, averagePrice: null, venueStatus: "unknownOid" };
  const status = result.order.status;
  const order = result.order.order;
  const filled = Math.max(0, Number(order.origSz) - Number(order.sz));
  const state: VenueOrderState = status === "filled" ? "FILLED" : status === "open" ? "OPEN" :
    status.includes("Canceled") || status === "canceled" ? "CANCELED" :
    status.includes("Rejected") || status === "rejected" ? "REJECTED" : "UNKNOWN";
  return { state, orderId: String(order.oid), cloid,
    filledSize: Number.isFinite(filled) && filled > 0 ? String(filled) : null,
    averagePrice: null, venueStatus: status };
}
