import type { FeeSplitBps } from "./types.js";

export const ELYSIUM_TESTNET_CHAIN_ID = 99801;
export const ELYSIUM_TESTNET_RPC = "https://testnet-rpc.elysium.kinetiq.xyz";

export const HYPERLIQUID_TESTNET_API_URL = "https://api.hyperliquid-testnet.xyz";
export const HYPERLIQUID_MAINNET_API_URL = "https://api.hyperliquid.xyz";

/** Default protocol fee configuration (all values illustrative, configurable). */
export const DEFAULT_EXECUTION_FEE_USD = 1.5;

/** Split of the protocol fee. Must sum to 10000 bps. */
export const DEFAULT_FEE_SPLIT: FeeSplitBps = {
  creatorBps: 5000,
  executorBps: 2000,
  treasuryBps: 1000,
  buybackBps: 2000,
};

/** Discount applied when the fee is paid in PILOT instead of USDC. */
export const PILOT_DISCOUNT_BPS = 1500; // 15%

export const BPS_DENOMINATOR = 10_000;

export const DEFAULT_MARKETS = ["HYPE", "BTC", "ETH"] as const;
