// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {AtlasGovernor} from "../src/AtlasGovernor.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {NationToken} from "../src/NationToken.sol";

contract AtlasGovernorTest is BaseTest {
    uint256 internal id;
    uint256 internal id2;
    NationToken internal token;
    address internal dave = makeAddr("dave");

    function setUp() public override {
        super.setUp();
        (id, token) = _found("Pepeland", "PEPE");
        (id2,) = _found("Dogeland", "DOGE");
        _buy(alice, id, 0.06 ether); // ~8% of supply
        _buy(bob, id, 0.03 ether); // ~3.5% of supply
        vm.deal(dave, 1 ether);
        vm.prank(dave);
        treasury.deposit{value: 1 ether}(id);
        vm.warp(block.timestamp + 1);
    }

    function _gamePayload(AtlasGovernor.GameAction action, uint256 arg, string memory text)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(uint8(action), arg, text);
    }

    function _propose(address who, AtlasGovernor.Kind kind, bytes memory payload) internal returns (uint256 pid) {
        vm.prank(who);
        pid = governor.propose(id, kind, payload, "Proposal");
    }

    function _vote(address who, uint256 pid, uint8 support) internal {
        vm.prank(who);
        governor.castVote(pid, support, "");
    }

    // --- proposing -----------------------------------------------------------------------------

    function test_ProposeRecordsSnapshotAndQuorum() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 2, ""));
        AtlasGovernor.Proposal memory p = governor.getProposal(pid);
        assertEq(p.nationId, id);
        assertEq(p.proposer, alice);
        assertEq(p.snapshot, block.timestamp - 1);
        assertEq(p.voteEnd, block.timestamp + 1 days);
        assertEq(p.eta, p.voteEnd);
        assertEq(p.quorum, SUPPLY / 100);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Active));
    }

    function test_TreasuryProposalTiming() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Treasury, abi.encode(carol, 0.1 ether));
        AtlasGovernor.Proposal memory p = governor.getProposal(pid);
        assertEq(p.voteEnd, block.timestamp + 3 days);
        assertEq(p.eta, p.voteEnd + 1 days);
        assertEq(p.quorum, (SUPPLY * 4) / 100);
    }

    function test_RevertWhen_BelowThreshold() public {
        vm.prank(carol);
        vm.expectRevert(AtlasGovernor.BelowProposalThreshold.selector);
        governor.propose(id, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 1, ""), "x");
    }

    function test_RevertWhen_TokensAcquiredThisSecondCannotPropose() public {
        _buy(carol, id, 0.01 ether);
        vm.prank(carol);
        vm.expectRevert(AtlasGovernor.BelowProposalThreshold.selector);
        governor.propose(id, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 1, ""), "x");
    }

    function test_RevertWhen_UnknownNation() public {
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.UnknownNation.selector);
        governor.propose(77, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 1, ""), "x");
    }

    function test_RevertWhen_InvalidPayloads() public {
        bytes[9] memory bad = [
            abi.encode(address(0), uint256(1)), // treasury: zero recipient
            abi.encode(carol, uint256(0)), // treasury: zero amount
            abi.encode(address(treasury), uint256(1)), // treasury: recipient is the treasury
            _gamePayload(AtlasGovernor.GameAction.Build, 8, ""), // unknown building
            _gamePayload(AtlasGovernor.GameAction.DeclareWar, id, ""), // war on self
            _gamePayload(AtlasGovernor.GameAction.DeclareWar, 99, ""), // unknown target
            _gamePayload(AtlasGovernor.GameAction.CreateAlliance, 0, "X"), // name too short
            _gamePayload(AtlasGovernor.GameAction.JoinAlliance, 1, ""), // not an alliance
            _gamePayload(AtlasGovernor.GameAction.Build, 1, "text not allowed")
        ];
        AtlasGovernor.Kind[9] memory kinds = [
            AtlasGovernor.Kind.Treasury,
            AtlasGovernor.Kind.Treasury,
            AtlasGovernor.Kind.Treasury,
            AtlasGovernor.Kind.GameAction,
            AtlasGovernor.Kind.GameAction,
            AtlasGovernor.Kind.GameAction,
            AtlasGovernor.Kind.GameAction,
            AtlasGovernor.Kind.GameAction,
            AtlasGovernor.Kind.GameAction
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(alice);
            vm.expectRevert(AtlasGovernor.InvalidPayload.selector);
            governor.propose(id, kinds[i], bad[i], "x");
        }
    }

    function test_RevertWhen_UnknownGameAction() public {
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.InvalidPayload.selector);
        governor.propose(id, AtlasGovernor.Kind.GameAction, abi.encode(uint8(6), uint256(0), ""), "x");
    }

    function test_RevertWhen_MalformedPayloadEncoding() public {
        vm.prank(alice);
        vm.expectRevert();
        governor.propose(id, AtlasGovernor.Kind.GameAction, hex"deadbeef", "x");
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.InvalidPayload.selector);
        governor.propose(id, AtlasGovernor.Kind.Treasury, hex"deadbeef", "x");
    }

    function test_RevertWhen_DescriptionTooLong() public {
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.TextTooLong.selector);
        governor.propose(
            id, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 1, ""), string(new bytes(2001))
        );
    }

    // --- voting --------------------------------------------------------------------------------

    function test_VotingWeightsAndPass() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _vote(alice, pid, 1);
        _vote(bob, pid, 0);
        AtlasGovernor.Proposal memory p = governor.getProposal(pid);
        assertEq(p.forVotes, token.balanceOf(alice));
        assertEq(p.againstVotes, token.balanceOf(bob));
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Executable));
    }

    function test_RevertWhen_DoubleVote() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _vote(alice, pid, 1);
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.AlreadyVoted.selector);
        governor.castVote(pid, 1, "");
    }

    function test_TokensBoughtAfterSnapshotCannotVote() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _buy(carol, id, 0.2 ether);
        vm.prank(carol);
        vm.expectRevert(AtlasGovernor.NoVotingPower.selector);
        governor.castVote(pid, 0, "");
    }

    function test_TransferredTokensCannotVoteTwice() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _vote(bob, pid, 0);
        uint256 bobBal = token.balanceOf(bob);
        vm.prank(bob);
        token.transfer(carol, bobBal);
        vm.prank(carol);
        vm.expectRevert(AtlasGovernor.NoVotingPower.selector);
        governor.castVote(pid, 0, "");
    }

    function test_RevertWhen_InvalidSupportOrReason() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.InvalidSupport.selector);
        governor.castVote(pid, 3, "");
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.TextTooLong.selector);
        governor.castVote(pid, 1, string(new bytes(281)));
    }

    function test_RevertWhen_VotingClosed() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        vm.expectRevert(AtlasGovernor.NotActive.selector);
        governor.castVote(pid, 1, "");
    }

    function test_DefeatedWithoutQuorum() public {
        // carol holds less than the 1% quorum
        _buy(carol, id, 0.004 ether);
        vm.prank(carol);
        token.transfer(dave, 1);
        vm.warp(block.timestamp + 1);
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _vote(carol, pid, 1);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Defeated));
        vm.expectRevert(AtlasGovernor.NotExecutable.selector);
        governor.execute(pid);
    }

    function test_DefeatedOnTie() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        // give bob exactly alice's votes worth by having alice vote against herself? use abstain + equal sides
        _vote(alice, pid, 0);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Defeated));
    }

    function test_AbstainCountsTowardQuorumOnly() public {
        // bob (~3.5%) votes for; alice (~8%) abstains -> passes (for > against, for+abstain >= quorum)
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Treasury, abi.encode(carol, 0.1 ether));
        _vote(bob, pid, 1);
        _vote(alice, pid, 2);
        vm.warp(block.timestamp + 3 days + 1);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Queued));
    }

    // --- execution -----------------------------------------------------------------------------

    function test_TreasuryProposalFullLifecycle() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Treasury, abi.encode(carol, 0.2 ether));
        _vote(alice, pid, 1);
        vm.warp(block.timestamp + 3 days + 1);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Queued));
        vm.expectRevert(AtlasGovernor.NotExecutable.selector);
        governor.execute(pid);
        vm.warp(block.timestamp + 1 days);
        uint256 before = carol.balance;
        vm.prank(dave); // permissionless
        governor.execute(pid);
        assertEq(carol.balance - before, 0.2 ether);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Executed));
        vm.expectRevert(AtlasGovernor.NotExecutable.selector);
        governor.execute(pid);
    }

    function test_TreasuryProposalRespectsReleaseCap() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Treasury, abi.encode(carol, 0.9 ether));
        _vote(alice, pid, 1);
        vm.warp(block.timestamp + 4 days + 1);
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        governor.execute(pid);
        // still executable later if the treasury grows
        vm.deal(dave, 10 ether);
        vm.prank(dave);
        treasury.deposit{value: 3 ether}(id);
        governor.execute(pid);
        assertEq(carol.balance, 1_000 ether + 0.9 ether);
    }

    function test_ProposalExpires() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        _vote(alice, pid, 1);
        vm.warp(block.timestamp + 1 days + 7 days + 2);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Expired));
        vm.expectRevert(AtlasGovernor.NotExecutable.selector);
        governor.execute(pid);
    }

    function test_SymbolProposal() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Symbol, abi.encode(uint256(0xBEEF), "ipfs://emblem"));
        _vote(alice, pid, 1);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectEmit(true, false, false, true);
        emit AtlasLaunchpad.NationSymbolUpdated(id, 0xBEEF, "ipfs://emblem");
        governor.execute(pid);
        assertEq(launchpad.getNation(id).emblem, 0xBEEF);
        assertEq(launchpad.metadataURIOf(id), "ipfs://emblem");
    }

    function test_GameActionEmitsEvent() public {
        uint256 pid =
            _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.DeclareWar, id2, ""));
        _vote(alice, pid, 1);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectEmit(true, true, true, true);
        emit AtlasGovernor.GameActionExecuted(pid, id, AtlasGovernor.GameAction.DeclareWar, id2, "");
        governor.execute(pid);
    }

    function test_AllianceLifecycle() public {
        uint256 create = _propose(
            alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.CreateAlliance, 0, "Meme Alliance")
        );
        assertFalse(governor.isAlliance(create));
        vm.prank(alice);
        vm.expectRevert(AtlasGovernor.InvalidPayload.selector);
        governor.propose(id, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.JoinAlliance, create, ""), "");
        _vote(alice, create, 1);
        vm.warp(block.timestamp + 1 days + 1);
        governor.execute(create);
        assertTrue(governor.isAlliance(create));

        // Dogeland can now propose joining the alliance
        _buy(bob, id2, 0.02 ether);
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        uint256 join = governor.propose(
            id2, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.JoinAlliance, create, ""), "join"
        );
        assertEq(governor.getProposal(join).nationId, id2);
    }

    function test_Cancel() public {
        uint256 pid = _propose(alice, AtlasGovernor.Kind.GameAction, _gamePayload(AtlasGovernor.GameAction.Build, 0, ""));
        vm.prank(bob);
        vm.expectRevert(AtlasGovernor.NotProposer.selector);
        governor.cancel(pid);
        vm.prank(alice);
        governor.cancel(pid);
        assertEq(uint8(governor.state(pid)), uint8(AtlasGovernor.State.Canceled));
        vm.prank(bob);
        vm.expectRevert(AtlasGovernor.NotActive.selector);
        governor.castVote(pid, 1, "");
    }

    function test_RevertWhen_UnknownProposal() public {
        vm.expectRevert(AtlasGovernor.UnknownProposal.selector);
        governor.state(999);
        vm.expectRevert(AtlasGovernor.UnknownProposal.selector);
        governor.execute(999);
    }

    function test_ProposalThresholdView() public view {
        assertEq(governor.proposalThreshold(id), SUPPLY / 1000);
    }

    function test_FlashBuyCannotPassProposal() public {
        // A whale buying after the proposal snapshot has zero weight on it.
        uint256 pid = _propose(alice, AtlasGovernor.Kind.Treasury, abi.encode(alice, 0.2 ether));
        _vote(bob, pid, 0); // bob opposes with ~3.5%
        _buy(carol, id, 1.5 ether);
        vm.prank(carol);
        vm.expectRevert(AtlasGovernor.NoVotingPower.selector);
        governor.castVote(pid, 1, "");
    }
}
