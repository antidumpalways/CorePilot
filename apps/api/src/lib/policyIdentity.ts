import { ELYSIUM_TESTNET_CHAIN_ID, ELYSIUM_TESTNET_RPC, type StrategyPolicyV1 } from "@corepilot/shared";
import { strategyRegistryAbi, bytes32ToString } from "@corepilot/sdk";
import { createPublicClient, http, isAddress, type Address } from "viem";

export function configuredRegistry(): Address | null {
  const address = process.env.STRATEGY_REGISTRY_ADDRESS;
  return address && isAddress(address) ? address as Address : null;
}

/** Every authoritative policy read/write rechecks deployment, chain and live registry bounds. */
export async function verifyPolicyIdentity(policy: StrategyPolicyV1): Promise<string | null> {
  const registry = configuredRegistry();
  if (!registry) return "REGISTRY_UNCONFIGURED";
  if (policy.chainId !== ELYSIUM_TESTNET_CHAIN_ID || policy.registry.toLowerCase() !== registry.toLowerCase()) return "DEPLOYMENT_MISMATCH";
  const client = createPublicClient({ transport: http(process.env.ELYSIUM_RPC_URL ?? ELYSIUM_TESTNET_RPC) });
  try {
    if (await client.getChainId() !== policy.chainId) return "CHAIN_MISMATCH";
    if (!await client.getBytecode({ address: registry })) return "REGISTRY_NOT_DEPLOYED";
    const tuple = await client.readContract({ address: registry, abi: strategyRegistryAbi,
      functionName: "getStrategy", args: [BigInt(policy.strategyId)] });
    const [creator, market, strategyType, leverage, slippage, notional, expiry] = tuple;
    if (creator.toLowerCase() !== policy.creator.toLowerCase()) return "CREATOR_MISMATCH";
    if (bytes32ToString(market) !== policy.market || bytes32ToString(strategyType) !== "FUNDING_TRIGGER") return "STRATEGY_MISMATCH";
    if (BigInt(policy.bounds.maxLeverageBps) > leverage || BigInt(policy.bounds.maxSlippageBps) > slippage ||
        BigInt(policy.bounds.maxNotionalUsd) > notional || BigInt(policy.bounds.expiry) > expiry) return "BOUNDS_EXCEED_REGISTRY";
    return null;
  } catch {
    return "REGISTRY_READ_FAILED";
  }
}
