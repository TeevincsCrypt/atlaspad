// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {NationToken} from "../src/NationToken.sol";

contract NationTokenTest is BaseTest {
    uint256 internal id;
    NationToken internal token;

    function setUp() public override {
        super.setUp();
        (id, token) = _found("Pepeland", "PEPE");
    }

    function test_Metadata() public view {
        assertEq(token.decimals(), 18);
        assertEq(token.CLOCK_MODE(), "mode=timestamp");
        assertEq(token.clock(), block.timestamp);
        assertFalse(token.graduated());
        assertEq(token.DEAD(), 0x000000000000000000000000000000000000dEaD);
    }

    function test_SystemAddressesNeverDelegated() public {
        assertEq(token.delegates(address(launchpad)), address(0));
        _graduate(id);
        assertEq(token.delegates(token.pair()), address(0));
        assertEq(token.getVotes(address(launchpad)), 0);
    }

    function test_AutoDelegationOnReceive() public {
        uint256 out = _buy(alice, id, 0.1 ether);
        assertEq(token.getVotes(alice), out);
        vm.prank(alice);
        token.transfer(bob, out / 4);
        assertEq(token.delegates(bob), bob);
        assertEq(token.getVotes(bob), out / 4);
        assertEq(token.getVotes(alice), out - out / 4);
    }

    function test_ExplicitDelegationIsRespected() public {
        uint256 out = _buy(alice, id, 0.1 ether);
        vm.prank(alice);
        token.delegate(carol);
        assertEq(token.getVotes(carol), out);
        _buy(alice, id, 0.01 ether);
        assertEq(token.delegates(alice), carol);
        assertEq(token.getVotes(alice), 0);
    }

    function test_PastVotesUseTimestamps() public {
        uint256 out = _buy(alice, id, 0.1 ether);
        uint256 t = block.timestamp;
        vm.warp(t + 10);
        assertEq(token.getPastVotes(alice, t), out);
        assertEq(token.getPastVotes(alice, t - 1), 0);
    }

    function test_RevertWhen_MarkGraduatedTwice() public {
        vm.prank(address(launchpad));
        token.markGraduated();
        vm.prank(address(launchpad));
        vm.expectRevert(NationToken.AlreadyGraduated.selector);
        token.markGraduated();
    }

    function test_PairLockLiftsAfterGraduation() public {
        uint256 out = _buy(alice, id, 0.1 ether);
        address pair = token.pair();
        vm.prank(alice);
        vm.expectRevert(NationToken.PoolLockedUntilGraduation.selector);
        token.transfer(pair, 1);
        _graduate(id);
        vm.prank(alice);
        token.transfer(pair, out); // allowed (e.g. by routers) after graduation
    }

    function testFuzz_TransfersConserveSupply(uint96 amount) public {
        uint256 out = _buy(alice, id, 0.2 ether);
        amount = uint96(bound(amount, 0, out));
        vm.prank(alice);
        token.transfer(bob, amount);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(address(launchpad)), SUPPLY);
        assertEq(token.getVotes(alice) + token.getVotes(bob), out);
    }
}
