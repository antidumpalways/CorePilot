import {
  createPublicClient,
  http,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  executionControllerAbi,
  marketDataOracleAbi,
  pilotStakingAbi,
  pilotTokenAbi,
  strategyRegistryAbi,
} from "./abis.js";
import type { MarketData, StrategyConfig, StrategyType } from "@corepilot/shared";

export interface CorePilotAddresses {
  pilotToken?: Address;
  staking?: Address;
  registry?: Address;
  controller?: Address;
  feeModule?: Address;
  marketData?: Address;
  receipts?: Address;
}

export interface CorePilotClientConfig {
  rpcUrl: string;
  addresses: CorePilotAddresses;
}

/** "HYPE" -> bytes32 (left-aligned ASCII), matching `bytes32("HYPE")` in Solidity. */
export function marketToBytes32(market: string): Hex {
  return stringToHex(market, { size: 32 });
}

/** bytes32 -> trimmed ASCII market symbol. */
export function bytes32ToMarket(b: Hex): string {
  const hex = b.slice(2);
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function requireAddr(a: Address | undefined, name: string): Address {
  if (!a) throw new Error(`CorePilot: missing address for ${name}`);
  return a;
}

export function createCorePilotClient(config: CorePilotClientConfig) {
  const publicClient: PublicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const addresses = config.addresses;

  const read = {
    async getStrategy(id: number): Promise<StrategyConfig> {
      const s = (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "getStrategy",
        args: [BigInt(id)],
      })) as readonly [Address, Hex, Hex, bigint, bigint, bigint, bigint, boolean];
      return {
        id,
        creator: s[0],
        market: bytes32ToMarket(s[1]),
        strategyType: bytes32ToMarket(s[2]) as StrategyType,
        maxLeverageBps: Number(s[3]),
        maxSlippageBps: Number(s[4]),
        maxNotionalUsd: Number(s[5]),
        expiry: Number(s[6]),
        active: s[7],
      };
    },

    async nextStrategyId(): Promise<number> {
      const n = (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "nextStrategyId",
      })) as bigint;
      return Number(n);
    },

    async isExecutable(id: number): Promise<boolean> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "isExecutable",
        args: [BigInt(id)],
      })) as boolean;
    },

    async getCreatorBond(id: number): Promise<bigint> {
      const [amount] = (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "creatorBonds",
        args: [BigInt(id)],
      })) as readonly [bigint, bigint];
      return amount;
    },

    async getExecutorBond(executor: Address): Promise<bigint> {
      const [amount] = (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "executorBonds",
        args: [executor],
      })) as readonly [bigint, bigint];
      return amount;
    },

    async getMarketData(market: string): Promise<MarketData> {
      const [markPriceUSD, fundingRateBps, timestampMs] = (await publicClient.readContract({
        address: requireAddr(addresses.marketData, "marketData"),
        abi: marketDataOracleAbi,
        functionName: "getMarketData",
        args: [marketToBytes32(market)],
      })) as readonly [bigint, bigint, bigint];
      return {
        market,
        markPrice: Number(markPriceUSD) / 1e8,
        fundingRateBps: Number(fundingRateBps),
        timestamp: Number(timestampMs),
        source: "elysium-oracle",
      };
    },

    async pilotBalance(account: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "balanceOf",
        args: [account],
      })) as bigint;
    },

    async pilotAllowance(owner: Address, spender: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint;
    },

    async listStrategies(): Promise<StrategyConfig[]> {
      const next = await read.nextStrategyId();
      const out: StrategyConfig[] = [];
      for (let id = 1; id < next; id++) {
        try {
          out.push(await read.getStrategy(id));
        } catch {
          // skip unknown
        }
      }
      return out;
    },
  };

  const write = {
    async faucetPilot(wallet: WalletClient): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "faucet",
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },

    async approvePilot(wallet: WalletClient, spender: Address, amount: bigint): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "approve",
        args: [spender, amount],
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },

    async createStrategy(
      wallet: WalletClient,
      params: {
        market: string;
        strategyType: string;
        maxLeverageBps: number;
        maxSlippageBps: number;
        maxNotionalUsd: number;
        expiry: number;
      },
    ): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "createStrategy",
        args: [
          marketToBytes32(params.market),
          marketToBytes32(params.strategyType),
          BigInt(params.maxLeverageBps),
          BigInt(params.maxSlippageBps),
          BigInt(params.maxNotionalUsd),
          BigInt(params.expiry),
        ],
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },

    async stakeCreator(wallet: WalletClient, strategyId: number, amount: bigint): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "stakeCreator",
        args: [BigInt(strategyId), amount],
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },

    async setActive(wallet: WalletClient, strategyId: number, active: boolean): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "setActive",
        args: [BigInt(strategyId), active],
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },

    async stakeExecutor(wallet: WalletClient, amount: bigint): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "stakeExecutor",
        args: [amount],
        chain: wallet.chain ?? null,
        account: wallet.account!,
      });
    },
  };

  return { publicClient, addresses, read, write, marketToBytes32, bytes32ToMarket };
}

export type CorePilotClient = ReturnType<typeof createCorePilotClient>;

// Re-export for convenience.
export { executionControllerAbi, marketDataOracleAbi, pilotStakingAbi, pilotTokenAbi, strategyRegistryAbi };
