// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAtlasLaunchpad} from "./interfaces/IAtlasLaunchpad.sol";

/// @title NationTreasury
/// @notice Holds the ETH treasury of every AtlasPad nation in isolated per-nation accounts.
///
/// Income: 0.5% of every bonding-curve trade (deposited by the launchpad) and voluntary donations from
/// anyone via `deposit`. Spending: only `AtlasGovernor` can release funds, and the governor only does so when
/// executing a passed, timelocked treasury proposal voted on by that nation's token holders. A single release
/// is capped at MAX_RELEASE_BPS of the nation's balance. There is no owner and no developer access.
contract NationTreasury is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    /// @notice A single proposal may release at most 25% of a nation's current treasury balance.
    uint256 public constant MAX_RELEASE_BPS = 2_500;

    IAtlasLaunchpad public immutable launchpad;
    address public immutable governor;

    mapping(uint256 nationId => uint256) public balanceOf;
    mapping(uint256 nationId => uint256) public totalReceived;
    mapping(uint256 nationId => uint256) public totalReleased;
    uint256 public totalHeld;

    event Deposited(uint256 indexed nationId, address indexed from, uint256 amount, bool fromTradeFees);
    event Released(uint256 indexed nationId, address indexed to, uint256 amount, uint256 indexed proposalId);

    error InvalidConfig();
    error UnknownNation();
    error ZeroAmount();
    error OnlyGovernor();
    error InvalidRecipient();
    error ExceedsReleaseCap();
    error EthTransferFailed();
    error DirectTransferNotAllowed();

    constructor(address launchpad_, address governor_) {
        if (launchpad_ == address(0) || governor_ == address(0)) revert InvalidConfig();
        launchpad = IAtlasLaunchpad(launchpad_);
        governor = governor_;
    }

    /// @notice Deposit ETH into a nation's treasury. Anyone may donate.
    function deposit(uint256 nationId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (launchpad.tokenOf(nationId) == address(0)) revert UnknownNation();
        balanceOf[nationId] += msg.value;
        totalReceived[nationId] += msg.value;
        totalHeld += msg.value;
        emit Deposited(nationId, msg.sender, msg.value, msg.sender == address(launchpad));
    }

    /// @notice Release ETH from a nation's treasury. Only callable by AtlasGovernor when executing a passed
    /// treasury proposal of that nation.
    function release(uint256 nationId, address payable to, uint256 amount, uint256 proposalId) external nonReentrant {
        if (msg.sender != governor) revert OnlyGovernor();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[nationId];
        if (amount > (bal * MAX_RELEASE_BPS) / BPS) revert ExceedsReleaseCap();
        balanceOf[nationId] = bal - amount;
        totalReleased[nationId] += amount;
        totalHeld -= amount;
        emit Released(nationId, to, amount, proposalId);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Maximum amount a single proposal could release right now.
    function releaseCap(uint256 nationId) external view returns (uint256) {
        return (balanceOf[nationId] * MAX_RELEASE_BPS) / BPS;
    }

    /// @dev Untracked ETH would belong to no nation, so plain transfers are rejected.
    receive() external payable {
        revert DirectTransferNotAllowed();
    }
}
