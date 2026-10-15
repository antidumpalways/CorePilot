// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice One-time binding prevents arbitrary callers from forging adapter request events.
abstract contract ControllerBoundAdapter {
    address public immutable owner;
    address public controller;

    event ControllerSet(address indexed controller);

    error NotOwner();
    error NotController();
    error ControllerAlreadySet();
    error InvalidController();

    constructor() {
        owner = msg.sender;
    }

    function setController(address _controller) external {
        if (msg.sender != owner) revert NotOwner();
        if (controller != address(0)) revert ControllerAlreadySet();
        if (_controller.code.length == 0) revert InvalidController();
        controller = _controller;
        emit ControllerSet(_controller);
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }
}
