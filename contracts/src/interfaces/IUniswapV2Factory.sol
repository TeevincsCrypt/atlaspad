// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Uniswap V2 factory interface (Robinhood Chain: 0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f).
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}
