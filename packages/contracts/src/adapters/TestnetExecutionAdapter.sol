// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";
import {ControllerBoundAdapter} from "./ControllerBoundAdapter.sol";

/// @title TestnetExecutionAdapter
/// @notice Emits an event that a backend may watch to request a Hyperliquid testnet action.
///         This contract does not verify that the backend saw it, placed an order, or got a fill.
/// @dev This is a temporary adapter. The future implementation is `ElysiumCoreWriterAdapter`,
///      which uses Elysium's native fast-write path.
contract TestnetExecutionAdapter is IExecutionAdapter, ControllerBoundAdapter {
    uint256 public nonce;

    /// @dev executionId is an adapter request id, not a HyperCore execution/fill id.
    event ExecutionRequested(uint256 indexed strategyId, bytes32 indexed executionId, bytes data);

    function execute(uint256 strategyId, bytes calldata executionData)
        external
        onlyController
        returns (bytes32 executionId)
    {
        executionId = keccak256(
            abi.encodePacked("testnet", strategyId, nonce++, msg.sender, block.timestamp)
        );
        emit ExecutionRequested(strategyId, executionId, executionData);
    }
}
