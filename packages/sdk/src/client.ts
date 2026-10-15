import {
  createPublicClient,
  decodeErrorResult,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type {
  ExecutionConstraints,
  ExecutionIntent,
  MarketData,
  StrategyConfig,
  StrategyType,
} from "@corepilot/shared";
import {
  executionControllerAbi,
  executionReceiptRegistryAbi,
  feeModuleAbi,
  marketDataOracleAbi,
  pilotStakingAbi,
  pilotTokenAbi,
  strategyRegistryAbi,
} from "./abis.js";
import {
  bytes32ToString,
  markPriceFromContract,
  notionalUsdFromContract,
  notionalUsdToContract,
  stringToBytes32,
  unixSecondsToMilliseconds,
} from "./units.js";
import { executionIntentToControllerRequest, observeOnchainReceipt, type OnchainReceiptObservation } from "./execution.js";
import { boundedGasLimit, freshElysiumFees } from "./fees.js";

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

/** Raw registry state, preserving Solidity uint256 values as bigint and bytes32 values as Hex. */
export interface RawStrategy {
  creator: Address;
  market: Hex;
  strategyType: Hex;
  maxLeverageBps: bigint;
  maxSlippageBps: bigint;
  maxNotionalUsd: bigint;
  expiry: bigint;
  active: boolean;
}

/** Generic domain mapping of registry state. Strategy policy remains off-chain and separate. */
export interface StrategyRecord extends Omit<StrategyConfig, "strategyType" | "trigger"> {
  strategyType: string;
}

/** Receipt fields stored on-chain. `timestamp` is Unix seconds, as written by block.timestamp. */
export interface OnchainExecutionReceipt {
  strategyId: number;
  executionId: Hex;
  notionalUsd: number;
  accepted: boolean;
  /** Adapter dispatch or executor-reported rejection; neither proves a venue fill. */
  status: "NONE" | "ADAPTER_REQUESTED" | "EXECUTOR_REJECTION_REPORTED";
  reason: Hex;
  timestamp: number;
  timestampMs: number;
  executor: Address;
}

export interface CorePilotExecutionRequest {
  strategyId: number;
  market: string;
  side: "long" | "short";
  notionalUsd: number;
  leverageBps: number;
  slippageBps: number;
}

/**
 * Create an SDK client for read access and the contract writes supported by the local ABI.
 * Values mapped from uint256 to the shared domain model are range checked for JS precision.
 */
export function createCorePilotClient(config: CorePilotClientConfig) {
  const publicClient: PublicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const addresses = config.addresses;

  const read = {
    async getStrategyRaw(id: number): Promise<RawStrategy> {
      const tuple = (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "getStrategy",
        args: [toUint(id, "strategy id")],
      })) as readonly [Address, Hex, Hex, bigint, bigint, bigint, bigint, boolean];
      return {
        creator: tuple[0],
        market: tuple[1],
        strategyType: tuple[2],
        maxLeverageBps: tuple[3],
        maxSlippageBps: tuple[4],
        maxNotionalUsd: tuple[5],
        expiry: tuple[6],
        active: tuple[7],
      };
    },

    async getStrategyRecord(id: number): Promise<StrategyRecord> {
      const raw = await read.getStrategyRaw(id);
      return {
        id: safeNumber(toUint(id, "strategy id"), "strategy id"),
        creator: raw.creator,
        market: bytes32ToString(raw.market),
        strategyType: bytes32ToString(raw.strategyType),
        maxLeverageBps: safeNumber(raw.maxLeverageBps, "max leverage bps"),
        maxSlippageBps: safeNumber(raw.maxSlippageBps, "max slippage bps"),
        maxNotionalUsd: notionalUsdFromContract(raw.maxNotionalUsd),
        expiry: safeNumber(raw.expiry, "expiry seconds"),
        active: raw.active,
      };
    },

    /** Backward-compatible funding-strategy mapping; unsupported types fail closed. */
    async getStrategy(id: number): Promise<StrategyConfig> {
      const record = await read.getStrategyRecord(id);
      if (record.strategyType !== "FUNDING_TRIGGER") {
        throw new Error(`unsupported strategy type ${record.strategyType}; use getStrategyRecord for read-only display`);
      }
      return { ...record, strategyType: record.strategyType as StrategyType };
    },

    async nextStrategyId(): Promise<number> {
      const value = (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "nextStrategyId",
      })) as bigint;
      return safeNumber(value, "next strategy id");
    },

    /** Registry hard-bound readiness for supported funding strategies only; not a policy verdict. */
    async isExecutable(id: number): Promise<boolean> {
      const [record, registryReady] = await Promise.all([read.getStrategyRecord(id), publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "isExecutable",
        args: [toUint(id, "strategy id")],
      }) as Promise<boolean>]);
      return record.strategyType === "FUNDING_TRIGGER" && registryReady;
    },

    async creatorOf(id: number): Promise<Address> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.registry, "registry"),
        abi: strategyRegistryAbi,
        functionName: "creatorOf",
        args: [toUint(id, "strategy id")],
      })) as Address;
    },

    async isCreatorBonded(id: number): Promise<boolean> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "isCreatorBonded",
        args: [toUint(id, "strategy id")],
      })) as boolean;
    },

    async isExecutorBonded(executor: Address): Promise<boolean> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "isExecutorBonded",
        args: [executor],
      })) as boolean;
    },

    async getExecutionConstraints(id: number): Promise<ExecutionConstraints> {
      const [strategy, maxMarketDataAgeMs] = await Promise.all([
        read.getStrategy(id),
        publicClient.readContract({
          address: requireAddr(addresses.controller, "controller"),
          abi: executionControllerAbi,
          functionName: "maxMarketDataAgeMs",
        }) as Promise<bigint>,
      ]);
      return {
        strategyId: strategy.id,
        market: strategy.market,
        maxNotionalUsd: strategy.maxNotionalUsd,
        maxLeverageBps: strategy.maxLeverageBps,
        maxSlippageBps: strategy.maxSlippageBps,
        expiry: strategy.expiry,
        maxMarketDataAgeMs: safeNumber(maxMarketDataAgeMs, "max market data age ms"),
        active: strategy.active,
      };
    },

    async getCreatorBondState(id: number): Promise<{ amount: bigint; unlockAt: number }> {
      const [amount, unlockAt] = (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "creatorBonds",
        args: [toUint(id, "strategy id")],
      })) as readonly [bigint, bigint];
      return { amount, unlockAt: safeNumber(unlockAt, "bond unlock timestamp seconds") };
    },

    async getCreatorBond(id: number): Promise<bigint> {
      return (await read.getCreatorBondState(id)).amount;
    },

    async getExecutorBondState(executor: Address): Promise<{ amount: bigint; unlockAt: number }> {
      const [amount, unlockAt] = (await publicClient.readContract({
        address: requireAddr(addresses.staking, "staking"),
        abi: pilotStakingAbi,
        functionName: "executorBonds",
        args: [executor],
      })) as readonly [bigint, bigint];
      return { amount, unlockAt: safeNumber(unlockAt, "bond unlock timestamp seconds") };
    },

    async getExecutorBond(executor: Address): Promise<bigint> {
      return (await read.getExecutorBondState(executor)).amount;
    },

    async getMarketData(market: string): Promise<MarketData> {
      const [markPriceUSD, fundingRateBps, timestampMs] = (await publicClient.readContract({
        address: requireAddr(addresses.marketData, "marketData"),
        abi: marketDataOracleAbi,
        functionName: "getMarketData",
        args: [stringToBytes32(market)],
      })) as readonly [bigint, bigint, bigint];
      return {
        market,
        markPrice: markPriceFromContract(markPriceUSD),
        fundingRateBps: safeNumber(fundingRateBps, "funding rate bps"),
        timestamp: safeNumber(timestampMs, "oracle timestamp milliseconds"),
        source: "onchain-oracle",
      };
    },

    async getRawExecutionReceipt(id: number): Promise<readonly [bigint, Hex, bigint, boolean, Hex, bigint, Address]> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.receipts, "receipts"),
        abi: executionReceiptRegistryAbi,
        functionName: "receipts",
        args: [toUint(id, "receipt id")],
      })) as readonly [bigint, Hex, bigint, boolean, Hex, bigint, Address];
    },

    async getExecutionReceipt(id: number): Promise<OnchainExecutionReceipt> {
      const [[strategyId, executionId, notionalUsd, accepted, reason, timestamp, executor], statusValue] = await Promise.all([
        read.getRawExecutionReceipt(id),
        publicClient.readContract({
          address: requireAddr(addresses.receipts, "receipts"),
          abi: executionReceiptRegistryAbi,
          functionName: "receiptStatus",
          args: [toUint(id, "receipt id")],
        }) as Promise<number>,
      ]);
      const timestampSeconds = safeNumber(timestamp, "receipt timestamp seconds");
      return {
        strategyId: safeNumber(strategyId, "strategy id"),
        executionId,
        notionalUsd: notionalUsdFromContract(notionalUsd),
        accepted,
        status: receiptStatusName(statusValue),
        reason,
        timestamp: timestampSeconds,
        timestampMs: unixSecondsToMilliseconds(timestampSeconds),
        executor,
      };
    },

    /** Interpret recorded receipt without treating adapter dispatch as a venue fill. */
    async getExecutionObservation(id: number): Promise<OnchainReceiptObservation> {
      return observeOnchainReceipt(id, await read.getExecutionReceipt(id));
    },

    async getExecutionReceiptStatus(id: number): Promise<OnchainExecutionReceipt["status"]> {
      const statusValue = (await publicClient.readContract({
        address: requireAddr(addresses.receipts, "receipts"),
        abi: executionReceiptRegistryAbi,
        functionName: "receiptStatus",
        args: [toUint(id, "receipt id")],
      })) as number;
      return receiptStatusName(statusValue);
    },

    async nextReceiptId(): Promise<number> {
      const value = (await publicClient.readContract({
        address: requireAddr(addresses.receipts, "receipts"),
        abi: executionReceiptRegistryAbi,
        functionName: "nextReceiptId",
      })) as bigint;
      return safeNumber(value, "next receipt id");
    },

    async listExecutionReceipts(options: { fromId?: number; toIdExclusive?: number } = {}): Promise<OnchainExecutionReceipt[]> {
      const next = options.toIdExclusive ?? await read.nextReceiptId();
      const from = options.fromId ?? 1;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(next) || from < 1 || next < from) {
        throw new RangeError("receipt id range must be safe integers with 1 <= fromId <= toIdExclusive");
      }
      const receipts: OnchainExecutionReceipt[] = [];
      for (let id = from; id < next; id++) receipts.push(await read.getExecutionReceipt(id));
      return receipts;
    },

    async pilotBalance(account: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "balanceOf",
        args: [account],
      })) as bigint;
    },

    async hasClaimedPilotFaucet(account: Address): Promise<boolean> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"), abi: pilotTokenAbi,
        functionName: "faucetUsed", args: [account],
      })) as boolean;
    },

    async pilotAllowance(owner: Address, spender: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: requireAddr(addresses.pilotToken, "pilotToken"),
        abi: pilotTokenAbi,
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint;
    },

    async listStrategies(options: { fromId?: number; toIdExclusive?: number } = {}): Promise<StrategyConfig[]> {
      const next = options.toIdExclusive ?? await read.nextStrategyId();
      const from = options.fromId ?? 1;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(next) || from < 1 || next < from) {
        throw new RangeError("strategy id range must be safe integers with 1 <= fromId <= toIdExclusive");
      }
      const strategies: StrategyConfig[] = [];
      for (let id = from; id < next; id++) strategies.push(await read.getStrategy(id));
      return strategies;
    },

    async listStrategyRecords(options: { fromId?: number; toIdExclusive?: number } = {}): Promise<StrategyRecord[]> {
      const next = options.toIdExclusive ?? await read.nextStrategyId();
      const from = options.fromId ?? 1;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(next) || from < 1 || next < from) {
        throw new RangeError("strategy id range must be safe integers with 1 <= fromId <= toIdExclusive");
      }
      const strategies: StrategyRecord[] = [];
      for (let id = from; id < next; id++) strategies.push(await read.getStrategyRecord(id));
      return strategies;
    },
  };

  const write = {
    async faucetPilot(wallet: WalletClient): Promise<Hex> {
      const account = walletAccount(wallet);
      const address = requireAddr(addresses.pilotToken, "pilotToken");
      if (await read.hasClaimedPilotFaucet(account.address)) throw new Error("PILOT_FAUCET_ALREADY_CLAIMED");
      const estimate = await publicClient.estimateContractGas({
        address, abi: pilotTokenAbi, functionName: "faucet", account,
      });
      const gas = boundedGasLimit(estimate, 250_000n);
      const fees = await freshElysiumFees(publicClient);
      return wallet.writeContract({
        address, abi: pilotTokenAbi,
        functionName: "faucet", chain: wallet.chain ?? null, account, gas, ...fees,
      });
    },

    async approvePilot(wallet: WalletClient, spender: Address, amount: bigint): Promise<Hex> {
      const account = walletAccount(wallet);
      const address = requireAddr(addresses.pilotToken, "pilotToken");
      const args = [spender, amount] as const;
      const estimate = await publicClient.estimateContractGas({
        address, abi: pilotTokenAbi, functionName: "approve", args, account,
      });
      const gas = boundedGasLimit(estimate, 200_000n);
      const fees = await freshElysiumFees(publicClient);
      return wallet.writeContract({
        address, abi: pilotTokenAbi,
        functionName: "approve", args, chain: wallet.chain ?? null, account, gas, ...fees,
      });
    },

    async createStrategy(wallet: WalletClient, params: {
      market: string;
      strategyType: string;
      maxLeverageBps: number;
      maxSlippageBps: number;
      maxNotionalUsd: number;
      expiry: number;
    }): Promise<Hex> {
      const account = walletAccount(wallet);
      const address = requireAddr(addresses.registry, "registry");
      const args = [
        stringToBytes32(params.market), stringToBytes32(params.strategyType),
        toUint(params.maxLeverageBps, "max leverage bps"), toUint(params.maxSlippageBps, "max slippage bps"),
        notionalUsdToContract(params.maxNotionalUsd), toUint(params.expiry, "expiry seconds"),
      ] as const;
      const estimate = await publicClient.estimateContractGas({
        address, abi: strategyRegistryAbi, functionName: "createStrategy", args, account,
      });
      const gas = boundedGasLimit(estimate, 600_000n);
      const fees = await freshElysiumFees(publicClient);
      return wallet.writeContract({
        address, abi: strategyRegistryAbi,
        functionName: "createStrategy",
        args,
        chain: wallet.chain ?? null, account, gas, ...fees,
      });
    },

    async updateStrategy(wallet: WalletClient, id: number, params: {
      maxLeverageBps: number; maxSlippageBps: number; maxNotionalUsd: number; expiry: number;
    }): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.registry, "registry"), abi: strategyRegistryAbi,
        functionName: "updateStrategy",
        args: [toUint(id, "strategy id"), toUint(params.maxLeverageBps, "max leverage bps"),
          toUint(params.maxSlippageBps, "max slippage bps"), notionalUsdToContract(params.maxNotionalUsd),
          toUint(params.expiry, "expiry seconds")],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async setStrategyActive(wallet: WalletClient, id: number, active: boolean): Promise<Hex> {
      const account = walletAccount(wallet);
      const address = requireAddr(addresses.registry, "registry");
      const args = [toUint(id, "strategy id"), active] as const;
      const estimate = await publicClient.estimateContractGas({
        address, abi: strategyRegistryAbi, functionName: "setActive", args, account,
      });
      const gas = boundedGasLimit(estimate, 250_000n);
      const fees = await freshElysiumFees(publicClient);
      return wallet.writeContract({
        address, abi: strategyRegistryAbi,
        functionName: "setActive", args,
        chain: wallet.chain ?? null, account, gas, ...fees,
      });
    },

    /** @deprecated Use setStrategyActive. */
    async setActive(wallet: WalletClient, id: number, active: boolean): Promise<Hex> {
      return write.setStrategyActive(wallet, id, active);
    },

    /** Dispatch a caller-approved intent. The SDK cannot verify off-chain policy or venue fill. */
    async execute(wallet: WalletClient, intent: ExecutionIntent): Promise<Hex> {
      const request = executionIntentToControllerRequest(intent);
      const strategy = await read.getStrategyRecord(intent.strategyId);
      if (strategy.strategyType !== "FUNDING_TRIGGER") {
        throw new Error(`unsupported strategy type ${strategy.strategyType}; dispatch blocked`);
      }
      return wallet.writeContract({
        address: requireAddr(addresses.controller, "controller"), abi: executionControllerAbi,
        functionName: "execute", args: [request],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    /** @deprecated Low-level form bypasses SDK strategy-type guard; caller must verify funding policy and type. */
    async executeRaw(wallet: WalletClient, request: CorePilotExecutionRequest): Promise<Hex> {
      if (request.side !== "long" && request.side !== "short") throw new TypeError("unsupported position side");
      return wallet.writeContract({
        address: requireAddr(addresses.controller, "controller"), abi: executionControllerAbi,
        functionName: "execute",
        args: [{
          strategyId: toUint(request.strategyId, "strategy id"), market: stringToBytes32(request.market),
          isLong: request.side === "long", notionalUsd: notionalUsdToContract(request.notionalUsd),
          leverageBps: toUint(request.leverageBps, "leverage bps"),
          slippageBps: toUint(request.slippageBps, "slippage bps"),
        }],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async recordRejection(wallet: WalletClient, strategyId: number, reason: Hex): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.controller, "controller"), abi: executionControllerAbi,
        functionName: "recordRejection", args: [toUint(strategyId, "strategy id"), requireBytes32(reason, "reason")],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async stakeCreator(wallet: WalletClient, strategyId: number, amount: bigint): Promise<Hex> {
      const account = walletAccount(wallet);
      const address = requireAddr(addresses.staking, "staking");
      const args = [toUint(strategyId, "strategy id"), requireUint(amount, "amount")] as const;
      const estimate = await publicClient.estimateContractGas({
        address, abi: pilotStakingAbi, functionName: "stakeCreator", args, account,
      });
      const gas = boundedGasLimit(estimate, 350_000n);
      const fees = await freshElysiumFees(publicClient);
      return wallet.writeContract({
        address, abi: pilotStakingAbi,
        functionName: "stakeCreator", args,
        chain: wallet.chain ?? null, account, gas, ...fees,
      });
    },

    async requestUnstakeCreator(wallet: WalletClient, strategyId: number): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "requestUnstakeCreator", args: [toUint(strategyId, "strategy id")],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async unstakeCreator(wallet: WalletClient, strategyId: number): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "unstakeCreator", args: [toUint(strategyId, "strategy id")],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async stakeExecutor(wallet: WalletClient, amount: bigint): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "stakeExecutor", args: [requireUint(amount, "amount")],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async requestUnstakeExecutor(wallet: WalletClient): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "requestUnstakeExecutor", chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async unstakeExecutor(wallet: WalletClient): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "unstakeExecutor", chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },

    async setStrategyRegistry(wallet: WalletClient, registry: Address): Promise<Hex> {
      return wallet.writeContract({
        address: requireAddr(addresses.staking, "staking"), abi: pilotStakingAbi,
        functionName: "setStrategyRegistry", args: [registry],
        chain: wallet.chain ?? null, account: walletAccount(wallet),
      });
    },
  };

  return { publicClient, addresses, read, write, marketToBytes32, bytes32ToMarket };
}

export type CorePilotClient = ReturnType<typeof createCorePilotClient>;

/** Backward-compatible market helper names. */
export const marketToBytes32 = stringToBytes32;
export const bytes32ToMarket = bytes32ToString;

/** Decode known custom errors while retaining the complete original error for diagnostics. */
export function explainContractError(error: unknown): { message: string; errorName?: string; rawError: unknown } {
  const data = findRevertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: CONTRACT_ERROR_ABI, data });
      const friendly = CONTRACT_ERROR_MESSAGES[decoded.errorName];
      const args = decoded.args?.length ? ` (${decoded.args.map(String).join(", ")})` : "";
      return { message: `${friendly ?? decoded.errorName}${args}`, errorName: decoded.errorName, rawError: error };
    } catch {
      // Keep unknown/custom errors inspectable below.
    }
  }
  return { message: error instanceof Error ? error.message : String(error), rawError: error };
}

