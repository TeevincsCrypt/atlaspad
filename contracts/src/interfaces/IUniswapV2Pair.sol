// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Uniswap V2 pair interface used for graduation.
interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function totalSupply() external view returns (uint256);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
}
