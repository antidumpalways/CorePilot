import "dotenv/config";
import type { Address } from "viem";

export interface ExecutorConfig {
  rpcUrl: string;
  chainId: number;
  hyperliquidApiUrl: string;
  pollMs: number;
  enableLiveExecution: boolean;
  executorPrivateKey?: `0x${string}`;
  oracleSignerPrivateKey?: `0x${string}`;
  addresses: {
    pilotToken?: Address;
    staking?: Address;
    registry?: Address;
    controller?: Address;
    feeModule?: Address;
    marketData?: Address;
    receipts?: Address;
  };
}

function opt(v: string | undefined): Address | undefined {
  return v && v.startsWith("0x") ? (v as Address) : undefined;
}

export const config: ExecutorConfig = {
  rpcUrl: process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz",
  chainId: Number(process.env.ELYSIUM_CHAIN_ID ?? 99801),
  hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid-testnet.xyz",
  pollMs: Number(process.env.EXECUTOR_POLL_MS ?? 15000),
  enableLiveExecution: process.env.EXECUTOR_ENABLE_LIVE_EXECUTION === "true",
  executorPrivateKey: (process.env.EXECUTOR_PRIVATE_KEY as `0x${string}`) || undefined,
  oracleSignerPrivateKey:
    (process.env.ORACLE_SIGNER_PRIVATE_KEY as `0x${string}`) || undefined,
  addresses: {
    pilotToken: opt(process.env.PILOT_TOKEN_ADDRESS),
    staking: opt(process.env.STAKING_ADDRESS),
    registry: opt(process.env.STRATEGY_REGISTRY_ADDRESS),
    controller: opt(process.env.EXECUTION_CONTROLLER_ADDRESS),
    feeModule: opt(process.env.FEE_MODULE_ADDRESS),
    marketData: opt(process.env.MARKET_DATA_ORACLE_ADDRESS),
    receipts: opt(process.env.RECEIPT_REGISTRY_ADDRESS),
  },
};

export const hasChainConfig = Boolean(config.addresses.registry && config.addresses.controller);
