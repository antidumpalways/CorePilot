import type { ExecutionIntent, Receipt } from "@corepilot/shared";
import type { Hex } from "viem";
import type { OnchainExecutionReceipt } from "./client.js";
import { stringToBytes32 } from "./units.js";

/** Exact CorePilotTypes.ExecutionRequest tuple. Mapping does not approve a policy or dispatch. */
export interface ControllerExecutionRequest {
  strategyId: bigint;
  market: Hex;
  isLong: boolean;
  notionalUsd: bigint;
  leverageBps: bigint;
  slippageBps: bigint;
}

export function executionIntentToControllerRequest(intent: ExecutionIntent): ControllerExecutionRequest {
  if (intent.action?.type !== "open_position" ||
      (intent.action.side !== "long" && intent.action.side !== "short")) {
    throw new TypeError("only open_position actions are supported by the controller");
  }
  return {
    strategyId: positiveInteger(intent.strategyId, "strategy id"),
    market: stringToBytes32(intent.market),
    isLong: intent.action.side === "long",
    notionalUsd: positiveInteger(intent.notionalUsd, "notional USD"),
    leverageBps: positiveInteger(intent.leverageBps, "leverage bps"),
    slippageBps: nonNegativeInteger(intent.slippageBps, "slippage bps"),
  };
}

/** On-chain observability only. A reported rejection is not a verified policy/constraint outcome. */
export type OnchainReceiptObservation =
  | {
      status: "ADAPTER_REQUESTED";
      venueFillStatus: "NOT_CONFIRMED";
      receipt: Extract<Receipt, { status: "ADAPTER_REQUESTED" }>;
      executor: OnchainExecutionReceipt["executor"];
      notionalUsd: number;
    }
  | {
      status: "EXECUTOR_REJECTION_REPORTED";
      venueFillStatus: "NOT_CONFIRMED";
      strategyId: number;
      onchainReceiptId: string;
      reportedReason: Hex;
      timestampMs: number;
      executor: OnchainExecutionReceipt["executor"];
    };

export function observeOnchainReceipt(id: number, raw: OnchainExecutionReceipt): OnchainReceiptObservation {
  const onchainReceiptId = positiveInteger(id, "receipt id").toString();
  if (raw.status === "ADAPTER_REQUESTED") {
    if (!raw.accepted || !/^0x[0-9a-fA-F]{64}$/.test(raw.executionId) || /^0x0{64}$/i.test(raw.executionId)) {
      throw new Error("inconsistent adapter-request receipt");
    }
    return {
      status: "ADAPTER_REQUESTED",
      venueFillStatus: "NOT_CONFIRMED",
      receipt: {
        status: "ADAPTER_REQUESTED",
        strategyId: raw.strategyId,
        timestampMs: raw.timestampMs,
        venueFillStatus: "NOT_CONFIRMED",
        onchainReceiptId,
        adapter: { status: "ADAPTER_REQUESTED", mode: "onchain", executionId: raw.executionId },
      },
      executor: raw.executor,
      notionalUsd: raw.notionalUsd,
    };
  }
  if (raw.status === "EXECUTOR_REJECTION_REPORTED") {
    if (raw.accepted) throw new Error("inconsistent executor-rejection receipt");
    return {
      status: "EXECUTOR_REJECTION_REPORTED",
      venueFillStatus: "NOT_CONFIRMED",
      strategyId: raw.strategyId,
      onchainReceiptId,
      reportedReason: raw.reason,
      timestampMs: raw.timestampMs,
      executor: raw.executor,
    };
  }
  throw new Error(`receipt ${onchainReceiptId} is not recorded`);
}

function nonNegativeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return BigInt(value);
}

function positiveInteger(value: number, label: string): bigint {
  const result = nonNegativeInteger(value, label);
  if (result === 0n) throw new RangeError(`${label} must be greater than zero`);
  return result;
}
