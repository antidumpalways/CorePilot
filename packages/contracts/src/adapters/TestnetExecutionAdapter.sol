// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";

/// @title TestnetExecutionAdapter
/// @notice Emits an event that the backend executor watches; the backend performs the real
///         Hyperliquid testnet action and reports back the resulting execution id.
/// @dev This is a temporary adapter. The future implementation is `ElysiumCoreWriterAdapter`,
///      which uses Elysium's native fast-write path.
contract TestnetExecutionAdapter is IExecutionAdapter {
    uint256 public nonce;

    event ExecutionRequested(uint256 indexed strategyId, bytes32 indexed executionId, bytes data);

    function execute(uint256 strategyId, bytes calldata executionData)
        external
        returns (bytes32 executionId)
    {
        executionId = keccak256(
            abi.encodePacked("testnet", strategyId, nonce++, msg.sender, block.timestamp)
        );
        emit ExecutionRequested(strategyId, executionId, executionData);
    }
}
