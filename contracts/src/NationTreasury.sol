// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAtlasLaunchpad} from "./interfaces/IAtlasLaunchpad.sol";

/// @title NationTreasury
/// @notice Holds the $WIF treasury of every AtlasPad nation in isolated per-nation accounts.
///
/// Income: 0.5% of every bonding-curve trade (deposited by the launchpad) and voluntary $WIF donations from
/// anyone via `deposit`. Spending: only `AtlasGovernor` can release funds, and the governor only does so when
/// executing a passed, timelocked treasury proposal voted on by that nation's token holders.
///
/// Release cap: within any RELEASE_WINDOW (7 days) a nation may release at most MAX_RELEASE_BPS (25%) of the
/// balance it held when the window opened — however many proposals pass. A treasury can therefore never be
/// drained faster than 25% per week, even by a holder who passes several proposals in parallel.
/// There is no owner and no developer access.
contract NationTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice A nation may release at most 25% of its window-opening balance per RELEASE_WINDOW.
    uint256 public constant MAX_RELEASE_BPS = 2_500;
    uint256 public constant RELEASE_WINDOW = 7 days;

    IAtlasLaunchpad public immutable launchpad;
    address public immutable governor;
    IERC20 public immutable wif;

    struct ReleaseWindow {
        uint64 start;
        uint256 base; // nation balance when the window opened
        uint256 released; // released so far in this window
    }

    mapping(uint256 nationId => uint256) public balanceOf;
    mapping(uint256 nationId => uint256) public totalReceived;
    mapping(uint256 nationId => uint256) public totalReleased;
    mapping(uint256 nationId => ReleaseWindow) public releaseWindow;
    uint256 public totalHeld;

    event Deposited(uint256 indexed nationId, address indexed from, uint256 amount, bool fromTradeFees);
    event Released(uint256 indexed nationId, address indexed to, uint256 amount, uint256 indexed proposalId);

    error InvalidConfig();
    error UnknownNation();
    error ZeroAmount();
    error OnlyGovernor();
    error InvalidRecipient();
    error ExceedsReleaseCap();
    error UnsupportedToken();

    constructor(address launchpad_, address governor_, address wif_) {
        if (launchpad_ == address(0) || governor_ == address(0) || wif_ == address(0)) revert InvalidConfig();
        launchpad = IAtlasLaunchpad(launchpad_);
        governor = governor_;
        wif = IERC20(wif_);
    }

    /// @notice Deposit $WIF into a nation's treasury (requires approval). Anyone may donate.
    function deposit(uint256 nationId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (launchpad.tokenOf(nationId) == address(0)) revert UnknownNation();
        uint256 before = wif.balanceOf(address(this));
        wif.safeTransferFrom(msg.sender, address(this), amount);
        if (wif.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
        balanceOf[nationId] += amount;
        totalReceived[nationId] += amount;
        totalHeld += amount;
        emit Deposited(nationId, msg.sender, amount, msg.sender == address(launchpad));
    }

    /// @notice Release $WIF from a nation's treasury. Only callable by AtlasGovernor when executing a passed
    /// treasury proposal of that nation.
    function release(uint256 nationId, address to, uint256 amount, uint256 proposalId) external nonReentrant {
        if (msg.sender != governor) revert OnlyGovernor();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[nationId];
        ReleaseWindow storage w = releaseWindow[nationId];
        if (block.timestamp >= uint256(w.start) + RELEASE_WINDOW) {
            w.start = uint64(block.timestamp);
            w.base = bal;
            w.released = 0;
        }
        if (w.released + amount > (w.base * MAX_RELEASE_BPS) / BPS) revert ExceedsReleaseCap();
        w.released += amount;
        balanceOf[nationId] = bal - amount;
        totalReleased[nationId] += amount;
        totalHeld -= amount;
        emit Released(nationId, to, amount, proposalId);
        wif.safeTransfer(to, amount);
    }

    /// @notice Maximum amount a proposal could release right now (remaining allowance in the current window).
    function releaseCap(uint256 nationId) external view returns (uint256) {
        ReleaseWindow storage w = releaseWindow[nationId];
        if (block.timestamp >= uint256(w.start) + RELEASE_WINDOW) {
            return (balanceOf[nationId] * MAX_RELEASE_BPS) / BPS;
        }
        uint256 cap = (w.base * MAX_RELEASE_BPS) / BPS;
        return cap > w.released ? cap - w.released : 0;
    }
}
