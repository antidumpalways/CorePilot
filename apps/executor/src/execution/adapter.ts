import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { marketToBytes32 } from "@corepilot/sdk";
import type { ExecutionRequest } from "@corepilot/shared";

export interface ExecutionResult {
  executionId: Hex;
  mode: "mock" | "testnet" | "onchain";
}

/**
 * Deterministic mock execution. Records the intent and returns an id — used when live
 * execution is disabled or no real venue action is desired (safe demo).
 */
export function mockExecute(req: ExecutionRequest): ExecutionResult {
  const executionId = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bool" }, { type: "uint256" }],
      [
        BigInt(req.strategyId),
        marketToBytes32(req.market),
        req.side === "long",
        BigInt(req.notionalUsd),
      ],
    ),
  );
  return { executionId, mode: "mock" };
}
