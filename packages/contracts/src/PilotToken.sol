// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PilotToken (TEST ONLY)
/// @notice Minimal ERC-20 used for local/testnet development of CorePilot.
/// @dev This is NOT the production token. Production $PILOT launches separately via Ascend.
///      No sale logic. Test mint/faucet only.
contract PilotToken {
    string public constant name = "CorePilot Test Token";
    string public constant symbol = "PILOT";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public constant FAUCET_AMOUNT = 10_000e18;
    mapping(address => bool) public faucetUsed;
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "PILOT: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Test-only faucet. One claim per address.
    function faucet() external {
        require(!faucetUsed[msg.sender], "PILOT: faucet used");
        faucetUsed[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Test-only mint. Restricted to the deployer for controlled test setups.
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "PILOT: owner only");
        _mint(to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "PILOT: zero address");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "PILOT: balance");
        unchecked {
            balanceOf[from] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "PILOT: zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
