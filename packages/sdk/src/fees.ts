import type { PublicClient } from "viem";

const MAX_TESTNET_FEE_WEI = 2_000_000_000n; // 2 gwei safety ceiling.

/** Reject implausible RPC/wallet gas limits before asking for a signature. */
export function boundedGasLimit(estimate: bigint, cap: bigint): bigint {
  if (estimate <= 0n || cap <= 0n) throw new Error("ELYSIUM_GAS_ESTIMATE_INVALID");
  const limit = estimate * 125n / 100n + 10_000n;
  if (limit > cap) throw new Error("ELYSIUM_GAS_ESTIMATE_ABOVE_SAFETY_LIMIT");
  return limit;
}

/** Use a fresh base fee and leave headroom for Elysium's next block. */
export function bufferedEip1559Fees(baseFeePerGas: bigint | null,
  maxPriorityFeePerGas: bigint): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  if (baseFeePerGas === null || baseFeePerGas < 0n || maxPriorityFeePerGas < 0n) {
    throw new Error("ELYSiUM_FEE_UNAVAILABLE");
  }
  const maxFeePerGas = baseFeePerGas * 3n + maxPriorityFeePerGas;
  if (maxFeePerGas > MAX_TESTNET_FEE_WEI) throw new Error("ELYSiUM_FEE_ABOVE_SAFETY_LIMIT");
  return { maxFeePerGas, maxPriorityFeePerGas };
}

export async function freshElysiumFees(client: PublicClient) {
  let block: Awaited<ReturnType<PublicClient["getBlock"]>>;
  for (let attempt = 0; ; attempt++) {
    try { block = await client.getBlock({ blockTag: "latest" }); break; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/rate limit exceeded|too many requests|\b429\b/i.test(message) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  // One RPC read per wallet write. Elysium's public node rate-limits bursts;
  // a modest priority fee plus 3x base-fee headroom handles minor block changes.
  return bufferedEip1559Fees(block.baseFeePerGas, 1_000_000n);
}
