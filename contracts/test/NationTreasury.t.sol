// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {NationTreasury} from "../src/NationTreasury.sol";

contract NationTreasuryTest is BaseTest {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        (id,) = _found("Pepeland", "PEPE");
    }

    function test_TradeFeesAccrueToTreasury() public {
        _buy(alice, id, 1 ether);
        assertEq(treasury.balanceOf(id), 0.005 ether);
        assertEq(treasury.totalReceived(id), 0.005 ether);
        assertEq(wif.balanceOf(address(treasury)), treasury.totalHeld());
    }

    function test_Donation() public {
        vm.expectEmit(true, true, false, true);
        emit NationTreasury.Deposited(id, alice, 1 ether, false);
        vm.prank(alice);
        treasury.deposit(id, 1 ether);
        assertEq(treasury.balanceOf(id), 1 ether);
        assertEq(treasury.releaseCap(id), 0.25 ether);
    }

    function test_RevertWhen_DepositUnknownNation() public {
        vm.prank(alice);
        vm.expectRevert(NationTreasury.UnknownNation.selector);
        treasury.deposit(99, 1 ether);
    }

    function test_RevertWhen_DepositZero() public {
        vm.expectRevert(NationTreasury.ZeroAmount.selector);
        treasury.deposit(id, 0);
    }

    function test_RevertWhen_EthSent() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_DirectWifTransferIsNotCredited() public {
        vm.prank(alice);
        wif.transfer(address(treasury), 1 ether);
        assertEq(treasury.balanceOf(id), 0);
        assertEq(treasury.totalHeld(), 0);
    }

    function test_RevertWhen_ReleaseNotGovernor() public {
        vm.prank(alice);
        treasury.deposit(id, 1 ether);
        vm.prank(founder);
        vm.expectRevert(NationTreasury.OnlyGovernor.selector);
        treasury.release(id, founder, 0.1 ether, 1);
        // Not even the deployer/fee recipient
        vm.prank(feeRecipient);
        vm.expectRevert(NationTreasury.OnlyGovernor.selector);
        treasury.release(id, feeRecipient, 0.1 ether, 1);
    }

    function test_ReleaseCapAndAccounting() public {
        vm.prank(alice);
        treasury.deposit(id, 4 ether);
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id, bob, 1 ether + 1, 7);

        uint256 before = wif.balanceOf(bob);
        vm.prank(address(governor));
        treasury.release(id, bob, 1 ether, 7);
        assertEq(wif.balanceOf(bob) - before, 1 ether);
        assertEq(treasury.balanceOf(id), 3 ether);
        assertEq(treasury.totalReleased(id), 1 ether);
        assertEq(treasury.totalHeld(), wif.balanceOf(address(treasury)));
        // The 7-day window is used up: no further release until it rolls over.
        assertEq(treasury.releaseCap(id), 0);
    }

    function test_WeeklyWindowCapsCumulativeReleases() public {
        vm.prank(alice);
        treasury.deposit(id, 4 ether);
        vm.startPrank(address(governor));
        treasury.release(id, bob, 0.5 ether, 1);
        assertEq(treasury.releaseCap(id), 0.5 ether);
        treasury.release(id, bob, 0.5 ether, 2);
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id, bob, 1, 3);
        // Deposits during a window do not raise that window's cap.
        vm.stopPrank();
        vm.prank(alice);
        treasury.deposit(id, 100 ether);
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id, bob, 1, 3);
        // A new window opens 7 days after the first release, based on the balance at that time.
        vm.warp(block.timestamp + 7 days);
        assertEq(treasury.releaseCap(id), (103 ether) / 4);
        vm.prank(address(governor));
        treasury.release(id, bob, 25 ether, 4);
        assertEq(treasury.balanceOf(id), 78 ether);
    }

    function testFuzz_NeverDrainsFasterThanQuarterPerWeek(uint96 deposit, uint8 attempts) public {
        uint256 amount = bound(deposit, 1 ether, 500 ether);
        vm.prank(alice);
        treasury.deposit(id, amount);
        uint256 start = treasury.balanceOf(id);
        uint256 n = bound(attempts, 1, 20);
        vm.startPrank(address(governor));
        for (uint256 i; i < n; i++) {
            uint256 cap = treasury.releaseCap(id);
            if (cap == 0) break;
            treasury.release(id, bob, cap, i);
        }
        vm.stopPrank();
        assertGe(treasury.balanceOf(id), start - start / 4);
    }

    function test_RevertWhen_InvalidRecipientOrAmount() public {
        vm.prank(alice);
        treasury.deposit(id, 4 ether);
        vm.startPrank(address(governor));
        vm.expectRevert(NationTreasury.InvalidRecipient.selector);
        treasury.release(id, address(0), 1, 1);
        vm.expectRevert(NationTreasury.InvalidRecipient.selector);
        treasury.release(id, address(treasury), 1, 1);
        vm.expectRevert(NationTreasury.ZeroAmount.selector);
        treasury.release(id, bob, 0, 1);
        vm.stopPrank();
    }

    function test_NationsAreIsolated() public {
        (uint256 id2,) = _found("Dogeland", "DOGE");
        vm.prank(alice);
        treasury.deposit(id, 4 ether);
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id2, bob, 1, 1);
    }
}
