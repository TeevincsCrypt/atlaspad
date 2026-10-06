// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Uniswap V2 Router02 interface (Robinhood Chain: 0x89e5db8b5aa49aa85ac63f691524311aeb649eba).
/// Only used by deployment pre-flight checks; AtlasPad contracts never call the router.
interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);
}
