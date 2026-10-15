// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";
import {ControllerBoundAdapter} from "./ControllerBoundAdapter.sol";

/// @title MockExecutionAdapter
/// @notice Records a simulated request and returns a deterministic id. No order is placed.
contract MockExecutionAdapter is IExecutionAdapter, ControllerBoundAdapter {
    uint256 public nonce;

    event ExecutionRecorded(uint256 indexed strategyId, bytes32 indexed executionId, bytes data);

    function execute(uint256 strategyId, bytes calldata executionData)
        external
        onlyController
        returns (bytes32 executionId)
    {
        executionId = keccak256(
            abi.encodePacked(strategyId, nonce++, msg.sender, block.timestamp)
        );
        emit ExecutionRecorded(strategyId, executionId, executionData);
    }
}
