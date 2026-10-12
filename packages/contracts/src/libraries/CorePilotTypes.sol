// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared structs for CorePilot.
library CorePilotTypes {
    /// @notice A requested execution produced off-chain by the evaluator and gated on-chain.
    /// @param strategyId the registered strategy id
    /// @param market market symbol (e.g. bytes32("HYPE"))
    /// @param isLong direction of the position
    /// @param notionalUsd requested notional in whole USD
    /// @param leverageBps requested leverage in bps (e.g. 300 = 3x)
    /// @param slippageBps requested max slippage in bps (e.g. 50 = 0.50%)
    struct ExecutionRequest {
        uint256 strategyId;
        bytes32 market;
        bool isLong;
        uint256 notionalUsd;
        uint256 leverageBps;
        uint256 slippageBps;
    }
}
