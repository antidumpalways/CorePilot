// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PilotToken} from "../src/PilotToken.sol";

contract PilotTokenTest is Test {
    PilotToken private token;
    address private trader = address(0xBEEF);

    function setUp() public {
        token = new PilotToken();
    }

    function testFaucetCoversCreatorAndExecutorMinimums() public {
        vm.prank(trader);
        token.faucet();
        assertEq(token.balanceOf(trader), 10_000e18);
        assertTrue(token.faucetUsed(trader));
    }

    function testFaucetCannotBeClaimedTwice() public {
        vm.startPrank(trader);
        token.faucet();
        vm.expectRevert(bytes("PILOT: faucet used"));
        token.faucet();
        vm.stopPrank();
    }

    function testOnlyDeployerCanMint() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PILOT: owner only"));
        token.mint(trader, 1e18);
        token.mint(trader, 1e18);
        assertEq(token.balanceOf(trader), 1e18);
    }
}
