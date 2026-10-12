// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";

/// @title MockExecutionAdapter
/// @notice Records a requested execution and returns a deterministic id. Used for safe
///         demonstrations where no real order is placed.
contract MockExecutionAdapter is IExecutionAdapter {
    uint256 public nonce;

    event ExecutionRecorded(uint256 indexed strategyId, bytes32 indexed executionId, bytes data);

    function execute(uint256 strategyId, bytes calldata executionData)
        external
        returns (bytes32 executionId)
    {
        executionId = keccak256(
            abi.encodePacked(strategyId, nonce++, msg.sender, block.timestamp)
        );
        emit ExecutionRecorded(strategyId, executionId, executionData);
    }
}
