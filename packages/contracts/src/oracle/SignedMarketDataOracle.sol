// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarketDataReader} from "../interfaces/IMarketDataReader.sol";

/// @title SignedMarketDataOracle
/// @notice MVP market-data reader. The backend/executor submits signed snapshots and the
///         contract verifies signer, market, and freshness.
/// @dev This is a temporary adapter. The future implementation is Elysium's native HyperCore
///      market-data precompile, which keeps the same `IMarketDataReader` interface.
contract SignedMarketDataOracle is IMarketDataReader {
    struct Snapshot {
        uint256 markPriceUSD; // scaled by 1e8
        int256 fundingRateBps; // signed bps per hour
        uint256 timestampMs;
    }

    address public owner;
    address public signer;
    mapping(bytes32 => Snapshot) internal _snapshots;

    event SignerSet(address indexed signer);
    event DataSubmitted(
        bytes32 indexed market, uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs
    );
    event DataForced(bytes32 indexed market);

    error NotOwner();
    error BadSignature();
    error UnknownSigner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _signer) {
        owner = msg.sender;
        signer = _signer;
    }

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerSet(_signer);
    }

    function digest(
        bytes32 market,
        uint256 markPriceUSD,
        int256 fundingRateBps,
        uint256 timestampMs
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(market, markPriceUSD, fundingRateBps, timestampMs, block.chainid, address(this))
        );
    }

    function submit(
        bytes32 market,
        uint256 markPriceUSD,
        int256 fundingRateBps,
        uint256 timestampMs,
        bytes calldata signature
    ) external {
        if (signer == address(0)) revert UnknownSigner();
        bytes32 h = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest(market, markPriceUSD, fundingRateBps, timestampMs))
        );
        if (_recover(h, signature) != signer) revert BadSignature();
        _snapshots[market] = Snapshot(markPriceUSD, fundingRateBps, timestampMs);
        emit DataSubmitted(market, markPriceUSD, fundingRateBps, timestampMs);
    }

    /// @notice Owner override, for tests/local development only.
    function forceData(
        bytes32 market,
        uint256 markPriceUSD,
        int256 fundingRateBps,
        uint256 timestampMs
    ) external onlyOwner {
        _snapshots[market] = Snapshot(markPriceUSD, fundingRateBps, timestampMs);
        emit DataForced(market);
    }

    function getMarketData(bytes32 market)
        external
        view
        returns (uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs)
    {
        Snapshot memory s = _snapshots[market];
        return (s.markPriceUSD, s.fundingRateBps, s.timestampMs);
    }

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(h, v, r, s);
    }
}
