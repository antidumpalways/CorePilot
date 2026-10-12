import type { Address } from "viem";
import {
  createCorePilotClient,
  type CorePilotClient,
  type CorePilotAddresses,
  marketToBytes32,
  bytes32ToMarket,
} from "@corepilot/sdk";

const env = import.meta.env;

export const ELYSIUM_RPC_URL =
  env.VITE_ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";

function normalizeAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return undefined;
  return trimmed as Address;
}

export const corePilotAddresses: CorePilotAddresses = {
  pilotToken: normalizeAddress(env.VITE_PILOT_TOKEN_ADDRESS),
  staking: normalizeAddress(env.VITE_STAKING_ADDRESS),
  registry: normalizeAddress(env.VITE_STRATEGY_REGISTRY_ADDRESS),
  controller: normalizeAddress(env.VITE_EXECUTION_CONTROLLER_ADDRESS),
  marketData: normalizeAddress(env.VITE_MARKET_DATA_ORACLE_ADDRESS),
  feeModule: normalizeAddress(env.VITE_FEE_MODULE_ADDRESS),
  receipts: normalizeAddress(env.VITE_RECEIPT_REGISTRY_ADDRESS),
};

/** True when at least the core contracts are configured for a live SDK session. */
export const hasContractConfig = Boolean(
  corePilotAddresses.registry &&
    corePilotAddresses.pilotToken &&
    corePilotAddresses.staking,
);

let cached: CorePilotClient | null = null;

/** Lazily create (and cache) a CorePilot SDK client bound to the configured RPC + addresses. */
export function getCorePilotClient(): CorePilotClient {
  if (cached) return cached;
  cached = createCorePilotClient({
    rpcUrl: ELYSIUM_RPC_URL,
    addresses: corePilotAddresses,
  });
  return cached;
}

export { marketToBytes32, bytes32ToMarket };
export type { CorePilotClient, CorePilotAddresses };