function requireAddr(address: Address | undefined, name: string): Address {
  if (!address) throw new Error(`CorePilot: missing address for ${name}`);
  return address;
}

function walletAccount(wallet: WalletClient) {
  if (!wallet.account) throw new Error("CorePilot: wallet client has no account");
  return wallet.account;
}

function toUint(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return BigInt(value);
}

function requireUint(value: bigint, label: string): bigint {
  if (value < 0n) throw new RangeError(`${label} must be non-negative`);
  return value;
}

function safeNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} exceeds JavaScript safe integer precision`);
  return number;
}

function requireBytes32(value: Hex, label: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${label} must be exactly 32 bytes`);
  return value;
}

function receiptStatusName(value: number): OnchainExecutionReceipt["status"] {
  switch (value) {
    case 0: return "NONE";
    case 1: return "ADAPTER_REQUESTED";
    case 2: return "EXECUTOR_REJECTION_REPORTED";
    default: throw new RangeError(`unknown on-chain receipt status ${value}`);
  }
}

function findRevertData(value: unknown, seen = new Set<unknown>()): Hex | undefined {
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details"]) {
    const child = record[key];
    if (typeof child === "string" && /^0x[0-9a-fA-F]{8,}$/.test(child)) return child as Hex;
    const found = findRevertData(child, seen);
    if (found) return found;
  }
  return undefined;
}

