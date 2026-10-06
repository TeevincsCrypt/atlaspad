// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The subset of AtlasLaunchpad used by the treasury and governor.
interface IAtlasLaunchpad {
    function tokenOf(uint256 nationId) external view returns (address);
    function setNationSymbol(uint256 nationId, uint256 emblem, string calldata metadataURI) external;
}
