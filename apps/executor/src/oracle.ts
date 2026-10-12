import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { marketToBytes32, marketDataOracleAbi } from "@corepilot/sdk";
import type { MarketData } from "@corepilot/shared";

/**
 * Submit a signed market snapshot to the on-chain SignedMarketDataOracle.
 * The oracle verifies signer + freshness. The signer key must match the oracle's `signer`.
 */
export async function submitSnapshot(
  wallet: WalletClient,
  chainId: number,
  oracle: Address,
  data: MarketData,
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("submitSnapshot: wallet has no account");

  const market = marketToBytes32(data.market);
  const markPriceUSD = BigInt(Math.round(data.markPrice * 1e8));
  const fundingRateBps = BigInt(Math.round(data.fundingRateBps));
  const timestampMs = BigInt(data.timestamp);

  const digest = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
      ],
      [market, markPriceUSD, fundingRateBps, timestampMs, BigInt(chainId), oracle],
    ),
  );

  const signature = await wallet.signMessage({ account, message: { raw: digest } });

  return wallet.writeContract({
    address: oracle,
    abi: marketDataOracleAbi,
    functionName: "submit",
    args: [market, markPriceUSD, fundingRateBps, timestampMs, signature],
    chain: wallet.chain ?? null,
    account,
  });
}