const CONTRACT_ERROR_ABI = [
  ...strategyRegistryAbi, ...executionControllerAbi, ...executionReceiptRegistryAbi,
  ...pilotStakingAbi, ...marketDataOracleAbi, ...feeModuleAbi,
] as Abi;

const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  NotOwner: "Only the contract owner can perform this operation",
  NotExecutor: "The connected account is not the configured executor",
  ExecutorNotBonded: "The executor does not meet the minimum bond",
  CreatorNotBonded: "The strategy creator does not meet the minimum bond",
  StrategyInactive: "The strategy is inactive",
  StrategyExpired: "The strategy has expired",
  MarketNotAllowed: "The execution market does not match the strategy market",
  NotionalExceeded: "Requested notional exceeds the strategy limit",
  LeverageExceeded: "Requested leverage exceeds the strategy limit",
  SlippageExceeded: "Requested slippage exceeds the strategy limit",
  InvalidMarketData: "The market snapshot is missing or stale",
  NotCreator: "Only the strategy creator can perform this operation",
  UnknownStrategy: "The strategy does not exist",
  InvalidParams: "One or more strategy parameters are invalid",
  InvalidExecutionRequest: "The execution request has invalid values",
  InvalidAdapterRequestId: "The execution adapter returned an empty request identifier",
  NoBond: "No bond is available for this account or strategy",
  NotStrategyCreator: "Only the strategy creator can manage this creator bond",
  StrategyRegistryAlreadySet: "The staking contract is already bound to a strategy registry",
  StrategyRegistryNotSet: "The staking contract has no strategy registry configured",
  InvalidRegistry: "The strategy registry address is not a deployed contract",
  CooldownActive: "The staking withdrawal cooldown has not elapsed",
  BondBelowMinimum: "The bond is below the required minimum",
  NotController: "Only the configured execution controller can record a receipt",
  BadSignature: "The market-data signature is invalid",
  UnknownSigner: "No market-data signer is configured",
  BadSplit: "The fee split must add up to 10,000 bps",
  NotSupportedAsset: "The fee asset is not supported",
};
