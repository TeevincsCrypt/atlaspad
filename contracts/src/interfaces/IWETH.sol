// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice WETH9 interface (Robinhood Chain: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73).
interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
