import { encodeAbiParameters, keccak256 } from "viem";
import { marketToBytes32 } from "@corepilot/sdk";
import type { ExecutionAdapterResult, ExecutionIntent } from "@corepilot/shared";

/**
 * Deterministic mock execution. Records the intent and returns an id — used when live
 * execution is disabled or no real venue action is desired (safe demo).
 */
export function mockExecute(intent: ExecutionIntent): ExecutionAdapterResult {
  const executionId = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bool" }, { type: "uint256" }],
      [
        BigInt(intent.strategyId),
        marketToBytes32(intent.market),
        intent.action.side === "long",
        BigInt(intent.notionalUsd),
      ],
    ),
  );
  return { status: "SIMULATED", executionId, mode: "mock" };
}
