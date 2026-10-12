// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Reads the latest market snapshot for a market.
/// @dev MVP implementation: `SignedMarketDataOracle` (signed off-chain snapshots).
///      Future implementation: Elysium's native HyperCore market-data precompile.
interface IMarketDataReader {
    /// @param markPriceUSD mark price in whole USD (scaled by 1e8 for precision)
    /// @param fundingRateBps hourly funding rate in bps, signed
    /// @param timestampMs snapshot timestamp in milliseconds
    function getMarketData(bytes32 market)
        external
        view
        returns (uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs);
}
