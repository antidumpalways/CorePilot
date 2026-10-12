// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Executes an approved strategy intent.
/// @dev MVP implementations:
///      - `MockExecutionAdapter` (safe demo recorder)
///      - `TestnetExecutionAdapter` (backend performs the Hyperliquid testnet action)
///      Future implementation: `ElysiumCoreWriterAdapter` (Elysium's native fast-write path).
///      The interface is intentionally stable so the implementation can change without
///      redesigning the rest of the system.
interface IExecutionAdapter {
    function execute(uint256 strategyId, bytes calldata executionData)
        external
        returns (bytes32 executionId);
}
