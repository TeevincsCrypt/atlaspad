// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IAtlasLaunchpad} from "./interfaces/IAtlasLaunchpad.sol";
import {INationTreasury} from "./interfaces/INationTreasury.sol";

/// @title AtlasGovernor
/// @notice Token-weighted on-chain governance for every AtlasPad nation, in one contract.
///
/// Each nation's citizens (holders of its NationToken) create and vote on proposals. Voting power is the
/// holder's ERC20Votes balance at the proposal snapshot (one second before creation), so tokens acquired after
/// a proposal is created cannot vote on it. Execution is permissionless once a proposal has passed.
///
/// Proposal kinds:
///  - Treasury:   send $WIF from the nation's NationTreasury account to a recipient (3-day vote, 4% quorum,
///                1-day timelock, at most 25% of the treasury per 7-day window — enforced by NationTreasury).
///  - GameAction: a national decision for the AtlasPad game (build, declare war, alliances). Execution emits
///                `GameActionExecuted`, which the AtlasPad game engine applies under the published rules in
///                GAME_MECHANICS.md (1-day vote, 1% quorum).
///  - Symbol:     change the national emblem / metadata URI stored in AtlasLaunchpad (1-day vote, 1% quorum).
contract AtlasGovernor {
    enum Kind {
        Treasury,
        GameAction,
        Symbol
    }

    enum State {
        Active,
        Canceled,
        Defeated,
        Queued,
        Executable,
        Executed,
        Expired
    }

    enum GameAction {
        Build, // arg = building type id (0..BUILDING_TYPES-1)
        DeclareWar, // arg = target nation id
        CreateAlliance, // text = alliance name; the alliance id is this proposal's id
        InviteToAlliance, // arg = invited nation id (into the alliance this nation founded)
        JoinAlliance, // arg = alliance id
        LeaveAlliance // arg = alliance id
    }

    struct Proposal {
        uint256 nationId;
        address proposer;
        Kind kind;
        bool executed;
        bool canceled;
        uint48 snapshot;
        uint48 voteEnd;
        uint48 eta;
        uint256 quorum;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bytes payload;
    }

    uint256 public constant BPS = 10_000;
    /// @notice Votes needed to create a proposal: 0.1% of supply.
    uint256 public constant PROPOSAL_THRESHOLD_BPS = 10;
    uint256 public constant TREASURY_QUORUM_BPS = 400;
    uint256 public constant STANDARD_QUORUM_BPS = 100;
    uint48 public constant TREASURY_VOTING_PERIOD = 3 days;
    uint48 public constant STANDARD_VOTING_PERIOD = 1 days;
    uint48 public constant TREASURY_TIMELOCK = 1 days;
    /// @notice Passed proposals must be executed within this window after their ETA, or they expire.
    uint48 public constant EXECUTION_WINDOW = 7 days;
    uint8 public constant BUILDING_TYPES = 8;
    uint256 public constant MAX_DESCRIPTION_BYTES = 2_000;
    uint256 public constant MAX_REASON_BYTES = 280;

    IAtlasLaunchpad public immutable launchpad;
    INationTreasury public immutable treasury;

    uint256 public proposalCount;
    mapping(uint256 proposalId => Proposal) internal _proposals;
    mapping(uint256 proposalId => mapping(address voter => bool)) public hasVoted;

    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed nationId,
        address indexed proposer,
        Kind kind,
        bytes payload,
        string description,
        uint48 snapshot,
        uint48 voteEnd,
        uint48 eta,
        uint256 quorum
    );
    event VoteCast(
        uint256 indexed proposalId,
        uint256 indexed nationId,
        address indexed voter,
        uint8 support,
        uint256 weight,
        string reason
    );
    event ProposalCanceled(uint256 indexed proposalId, uint256 indexed nationId);
    event ProposalExecuted(uint256 indexed proposalId, uint256 indexed nationId, Kind kind);
    event GameActionExecuted(
        uint256 indexed proposalId, uint256 indexed nationId, GameAction indexed action, uint256 arg, string text
    );

    error InvalidConfig();
    error UnknownNation();
    error BelowProposalThreshold();
    error InvalidPayload();
    error TextTooLong();
    error NotActive();
    error AlreadyVoted();
    error InvalidSupport();
    error NoVotingPower();
    error NotExecutable();
    error NotProposer();
    error UnknownProposal();

    constructor(address launchpad_, address treasury_) {
        if (launchpad_ == address(0) || treasury_ == address(0)) revert InvalidConfig();
        launchpad = IAtlasLaunchpad(launchpad_);
        treasury = INationTreasury(treasury_);
    }

    // ---------------------------------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------------------------------

    function propose(uint256 nationId, Kind kind, bytes calldata payload, string calldata description)
        external
        returns (uint256 proposalId)
    {
        address token = launchpad.tokenOf(nationId);
        if (token == address(0)) revert UnknownNation();
        if (bytes(description).length > MAX_DESCRIPTION_BYTES) revert TextTooLong();
        _validatePayload(nationId, kind, payload);

        uint48 snapshot = uint48(block.timestamp) - 1;
        uint256 supply = IVotes(token).getPastTotalSupply(snapshot);
        if (IVotes(token).getPastVotes(msg.sender, snapshot) < (supply * PROPOSAL_THRESHOLD_BPS) / BPS) {
            revert BelowProposalThreshold();
        }

        bool isTreasury = kind == Kind.Treasury;
        uint48 voteEnd = uint48(block.timestamp) + (isTreasury ? TREASURY_VOTING_PERIOD : STANDARD_VOTING_PERIOD);
        uint48 eta = voteEnd + (isTreasury ? TREASURY_TIMELOCK : 0);
        uint256 quorum = (supply * (isTreasury ? TREASURY_QUORUM_BPS : STANDARD_QUORUM_BPS)) / BPS;

        proposalId = ++proposalCount;
        Proposal storage p = _proposals[proposalId];
        p.nationId = nationId;
        p.proposer = msg.sender;
        p.kind = kind;
        p.snapshot = snapshot;
        p.voteEnd = voteEnd;
        p.eta = eta;
        p.quorum = quorum;
        p.payload = payload;
        _emitCreated(proposalId, p, description);
    }

    function _emitCreated(uint256 proposalId, Proposal storage p, string calldata description) internal {
        emit ProposalCreated(
            proposalId, p.nationId, p.proposer, p.kind, p.payload, description, p.snapshot, p.voteEnd, p.eta, p.quorum
        );
    }

    /// @param support 0 = against, 1 = for, 2 = abstain
    function castVote(uint256 proposalId, uint8 support, string calldata reason) external returns (uint256 weight) {
        Proposal storage p = _proposal(proposalId);
        if (state(proposalId) != State.Active) revert NotActive();
        if (support > 2) revert InvalidSupport();
        if (bytes(reason).length > MAX_REASON_BYTES) revert TextTooLong();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        weight = IVotes(launchpad.tokenOf(p.nationId)).getPastVotes(msg.sender, p.snapshot);
        if (weight == 0) revert NoVotingPower();
        hasVoted[proposalId][msg.sender] = true;
        if (support == 0) p.againstVotes += weight;
        else if (support == 1) p.forVotes += weight;
        else p.abstainVotes += weight;

        emit VoteCast(proposalId, p.nationId, msg.sender, support, weight, reason);
    }

    /// @notice The proposer may withdraw a proposal while voting is still open.
    function cancel(uint256 proposalId) external {
        Proposal storage p = _proposal(proposalId);
        if (msg.sender != p.proposer) revert NotProposer();
        if (state(proposalId) != State.Active) revert NotActive();
        p.canceled = true;
        emit ProposalCanceled(proposalId, p.nationId);
    }

    /// @notice Execute a passed proposal. Permissionless.
    function execute(uint256 proposalId) external {
        Proposal storage p = _proposal(proposalId);
        if (state(proposalId) != State.Executable) revert NotExecutable();
        p.executed = true;
        uint256 nationId = p.nationId;

        if (p.kind == Kind.Treasury) {
            (address recipient, uint256 amount) = abi.decode(p.payload, (address, uint256));
            treasury.release(nationId, recipient, amount, proposalId);
        } else if (p.kind == Kind.Symbol) {
            (uint256 emblem, string memory uri) = abi.decode(p.payload, (uint256, string));
            launchpad.setNationSymbol(nationId, emblem, uri);
        } else {
            (uint8 action, uint256 arg, string memory text) = abi.decode(p.payload, (uint8, uint256, string));
            emit GameActionExecuted(proposalId, nationId, GameAction(action), arg, text);
        }
        emit ProposalExecuted(proposalId, nationId, p.kind);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function state(uint256 proposalId) public view returns (State) {
        Proposal storage p = _proposal(proposalId);
        if (p.executed) return State.Executed;
        if (p.canceled) return State.Canceled;
        if (block.timestamp <= p.voteEnd) return State.Active;
        if (p.forVotes <= p.againstVotes || p.forVotes + p.abstainVotes < p.quorum) return State.Defeated;
        if (block.timestamp < p.eta) return State.Queued;
        if (block.timestamp > uint256(p.eta) + EXECUTION_WINDOW) return State.Expired;
        return State.Executable;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposal(proposalId);
    }

    /// @notice Votes required to create a proposal for a nation right now.
    function proposalThreshold(uint256 nationId) external view returns (uint256) {
        address token = launchpad.tokenOf(nationId);
        if (token == address(0)) revert UnknownNation();
        return (IVotes(token).getPastTotalSupply(block.timestamp - 1) * PROPOSAL_THRESHOLD_BPS) / BPS;
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    function _proposal(uint256 proposalId) internal view returns (Proposal storage p) {
        p = _proposals[proposalId];
        if (p.proposer == address(0)) revert UnknownProposal();
    }

    function _isAlliance(uint256 proposalId) internal view returns (bool) {
        Proposal storage a = _proposals[proposalId];
        if (!a.executed || a.kind != Kind.GameAction) return false;
        (uint8 action,,) = abi.decode(a.payload, (uint8, uint256, string));
        return action == uint8(GameAction.CreateAlliance);
    }

    /// @notice True if `allianceId` is an executed CreateAlliance proposal.
    function isAlliance(uint256 allianceId) external view returns (bool) {
        return _isAlliance(allianceId);
    }

    function _validatePayload(uint256 nationId, Kind kind, bytes calldata payload) internal view {
        if (kind == Kind.Treasury) {
            if (payload.length != 64) revert InvalidPayload();
            (address recipient, uint256 amount) = abi.decode(payload, (address, uint256));
            if (recipient == address(0) || recipient == address(treasury) || amount == 0) revert InvalidPayload();
        } else if (kind == Kind.Symbol) {
            (, string memory uri) = abi.decode(payload, (uint256, string));
            if (bytes(uri).length > 200) revert TextTooLong();
        } else {
            (uint8 action, uint256 arg, string memory text) = abi.decode(payload, (uint8, uint256, string));
            if (action > uint8(type(GameAction).max)) revert InvalidPayload();
            GameAction a = GameAction(action);
            if (a == GameAction.Build) {
                if (arg >= BUILDING_TYPES) revert InvalidPayload();
            } else if (a == GameAction.DeclareWar || a == GameAction.InviteToAlliance) {
                if (arg == nationId || launchpad.tokenOf(arg) == address(0)) revert InvalidPayload();
            } else if (a == GameAction.CreateAlliance) {
                uint256 len = bytes(text).length;
                if (len < 2 || len > 32) revert InvalidPayload();
            } else {
                // Join / Leave: alliance ids are the ids of executed CreateAlliance proposals.
                if (!_isAlliance(arg)) revert InvalidPayload();
            }
            if (a != GameAction.CreateAlliance && bytes(text).length != 0) revert InvalidPayload();
        }
    }
}
