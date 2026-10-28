// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The subset of NationTreasury used by the launchpad and governor.
interface INationTreasury {
    function deposit(uint256 nationId, uint256 amount) external;
    function release(uint256 nationId, address to, uint256 amount, uint256 proposalId) external;
    function balanceOf(uint256 nationId) external view returns (uint256);
}
