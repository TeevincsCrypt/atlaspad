# AtlasPad Smart Contracts

AtlasPad is an on-chain civilization game in which every token is a nation and every holder is a citizen. This
document covers the Solidity contracts in [`contracts/`](contracts/): what each contract does, every external
function, the exact constants, the bonding-curve math, graduation to Uniswap V2, deployment and tests.

Everything below is taken from the source in `contracts/src`, `contracts/script` and `contracts/test`. If this
document and the code disagree, the code is authoritative.

> **Status as of 2026-10-06**
>
> - **No external audit.** The contracts have not been externally audited. See [SECURITY.md](SECURITY.md).
> - **Not deployed to mainnet.** The Robinhood Chain mainnet deployment has not been performed. It could not be
>   run from the development sandbox because the sandbox's network egress could not reach the Robinhood Chain
>   RPC. No mainnet addresses are recorded yet. When the deployment is broadcast, `script/Deploy.s.sol` records
>   the addresses in `contracts/deployments/4663.json` (see [Deployment](#12-deployment)).

## Contents

1. [Overview and contract relationships](#1-overview-and-contract-relationships)
2. [Network and external dependencies](#2-network-and-external-dependencies)
3. [Parameters at a glance](#3-parameters-at-a-glance)
4. [AtlasLaunchpad](#4-atlaslaunchpad)
5. [Bonding-curve math](#5-bonding-curve-math)
6. [Graduation to Uniswap V2](#6-graduation-to-uniswap-v2)
7. [NationToken](#7-nationtoken)
8. [NationTokenFactory](#8-nationtokenfactory)
9. [NationTreasury](#9-nationtreasury)
10. [AtlasGovernor](#10-atlasgovernor)
11. [Founder allocation and vesting transparency](#11-founder-allocation-and-vesting-transparency)
12. [Deployment](#12-deployment)
13. [Build and test](#13-build-and-test)

---

## 1. Overview and contract relationships

| Contract | Source | Instances | Role |
|---|---|---|---|
| `AtlasLaunchpad` | `src/AtlasLaunchpad.sol` | 1 | Founds nations, runs each nation's bonding curve, vests founder allocations (claimable after graduation), graduates nations to Uniswap V2 and accrues protocol fees. |
| `NationTokenFactory` | `src/NationTokenFactory.sol` | 1, created by the launchpad's constructor | Deploys `NationToken` contracts with CREATE2. Only the launchpad can call it. |
| `NationToken` | `src/NationToken.sol` | 1 per nation | Fixed-supply ERC-20 with EIP-2612 permit and ERC20Votes (timestamp clock). |
| `NationTreasury` | `src/NationTreasury.sol` | 1, shared by all nations | Holds every nation's ETH treasury in separate per-nation accounts. |
| `AtlasGovernor` | `src/AtlasGovernor.sol` | 1, shared by all nations | Token-weighted proposals and voting for every nation. |

Interfaces in `src/interfaces/`: `IAtlasLaunchpad` (`tokenOf`, `setNationSymbol`), `INationTreasury` (`deposit`,
`release`, `balanceOf`), `IUniswapV2Factory` (`getPair`, `createPair`), `IUniswapV2Pair` (`token0`, `token1`,
`totalSupply`, `getReserves`, `mint`), `IUniswapV2Router02` (`factory`, `WETH`; used only by the deployment
scripts) and `IWETH` (`deposit`, `transfer`, `balanceOf`). The `src/libraries/` directory is empty.

### Who deploys whom

```
Deployer account (script/Deploy.s.sol)
 ├─ nonce n    NationTreasury(launchpad*, governor*)
 ├─ nonce n+1  AtlasGovernor(launchpad*, treasury)
 └─ nonce n+2  AtlasLaunchpad(uniswapV2Factory, weth, treasury, governor,
                              protocolFeeRecipient, graduationEth, creationFee)
                 └─ constructor: new NationTokenFactory()        (factory.launchpad = the launchpad)
                       └─ deploy(): new NationToken{salt: bytes32(nationId)}(…)   one per nation
                             └─ constructor: UniswapV2Factory.getPair(token, WETH),
                                             or createPair(token, WETH) if no pair exists yet

* predicted with vm.computeCreateAddress(deployer, nonce) before anything is deployed
```

The treasury, governor and launchpad all reference each other through `immutable` fields. To break the cycle,
`Deploy.s.sol` (and the test fixture `test/Base.t.sol`) predicts the three CREATE addresses from the deployer's
nonce, deploys in the order shown, and then `require`s that each deployed address matches its prediction.

### Runtime calls between contracts

| Caller | Callee | Call | When |
|---|---|---|---|
| AtlasLaunchpad | NationTokenFactory | `deploy(...)` | `foundNation` |
| AtlasLaunchpad | NationTreasury | `deposit{value}(nationId)` | Every curve buy and sell (treasury half of the fee) |
| AtlasLaunchpad | NationToken | `markGraduated()` | Graduation |
| AtlasLaunchpad | WETH / Uniswap V2 pair | `deposit`, `transfer`, `mint(DEAD)` | Graduation |
| AtlasGovernor | NationTreasury | `release(...)` | Executing a Treasury proposal |
| AtlasGovernor | AtlasLaunchpad | `setNationSymbol(...)` | Executing a Symbol proposal |
| AtlasGovernor, NationTreasury | AtlasLaunchpad | `tokenOf(nationId)` | Nation existence checks and token lookup |
| AtlasGovernor | NationToken | `getPastVotes`, `getPastTotalSupply` | Proposing and voting |

---

## 2. Network and external dependencies

| Item | Value |
|---|---|
| Chain | Robinhood Chain mainnet, an Arbitrum Orbit L2 |
| Chain ID | `4663` |
| Gas token | ETH |
| Explorer | https://robinhoodchain.blockscout.com |
| Default RPC in app config | `https://rpc.mainnet.chain.robinhood.com` (`packages/shared/src/chains.ts`) |
| Foundry RPC alias | `robinhood = "${ROBINHOOD_RPC_URL}"` (`contracts/foundry.toml`) |
| Source verification | Blockscout: `[etherscan] robinhood = { key = "${BLOCKSCOUT_API_KEY}", url = "https://robinhoodchain.blockscout.com/api/", chain = 4663 }` |

### Uniswap V2 and WETH on Robinhood Chain

| Contract | Address | Where it appears in the repo |
|---|---|---|
| Uniswap V2 Factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` | `packages/shared/src/chains.ts` (`ROBINHOOD_DEX.uniswapV2Factory`); `contracts/src/interfaces/IUniswapV2Factory.sol` NatSpec; `contracts/script/Deploy.s.sol` header; `contracts/test/mocks/UniswapV2.sol` header |
| Uniswap V2 Router02 | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` | `packages/shared/src/chains.ts` (`ROBINHOOD_DEX.uniswapV2Router`); `contracts/src/interfaces/IUniswapV2Router02.sol` NatSpec; `contracts/script/Deploy.s.sol` header; `contracts/test/mocks/UniswapV2.sol` header |
| WETH9 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | `packages/shared/src/chains.ts` (`ROBINHOOD_DEX.weth`); `contracts/src/interfaces/IWETH.sol` NatSpec; `contracts/script/Deploy.s.sol` header; `contracts/test/mocks/WETH9.sol` header |

How these addresses are used:

- The contracts do not hard-code them. The factory and WETH addresses are constructor arguments of
  `AtlasLaunchpad` (stored as `immutable`) and are passed on to each `NationToken`. `Deploy.s.sol` reads them from
  the `UNISWAP_V2_FACTORY`, `UNISWAP_V2_ROUTER` and `WETH_ADDRESS` environment variables.
- Before deploying, the script checks that all three addresses have code, that `router.factory()` equals the
  factory and `router.WETH()` equals WETH, and that `factory.getPair(...)` can be called.
- AtlasPad contracts never call the router. It is used only by the deployment pre-flight checks, by
  `VerifyDeployment.s.sol`, and by the web app for Uniswap swaps after graduation
  (`apps/web/src/components/nation/TradePanel.tsx`).
- For local development, `DeployLocal.s.sol` deploys `test/mocks/WETH9.sol` and `test/mocks/UniswapV2.sol`
  (a Solidity 0.8 port of Uniswap V2 core plus the Router02 functions the frontend uses). These mocks are for
  local development and tests only.

---

## 3. Parameters at a glance

All values are compile-time `constant`s unless marked *immutable*. Immutable values are fixed for the lifetime of
a deployment by constructor arguments.

| Parameter | Value | Defined in |
|---|---|---|
| Curve trade fee | 1% of trade value, in ETH (`TRADE_FEE_BPS = 100`) | AtlasLaunchpad |
| Protocol share of the fee | 0.5% of trade value (`PROTOCOL_FEE_BPS = 50`) | AtlasLaunchpad |
| Treasury share of the fee | 0.5% of trade value (`TREASURY_FEE_BPS = 50`) | AtlasLaunchpad |
| Creation fee | *immutable* `creationFee`, from 0 to 1 ETH | AtlasLaunchpad constructor |
| Graduation threshold | *immutable* `graduationEth`, from 0.01 ETH to 10,000 ETH | AtlasLaunchpad constructor |
| LP reserve | 20% of supply (`LP_RESERVE_BPS = 2_000`) | AtlasLaunchpad |
| Max founder allocation | 5% of supply (`MAX_FOUNDER_BPS = 500`) | AtlasLaunchpad |
| Founder vesting | Linear over 30 days from founding (`FOUNDER_VESTING = 30 days`); vested tokens can be claimed only after graduation | AtlasLaunchpad |
| Max initial buy in the founding transaction | 10% of supply (`MAX_INITIAL_BUY_BPS = 1_000`) | AtlasLaunchpad |
| Total supply bounds | 1,000,000 to 1,000,000,000,000 tokens (`MIN_SUPPLY`, `MAX_SUPPLY`); 18 decimals; must be a whole number of tokens | AtlasLaunchpad |
| Themes | 8 (`THEME_COUNT`), ids 0 to 7 | AtlasLaunchpad |
| Burn address | `0x000000000000000000000000000000000000dEaD` (`DEAD`) | AtlasLaunchpad, NationToken |
| Proposal threshold | 0.1% of supply (`PROPOSAL_THRESHOLD_BPS = 10`) | AtlasGovernor |
| Treasury proposal | 3-day vote, 4% quorum, 1-day timelock | AtlasGovernor |
| GameAction and Symbol proposals | 1-day vote, 1% quorum, no timelock | AtlasGovernor |
| Execution window | 7 days after the ETA, after which the proposal expires (`EXECUTION_WINDOW`) | AtlasGovernor |
| Max release per treasury proposal | 25% of the nation's current treasury balance (`MAX_RELEASE_BPS = 2_500`) | NationTreasury |
| Text limits | name 2–32 bytes, symbol 2–10 chars, description ≤ 280 bytes, metadata URI ≤ 200 bytes, proposal description ≤ 2,000 bytes, vote reason ≤ 280 bytes, alliance name 2–32 bytes | AtlasLaunchpad, AtlasGovernor |
| Building types | 8 (`BUILDING_TYPES`), ids 0 to 7 | AtlasGovernor |

`BPS = 10_000` is the basis-point denominator in the launchpad, treasury and governor.

The mainnet values of `graduationEth` and `creationFee` are chosen when the deployment runs, through the
`GRADUATION_ETH_WEI` and `CREATION_FEE_WEI` environment variables. The `Deploy.s.sol` header gives `2 ETH` and `0` as
examples. `DeployLocal.s.sol` reads separate variables, `LOCAL_GRADUATION_ETH_WEI` and `LOCAL_CREATION_FEE_WEI`, which
default to `2 ETH` and `0`. Read the deployed values on-chain with `graduationEth()` and `creationFee()`.

---

## 4. AtlasLaunchpad

`src/AtlasLaunchpad.sol` inherits OpenZeppelin `ReentrancyGuard` and uses `SafeERC20`. It has no owner, no pause
and no upgrade path, and every configuration value is `immutable` or `constant`.

### Immutable configuration

| Getter | Meaning | Constructor check |
|---|---|---|
| `uniswapV2Factory()` | Uniswap V2 factory used to create each nation's token/WETH pair | Not zero |
| `weth()` | WETH9 used for pool seeding | Not zero |
| `treasury()` | NationTreasury | Not zero |
| `governor()` | AtlasGovernor, the only caller allowed to use `setNationSymbol` | Not zero |
| `protocolFeeRecipient()` | Receives protocol fees from `withdrawProtocolFees()` | Not zero |
| `graduationEth()` | Net ETH the curve raises before it graduates (applies to every nation) | 0.01 ETH ≤ value ≤ 10,000 ETH |
| `creationFee()` | Flat fee to found a nation, paid to the protocol | ≤ 1 ETH |
| `tokenFactory()` | The NationTokenFactory created in the constructor | n/a |

If any check fails, the constructor reverts with `InvalidConfig()`.

### Storage

```solidity
struct Nation {
    address token;
    address founder;              // msg.sender of foundNation; cannot be changed
    address pair;                 // token/WETH Uniswap V2 pair
    uint64  createdAt;            // founding timestamp; vesting starts here
    uint64  graduatedAt;
    uint8   theme;
    bool    graduated;
    uint256 emblem;
    uint256 totalSupply;
    uint256 curveSupply;          // tokens sold through the curve
    uint256 lpReserve;            // tokens paired with the raised ETH at graduation (0 after graduation)
    uint256 founderAllocation;    // vested to the founder over FOUNDER_VESTING
    uint256 founderClaimed;
    uint256 initialVirtualEth;
    uint256 virtualEth;           // includes real ETH raised
    uint256 virtualTokens;
    uint256 realEth;              // ETH actually held for this nation's curve (0 after graduation)
    uint256 curveTokensRemaining;
}
```

Other public state: `nationCount`, `nationIdOfToken(address)`, `metadataURIOf(uint256)`, `nameTaken(bytes32)`,
`symbolTaken(bytes32)` and `protocolFeesAccrued` (protocol fees not yet paid out). Nation ids start at 1.

The launchpad's ETH balance always equals the sum of `realEth` across nations plus `protocolFeesAccrued`
(`invariant_EthSolvency`). For each nation it holds `curveTokensRemaining + lpReserve + founderAllocation −
founderClaimed` tokens (`invariant_TokenCustody`).

### Founding parameters and validation

```solidity
struct FoundingParams {
    string  name;
    string  symbol;
    string  description;
    string  metadataURI;
    uint8   theme;
    uint256 emblem;
    uint256 totalSupply;
    uint16  founderBps;
    uint256 minTokensOut; // slippage bound for the optional initial buy
}
```

| Field | Rule | Error |
|---|---|---|
| `name` | 2–32 bytes. Allowed characters: `A–Z a–z 0–9`, space, `-`, `.`, `'`. No leading, trailing or double spaces. Must be unique, compared case-insensitively. | `InvalidName`, `NameTaken` |
| `symbol` | 2–10 characters of `A–Z 0–9`. Must be unique. | `InvalidSymbol`, `SymbolTaken` |
| `description` | ≤ 280 bytes | `TextTooLong` |
| `metadataURI` | ≤ 200 bytes | `TextTooLong` |
| `theme` | `< 8` (Medieval, Cyberpunk, Space, Ocean, Jungle, Meme, AI, Fantasy) | `InvalidTheme` |
| `totalSupply` | `1_000_000 ether` to `1_000_000_000_000 ether`, and a multiple of `1 ether` | `InvalidSupply` |
| `founderBps` | `≤ 500` | `InvalidFounderBps` |
| `msg.value` | `≥ creationFee` | `InsufficientCreationFee` |

Names and symbols are reserved permanently once a nation is founded. Nothing frees them.

### External and public functions

| Function | Access | Behavior |
|---|---|---|
| `foundNation(FoundingParams p) payable returns (uint256 nationId, address token)` | Anyone; `nonReentrant` | Validates `p` and reserves the name and symbol. Deploys the token through the factory (the whole supply is minted to the launchpad), initializes the curve and stores the metadata URI. Emits `NationFounded` and `CurveInitialized` and adds `creationFee` to `protocolFeesAccrued`. Any ETH above `creationFee` becomes the founder's initial curve buy. That buy pays the normal 1% fee, is bounded by `p.minTokensOut` (`Slippage`), and reverts with `InitialBuyTooLarge` if it would deliver more than 10% of supply. There is no deadline parameter. |
| `buy(uint256 nationId, uint256 minTokensOut, uint256 deadline) payable returns (uint256 tokensOut)` | Anyone; `nonReentrant` | Reverts with `Expired` if `block.timestamp > deadline`. Buys on the curve with `msg.value` (see [§5](#5-bonding-curve-math)) and reverts with `Slippage` if `tokensOut < minTokensOut`. If the buy sells out the curve, it is capped at the remaining curve supply, the unused ETH is refunded, and the nation graduates in the same transaction. |
| `sell(uint256 nationId, uint256 tokensIn, uint256 minEthOut, uint256 deadline) returns (uint256 ethOut)` | Anyone; `nonReentrant` | Reverts with `Expired` after the deadline. Requires an ERC-20 allowance to the launchpad. Sells `tokensIn` back to the curve, reverting with `Slippage` if `ethOut < minEthOut`. |
| `sellWithPermit(uint256 nationId, uint256 tokensIn, uint256 minEthOut, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 ethOut)` | Anyone; `nonReentrant` | Calls `permit(msg.sender, launchpad, tokensIn, deadline, v, r, s)` inside `try/catch`, then sells. If the permit fails (for example because it was already used), the failure is ignored and the sell goes through as long as the existing allowance covers it. |
| `claimFounderTokens(uint256 nationId) returns (uint256 amount)` | Nation founder only (`NotFounder`); `nonReentrant` | Reverts with `NotGraduated` until the nation has graduated. Then transfers vested, unclaimed founder tokens to the founder. Reverts with `NothingToClaim` if the amount is zero. Because claims open only after graduation, when the curve is closed, founder tokens can never be sold back into the bonding curve against ETH paid by other buyers. |
| `setNationSymbol(uint256 nationId, uint256 emblem, string metadataURI)` | `governor` only (`OnlyGovernor`) | Sets the emblem and metadata URI (≤ 200 bytes). Emits `NationSymbolUpdated`. Only reachable through a passed Symbol proposal. |
| `withdrawProtocolFees()` | Anyone; `nonReentrant` | Sends all of `protocolFeesAccrued` to the immutable `protocolFeeRecipient`. Reverts with `NothingToClaim` if there is nothing to send, or `EthTransferFailed` if the recipient rejects ETH. |
| `vestedFounderTokens(uint256 nationId) view` | n/a | Founder allocation vested so far, whether claimed or not. |
| `getNation(uint256 nationId) view returns (Nation)` | n/a | Full nation record. Reverts with `UnknownNation`. |
| `tokenOf(uint256 nationId) view returns (address)` | n/a | Token address, or `address(0)` for an unknown id. Does not revert. |
| `spotPrice(uint256 nationId) view` | n/a | `virtualEth * 1e18 / virtualTokens`: the marginal curve price in wei per whole token. |
| `quoteBuy(uint256 nationId, uint256 ethIn) view returns (tokensOut, fee, ethUsed, refund)` | n/a | Exact quote using the same math as `buy`. Returns all zeros if the nation has graduated or `ethIn == 0`. |
| `quoteSell(uint256 nationId, uint256 tokensIn) view returns (ethOut, fee)` | n/a | Exact quote using the same math as `sell`. Returns zeros if the nation has graduated, `tokensIn == 0`, or the sell would exceed the curve limits. |
| `isNameAvailable(string) view`, `isSymbolAvailable(string) view` | n/a | Uniqueness check only. Does not validate format. |

### Events

| Event | Emitted when |
|---|---|
| `NationFounded(uint256 indexed nationId, address indexed token, address indexed founder, string name, string symbol, uint8 theme, uint256 emblem, string description, string metadataURI)` | `foundNation` |
| `CurveInitialized(uint256 indexed nationId, address pair, uint256 totalSupply, uint256 curveSupply, uint256 lpReserve, uint256 founderAllocation, uint256 virtualEth, uint256 virtualTokens)` | `foundNation` |
| `Trade(uint256 indexed nationId, address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee, uint256 virtualEth, uint256 virtualTokens, uint256 realEth, uint256 curveTokensRemaining)` | Every curve buy and sell. `ethAmount` is the ETH paid including the fee for a buy, or the ETH received after the fee for a sell. `fee` is the total fee. The reserve fields show the state after the trade. On a graduating buy the event is emitted before graduation zeroes `realEth`. |
| `NationGraduated(uint256 indexed nationId, address indexed pair, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 lpBurned)` | Graduation |
| `FounderTokensClaimed(uint256 indexed nationId, address indexed founder, uint256 amount)` | `claimFounderTokens` |
| `NationSymbolUpdated(uint256 indexed nationId, uint256 emblem, string metadataURI)` | `setNationSymbol` |
| `ProtocolFeesWithdrawn(address indexed recipient, uint256 amount)` | `withdrawProtocolFees` |

### Errors

| Error | Cause |
|---|---|
| `InvalidConfig()` | Zero address in the constructor, `graduationEth` out of bounds, or `creationFee > 1 ether` |
| `InvalidName()`, `InvalidSymbol()`, `InvalidTheme()`, `InvalidSupply()`, `InvalidFounderBps()`, `TextTooLong()` | Founding validation (see the table above). `TextTooLong` is also raised by `setNationSymbol`. |
| `NameTaken()`, `SymbolTaken()` | Name (case-insensitive) or symbol already used |
| `InsufficientCreationFee()` | `msg.value < creationFee` |
| `InitialBuyTooLarge()` | Founder's initial buy would deliver more than 10% of supply |
| `UnknownNation()` | No nation with that id |
| `NationGraduatedAlready()` | Curve trade attempted after graduation |
| `ZeroAmount()` | Zero ETH or tokens in, or a trade that would produce zero output |
| `Slippage()` | Output below `minTokensOut` or `minEthOut` |
| `Expired()` | `block.timestamp > deadline` |
| `InsufficientCurveLiquidity()` | Sell would push `curveTokensRemaining` above `curveSupply`, or would need more ETH than the nation's `realEth` |
| `EthTransferFailed()` | ETH refund or payout rejected, or WETH `transfer` returned false |
| `OnlyGovernor()` | `setNationSymbol` called by anyone other than the governor |
| `NothingToClaim()` | No vested founder tokens to claim, or no protocol fees to withdraw |
| `NotFounder()` | `claimFounderTokens` called by anyone other than the founder |
| `NotGraduated()` | `claimFounderTokens` called by the founder before the nation has graduated |

---

## 5. Bonding-curve math

Each nation has its own constant-product curve with **virtual reserves**: `virtualEth × virtualTokens = k`. The
curves share no ETH: every nation's `realEth` is tracked and spent separately.

### Supply split

With `S = totalSupply` and `f = founderBps`:

```
L (lpReserve)         = S × 2000 / 10000          // 20%, paired with the raised ETH at graduation
F (founderAllocation) = S × f / 10000             // 0–5%, vested to the founder
C (curveSupply)       = S − L − F                 // 75–80%, sold through the curve
```

### Initial virtual reserves

With `R = graduationEth`:

```
virtualTokens₀ = C² / (C − L)
virtualEth₀    = R × L / (C − L)
```

These values make the curve end exactly at the Uniswap V2 opening price, as derived below. Integer division
rounds down. `initialVirtualEth` stores `virtualEth₀`.

### Buy

```
fee       = ethIn × 100 / 10000                       // 1%, rounded down
netEth    = ethIn − fee
k         = virtualEth × virtualTokens
tokensOut = virtualTokens − ceil(k / (virtualEth + netEth))
```

If `tokensOut ≥ curveTokensRemaining`, the buy sells out the curve and is recalculated:

```
tokensOut = curveTokensRemaining
netEth    = ceil(k / (virtualTokens − tokensOut)) − virtualEth   // only the ETH needed
gross     = min(ceil(netEth × 10000 / 9900), ethIn)
fee       = gross − netEth
refund    = ethIn − gross                                       // sent back to the buyer
```

State update: `virtualEth += netEth`, `virtualTokens −= tokensOut`, `realEth += netEth`,
`curveTokensRemaining −= tokensOut`.

### Sell

```
newVirtualEth = ceil(virtualEth × virtualTokens / (virtualTokens + tokensIn))
grossEth      = virtualEth − newVirtualEth
fee           = grossEth × 100 / 10000                 // 1%, rounded down
ethOut        = grossEth − fee
```

A sell is allowed only when both of these hold:

- `curveTokensRemaining + tokensIn ≤ curveSupply`: the curve buys back at most the amount it has sold, net.
- `grossEth ≤ realEth`: a nation's curve never pays out more ETH than it actually holds.

Together these keep each nation's ETH separate from every other nation's. Founder-allocation tokens never reach
the curve: `claimFounderTokens` reverts with `NotGraduated` until the nation has graduated, and a graduated
nation's curve is closed (`test_RevertWhen_FounderTokensClaimedBeforeGraduation`). Before graduation, every token
outside the launchpad was therefore bought from the curve, and selling all of them back returns
`curveTokensRemaining` to `curveSupply` (`test_SellingBackEverythingRestoresTheCurve`).

State update: `virtualEth −= grossEth`, `virtualTokens += tokensIn`, `realEth −= grossEth`,
`curveTokensRemaining += tokensIn`.

### Fee split

On both buys and sells: `treasuryFee = fee × 50 / 100` (rounded down) is deposited into `NationTreasury` for the
nation, and `protocolFee = fee − treasuryFee` is added to `protocolFeesAccrued`.

### Rounding and invariants

- Every `ceilDiv` rounds in the curve's favor, so `virtualEth × virtualTokens` never drops below its initial value
  (`test_CurvePriceMathMonotonicAcrossGraduationDistances`). A buy-then-sell round trip never returns more ETH than
  was put in (`testFuzz_BuySellRoundTripNeverProfits`; about 2% is lost to fees).
- `virtualEth − initialVirtualEth == realEth` holds for every nation that has not graduated
  (`invariant_RealEthMatchesVirtual`).
- `virtualTokens − curveTokensRemaining` never changes: buys and sells move both by the same amount.

### Price continuity at graduation

When all `C` curve tokens have been sold, in exact arithmetic:

```
virtualTokens_end = virtualTokens₀ − C            = C·L / (C − L)
virtualEth_end    = k / virtualTokens_end         = R·C / (C − L)
realEth_end       = virtualEth_end − virtualEth₀  = R                     (net ETH raised = graduationEth)
final curve price = virtualEth_end / virtualTokens_end = R / L
Uniswap opening   = WETH reserve / token reserve  = realEth / lpReserve = R / L
```

The last curve price equals the Uniswap V2 opening price. Integer rounding introduces tiny deviations:
`test_GraduationSeedsUniswapAndBurnsLp` checks that the WETH reserve is within 0.01% of `graduationEth` and the
opening price within 0.1% of `R / L`. Other derived quantities:

- Opening spot price `= R·L / C²`. Opening fully diluted value `= R·L·S / C²`, which is `0.3125 × R` with a 0%
  founder allocation (checked in `test_CurveShapeMatchesDerivation`) and about `0.3556 × R` with 5%.
- Graduation fully diluted value `= R / L × S = 5 × R`.
- Price multiple from opening to graduation `= C² / L²`: 16× with a 0% founder allocation, 14.0625× with 5%.

Illustration only, with `S = 1,000,000,000` tokens and `R = 2 ETH` (the example value in `Deploy.s.sol`; the
mainnet value is set at deployment):

| founderBps | C | L | virtualTokens₀ | virtualEth₀ | Opening price | Graduation price | Opening FDV | Graduation FDV |
|---|---|---|---|---|---|---|---|---|
| 0 | 800M | 200M | ≈ 1,066,666,667 | ≈ 0.6667 ETH | 6.25e-10 ETH | 1e-8 ETH | 0.625 ETH | 10 ETH |
| 500 | 750M | 200M | ≈ 1,022,727,273 | ≈ 0.7273 ETH | ≈ 7.11e-10 ETH | 1e-8 ETH | ≈ 0.711 ETH | 10 ETH |

### TypeScript mirror

`packages/shared/src/game/curve.ts` is an exact bigint port of `_initCurve` (`initialCurve`), `_quoteBuy`
(`quoteBuy`) and `spotPrice`, plus `curveMilestones` for opening and graduation figures. There is no sell port.
The web app uses it to preview a nation that does not exist yet (the founder's initial buy). For existing
nations the contract's `quoteBuy` and `quoteSell` views are authoritative.

---

## 6. Graduation to Uniswap V2

Graduation happens inside the buy that sells out the curve (`_graduate`). Nothing else can trigger it, and there
is no time limit: a nation stays on its curve until the curve sells out.

1. The nation is marked graduated: `graduated = true`, `graduatedAt = block.timestamp`. `realEth` and `lpReserve`
   are zeroed in storage after their values are read into `ethLiquidity` and `tokenLiquidity`.
2. `NationToken.markGraduated()` lifts the pre-graduation pair lock ([§7](#7-nationtoken)).
3. `WETH.deposit{value: ethLiquidity}()`, then the WETH is transferred to the pair.
4. `tokenLiquidity` (the 20% LP reserve) is transferred to the pair.
5. `pair.mint(DEAD)`. The LP tokens are minted to `0x000000000000000000000000000000000000dEaD`, so the liquidity
   is burned and permanently locked. Under standard Uniswap V2 behavior, the pair's `MINIMUM_LIQUIDITY` (1,000 LP
   wei) goes to `address(0)` on the first mint. The test checks that `DEAD` holds `totalSupply − 1000`.
6. `NationGraduated(nationId, pair, ethLiquidity, tokenLiquidity, lpBurned)` is emitted. Any refund is then sent
   to the buyer.

The launchpad never uses the router to add liquidity. It seeds the pair directly. Two pre-existing conditions are
handled:

- **Pair already exists.** The pair address is deterministic, so anyone can create it before the token exists.
  The `NationToken` constructor reuses an existing pair (`test_FoundingSurvivesPreCreatedPair`).
- **WETH donated to the pair before graduation.** Nation tokens cannot reach the pair before graduation (see the
  pair lock), so donated WETH only raises the opening price and is locked along with the burned liquidity
  (`test_DonatedWethBeforeGraduationOnlyRaisesPrice`).

After graduation:

- `buy`, `sell` and `sellWithPermit` revert with `NationGraduatedAlready`. `quoteBuy` and `quoteSell` return zeros.
- Trading happens on the Uniswap V2 pair, for example through the Router02. AtlasPad contracts take no fee on
  those trades.
- Founder tokens become claimable. Whatever has vested since founding can be claimed at once, and vesting continues
  until 30 days after founding (`test_VestingContinuesAfterGraduation`). For that nation the launchpad then holds
  only the unclaimed founder allocation.

---

## 7. NationToken

`src/NationToken.sol` is `ERC20, ERC20Permit, ERC20Votes` (OpenZeppelin Contracts v5.6.1).

- **Fixed supply.** The whole supply is minted once, in the constructor, to the launchpad. `_mint` is called nowhere
  else, and there is no mint function, burn function, owner, pause, blacklist, transfer tax or upgrade path
  (`test_NoTokenMintingPossible`).
- **Metadata.** Name and symbol are the nation's. Decimals are 18. The EIP-712 domain is the token name with version
  `"1"` (OpenZeppelin `ERC20Permit`).

### State

| Getter | Type | Meaning |
|---|---|---|
| `DEAD()` | constant | `0x000000000000000000000000000000000000dEaD` |
| `nationId()` | immutable | AtlasPad nation id |
| `launchpad()` | immutable | The launchpad that founded the nation and holds the unsold supply |
| `pair()` | immutable | Token/WETH Uniswap V2 pair, created or looked up in the constructor |
| `graduated()` | bool | `true` once the launchpad calls `markGraduated()` |

### Functions specific to AtlasPad

| Function | Access | Behavior |
|---|---|---|
| `constructor(string name_, string symbol_, uint256 nationId_, uint256 totalSupply_, address launchpad_, address uniswapV2Factory, address weth)` | Called by NationTokenFactory | Uses `getPair(this, weth)`, or `createPair` if no pair exists. Mints `totalSupply_` to `launchpad_`. |
| `markGraduated()` | `launchpad` only (`OnlyLaunchpad`); once (`AlreadyGraduated`) | Sets `graduated = true` and emits `Graduated(pair)`. |
| `clock() view returns (uint48)` | n/a | `uint48(block.timestamp)` |
| `CLOCK_MODE() pure returns (string)` | n/a | `"mode=timestamp"` |

Inherited OpenZeppelin functions: ERC-20 (`transfer`, `transferFrom`, `approve`, `allowance`, `balanceOf`,
`totalSupply`, `name`, `symbol`, `decimals`), EIP-2612 (`permit`, `nonces`, `DOMAIN_SEPARATOR`), EIP-5267
(`eip712Domain`) and ERC20Votes (`delegate`, `delegateBySig`, `delegates`, `getVotes`, `getPastVotes`,
`getPastTotalSupply`, `numCheckpoints`, `checkpoints`).

### Transfer hook (`_update`)

1. **Pre-graduation pair lock.** If `to == pair` and `!graduated`, the transfer reverts with
   `PoolLockedUntilGraduation()`. This covers `transfer` and `transferFrom`. It stops anyone seeding the pool at a
   price of their choosing before the curve migrates its liquidity. The lock is lifted for good by
   `markGraduated()` (`test_RevertWhen_SeedingPoolBeforeGraduation`, `test_PairLockLiftsAfterGraduation`).
2. **Automatic self-delegation.** After the balance update, if `value != 0`, the recipient is not `address(0)`,
   the launchpad, the pair or `DEAD`, and the recipient has no delegate yet, the recipient is delegated to itself.
   Citizens can therefore vote without a separate `delegate` transaction (`test_AutoDelegationOnReceive`). An
   explicit delegation is kept (`test_ExplicitDelegationIsRespected`). System addresses never receive voting power
   (`test_SystemAddressesNeverDelegated`). Because the check is `delegates(to) == address(0)`, a holder who
   delegates to the zero address is self-delegated again on their next non-zero incoming transfer.

### Clock

ERC-6372 uses timestamps. The source comment explains that on Robinhood Chain, an Arbitrum Orbit chain,
`block.number` tracks the parent chain, so timestamps are the reliable clock for governance snapshots
(`test_PastVotesUseTimestamps`).

### Events and errors

- Events: `Graduated(address indexed pair)`, plus the inherited `Transfer`, `Approval`, `DelegateChanged`,
  `DelegateVotesChanged` and `EIP712DomainChanged`.
- Errors: `PoolLockedUntilGraduation()`, `OnlyLaunchpad()`, `AlreadyGraduated()`, plus the inherited OpenZeppelin
  ERC-20, permit and votes errors.

---

## 8. NationTokenFactory

`src/NationTokenFactory.sol` exists so that `NationToken`'s creation code does not count against the launchpad's
24 KB runtime size limit. According to `forge build --sizes`, the launchpad's runtime size is 12,774 bytes.

| Item | Detail |
|---|---|
| `launchpad()` | immutable, set to `msg.sender` in the constructor. The launchpad creates the factory in its own constructor. |
| `deploy(string name, string symbol, uint256 nationId, uint256 totalSupply, address uniswapV2Factory, address weth) returns (address token)` | Launchpad only (`OnlyLaunchpad()`, `test_TokenFactoryOnlyLaunchpad`). Runs `new NationToken{salt: bytes32(nationId)}(name, symbol, nationId, totalSupply, launchpad, uniswapV2Factory, weth)`. |

Because of CREATE2 with `salt = nationId`, a token's address can be predicted in advance. That is why the token
constructor tolerates a pair that already exists.

---

## 9. NationTreasury

`src/NationTreasury.sol` inherits `ReentrancyGuard`. It holds ETH for all nations in separate per-nation accounts.
It has no owner, and no account other than the governor can move funds.

| Item | Detail |
|---|---|
| Constants | `BPS = 10_000`, `MAX_RELEASE_BPS = 2_500` (25%) |
| Immutables | `launchpad` (`IAtlasLaunchpad`), `governor` (address). The constructor reverts with `InvalidConfig` on a zero address. |
| State | `balanceOf(nationId)`, `totalReceived(nationId)`, `totalReleased(nationId)`, `totalHeld` |

| Function | Access | Behavior |
|---|---|---|
| `deposit(uint256 nationId) payable` | Anyone | Requires `msg.value > 0` (`ZeroAmount`) and an existing nation, checked with `launchpad.tokenOf(nationId) != 0` (`UnknownNation`). Credits the nation and emits `Deposited(nationId, msg.sender, amount, fromTradeFees)`, where `fromTradeFees` is `msg.sender == launchpad`. The launchpad uses it for the treasury half of every curve fee, and anyone can donate. |
| `release(uint256 nationId, address payable to, uint256 amount, uint256 proposalId)` | `governor` only (`OnlyGovernor`); `nonReentrant` | Requires `to` to be neither `address(0)` nor the treasury (`InvalidRecipient`), `amount > 0` (`ZeroAmount`), and `amount ≤ balanceOf[nationId] × 2500 / 10000` (`ExceedsReleaseCap`). Updates accounting, emits `Released(nationId, to, amount, proposalId)`, then sends the ETH (`EthTransferFailed` on failure). |
| `releaseCap(uint256 nationId) view` | n/a | `balanceOf[nationId] × 2500 / 10000` |
| `receive()` | n/a | Always reverts with `DirectTransferNotAllowed()`: ETH that is not credited to a nation would belong to nobody. |

Events: `Deposited(uint256 indexed nationId, address indexed from, uint256 amount, bool fromTradeFees)`,
`Released(uint256 indexed nationId, address indexed to, uint256 amount, uint256 indexed proposalId)`.

Errors: `InvalidConfig`, `UnknownNation`, `ZeroAmount`, `OnlyGovernor`, `InvalidRecipient`, `ExceedsReleaseCap`,
`EthTransferFailed`, `DirectTransferNotAllowed`.

The 25% cap is measured against the nation's balance when the proposal is executed. If a passed proposal exceeds
the cap at that moment, execution reverts. The proposal stays executable for the rest of its window and can
succeed later if the balance grows (`test_TreasuryProposalRespectsReleaseCap`). There is no limit across
proposals: several passed proposals can be executed one after another, each capped at 25% of the balance
remaining at that point.

---

## 10. AtlasGovernor

`src/AtlasGovernor.sol` runs token-weighted governance for every nation in one contract. It has no owner and no
guardian, and execution is permissionless.

### Constants and immutables

| Name | Value |
|---|---|
| `PROPOSAL_THRESHOLD_BPS` | `10` (0.1% of supply) |
| `TREASURY_QUORUM_BPS` | `400` (4%) |
| `STANDARD_QUORUM_BPS` | `100` (1%) |
| `TREASURY_VOTING_PERIOD` | `3 days` |
| `STANDARD_VOTING_PERIOD` | `1 days` |
| `TREASURY_TIMELOCK` | `1 days` |
| `EXECUTION_WINDOW` | `7 days` |
| `BUILDING_TYPES` | `8` |
| `MAX_DESCRIPTION_BYTES` | `2_000` |
| `MAX_REASON_BYTES` | `280` |
| `launchpad`, `treasury` | immutable; the constructor reverts with `InvalidConfig` on zero |

### Enums

- `Kind`: `Treasury = 0`, `GameAction = 1`, `Symbol = 2`
- `State`: `Active = 0`, `Canceled = 1`, `Defeated = 2`, `Queued = 3`, `Executable = 4`, `Executed = 5`, `Expired = 6`
- `GameAction`: `Build = 0`, `DeclareWar = 1`, `CreateAlliance = 2`, `InviteToAlliance = 3`, `JoinAlliance = 4`,
  `LeaveAlliance = 5`

### Proposal kinds and payloads

| Kind | Payload (`abi.encode`) | Validation at `propose` | Vote / quorum / timelock | Effect on `execute` |
|---|---|---|---|---|
| Treasury | `(address recipient, uint256 amount)`, exactly 64 bytes | `recipient` is not zero or the treasury; `amount > 0`; otherwise `InvalidPayload` | 3 days / 4% / 1 day | `treasury.release(nationId, recipient, amount, proposalId)`, which enforces the 25% cap at execution time |
| Symbol | `(uint256 emblem, string uri)` | `uri` ≤ 200 bytes (`TextTooLong`) | 1 day / 1% / none | `launchpad.setNationSymbol(nationId, emblem, uri)` |
| GameAction | `(uint8 action, uint256 arg, string text)` | `action ≤ 5`. `Build`: `arg < 8`. `DeclareWar` and `InviteToAlliance`: `arg` is another existing nation. `CreateAlliance`: `text` is 2–32 bytes. `JoinAlliance` and `LeaveAlliance`: `arg` is the id of an executed `CreateAlliance` proposal. `text` must be empty for every action except `CreateAlliance`. Failures revert with `InvalidPayload`. | 1 day / 1% / none | Emits `GameActionExecuted(proposalId, nationId, action, arg, text)` |

An alliance's id is the id of its executed `CreateAlliance` proposal (`isAlliance(id)`). On-chain, the governor
only validates game actions and emits events. It keeps no game state such as buildings, wars or alliance
membership and enforces no game rules beyond the checks above. The AtlasPad game engine in
`apps/indexer/src/game/` turns these events into game state. The game rules are in
[GAME_MECHANICS.md](GAME_MECHANICS.md).

Payloads that fail to ABI-decode revert without a custom error. A Treasury payload that is not exactly 64 bytes
reverts with `InvalidPayload`.

### Lifecycle

`propose` works like this:

- `snapshot = block.timestamp − 1`. Voting weight and supply are read at the snapshot, so tokens acquired in the
  same second as the proposal, or later, carry no weight on it.
- Requires `getPastVotes(proposer, snapshot) ≥ getPastTotalSupply(snapshot) × 10 / 10000`, otherwise
  `BelowProposalThreshold`.
- `voteEnd = now + votingPeriod`, `eta = voteEnd + timelock` (equal to `voteEnd` for non-Treasury kinds), and
  `quorum = supply × quorumBps / 10000`. Quorum is fixed when the proposal is created.
- Proposal ids form one global counter shared by all nations and start at 1. There is no voting delay: voting
  opens immediately.

`state(proposalId)` is evaluated in this order:

1. `executed` → `Executed`
2. `canceled` → `Canceled`
3. `block.timestamp ≤ voteEnd` → `Active`
4. `forVotes ≤ againstVotes` **or** `forVotes + abstainVotes < quorum` → `Defeated`. Ties fail. Against votes do not
   count toward quorum.
5. `block.timestamp < eta` → `Queued`
6. `block.timestamp > eta + 7 days` → `Expired`
7. otherwise → `Executable`

### Functions

| Function | Access | Behavior |
|---|---|---|
| `propose(uint256 nationId, Kind kind, bytes payload, string description) returns (uint256 proposalId)` | Holders at or above the threshold | Checks that the nation exists (`UnknownNation`), that the description is ≤ 2,000 bytes (`TextTooLong`), the payload and the threshold. Stores the proposal and emits `ProposalCreated`. |
| `castVote(uint256 proposalId, uint8 support, string reason) returns (uint256 weight)` | Anyone with weight at the snapshot | Requires `Active` (`NotActive`), `support ≤ 2` (0 against, 1 for, 2 abstain; otherwise `InvalidSupport`), a reason ≤ 280 bytes (`TextTooLong`), no earlier vote (`AlreadyVoted`), and non-zero weight (`NoVotingPower`). Weight is `getPastVotes(voter, snapshot)`. Votes cannot be changed. There is no vote-by-signature. |
| `cancel(uint256 proposalId)` | The proposer only (`NotProposer`), while `Active` (`NotActive`) | Marks the proposal canceled and emits `ProposalCanceled`. Nobody else can cancel or veto a proposal, and a proposal cannot be canceled once voting has ended. |
| `execute(uint256 proposalId)` | Anyone, when `Executable` (`NotExecutable`) | Sets `executed = true` before making external calls, performs the action for its kind, and emits `ProposalExecuted`. If the action reverts (for example `ExceedsReleaseCap`), the whole call reverts and the proposal stays `Executable`. |
| `state(uint256) view returns (State)` | n/a | As above. Reverts with `UnknownProposal` for an unknown id. |
| `getProposal(uint256) view returns (Proposal)` | n/a | Returns `nationId, proposer, kind, executed, canceled, snapshot, voteEnd, eta, quorum, forVotes, againstVotes, abstainVotes, payload`. |
| `proposalThreshold(uint256 nationId) view` | n/a | Votes needed to propose right now (supply at `block.timestamp − 1` × 0.1%). |
| `isAlliance(uint256 allianceId) view` | n/a | `true` if the id belongs to an executed `CreateAlliance` proposal. |
| `proposalCount()`, `hasVoted(uint256, address)` | n/a | Public getters |

### Events and errors

- `ProposalCreated(uint256 indexed proposalId, uint256 indexed nationId, address indexed proposer, Kind kind, bytes payload, string description, uint48 snapshot, uint48 voteEnd, uint48 eta, uint256 quorum)`
- `VoteCast(uint256 indexed proposalId, uint256 indexed nationId, address indexed voter, uint8 support, uint256 weight, string reason)`
- `ProposalCanceled(uint256 indexed proposalId, uint256 indexed nationId)`
- `ProposalExecuted(uint256 indexed proposalId, uint256 indexed nationId, Kind kind)`
- `GameActionExecuted(uint256 indexed proposalId, uint256 indexed nationId, GameAction indexed action, uint256 arg, string text)`
- Errors: `InvalidConfig`, `UnknownNation`, `BelowProposalThreshold`, `InvalidPayload`, `TextTooLong`, `NotActive`,
  `AlreadyVoted`, `InvalidSupport`, `NoVotingPower`, `NotExecutable`, `NotProposer`, `UnknownProposal`

Quorum and threshold are fractions of **total supply** at the snapshot. Total supply includes tokens that cannot
vote: the launchpad's unsold curve tokens, LP reserve and unclaimed founder allocation, plus tokens in the pair and
at `DEAD`.

---

## 11. Founder allocation and vesting transparency

| What | How to check on-chain |
|---|---|
| Founder address | `NationFounded.founder` (indexed) and `getNation(id).founder`. Set to `msg.sender` of `foundNation`; cannot be changed or transferred. |
| Allocation size | `CurveInitialized.founderAllocation` and `getNation(id).founderAllocation`. At most 5% of supply (`founderBps ≤ 500`). The allocation is taken out of the curve supply, not added on top. |
| Vesting | Accrues linearly from `createdAt` over 30 days, whether or not the nation has graduated: `vested = founderAllocation × min(elapsed, 30 days) / 30 days`. Read it with `vestedFounderTokens(id)`. |
| Claiming | `claimFounderTokens(id)`, by the founder only and only after graduation (`NotGraduated` before). Claimed tokens therefore can never be sold back into the bonding curve against other buyers' ETH; after graduation they trade on Uniswap like any other tokens. The app shows this as "30-day vesting, claimable after graduation". |
| Claimed so far | `getNation(id).founderClaimed` and the `FounderTokensClaimed` events |
| Custody before claim | The tokens stay in the launchpad (always until graduation), which never delegates, so unclaimed founder tokens carry no votes |
| Initial buy | Any ETH above `creationFee` in `foundNation` is an ordinary curve buy by the founder, visible as a `Trade` event in the founding transaction. It pays the 1% fee and is capped at 10% of supply. The cap applies only to that founding buy. Nothing stops the founder from buying more later, like any other buyer. |

If the founder loses access to the founder address, unclaimed tokens stay in the launchpad permanently. No
function can redirect them.

---

## 12. Deployment

This section describes what the scripts do. For the step-by-step operator procedure, including the dry run,
choosing the indexer start block and verifying contracts one at a time, see [DEPLOYMENT.md](DEPLOYMENT.md).
Environment variables for every component are listed in [ENVIRONMENT.md](ENVIRONMENT.md).

### Scripts

| Script | Purpose |
|---|---|
| `script/Deploy.s.sol` | Production deployment. Runs pre-flight checks, deploys Treasury, Governor and Launchpad with predicted addresses, runs post-flight wiring checks, and writes the deployment record (a broadcast run writes `deployments/<chainId>.json`; a dry run writes `deployments/<chainId>.dry-run.json`). |
| `script/DeployLocal.s.sol` | Local anvil only: refuses to run unless `block.chainid == 31337`. Deploys mock WETH9, UniswapV2Factory and Router02, then runs `Deploy.deploy` with the deployer as fee recipient, `LOCAL_GRADUATION_ETH_WEI` defaulting to 2 ETH and `LOCAL_CREATION_FEE_WEI` defaulting to 0. It deliberately does not read `GRADUATION_ETH_WEI` / `CREATION_FEE_WEI`, so production values in `contracts/.env` never leak into local deployments. |
| `script/VerifyDeployment.s.sol` | Read-only check of `deployments/<chainId>.json` against the live chain (see below). |
| `script/SmokeTest.s.sol` | Founds a real nation with small amounts, buys, and sells half back. Spends real ETH on any chain other than anvil, and requires `SMOKE_CONFIRM=I_UNDERSTAND` there. |

### Production deployment (`Deploy.s.sol`)

Required environment variables (the script header points to [ENVIRONMENT.md](ENVIRONMENT.md) and the repository-root
[`.env.example`](.env.example); Foundry auto-loads `contracts/.env`):

| Variable | Robinhood Chain value or note |
|---|---|
| `EXPECTED_CHAIN_ID` | `4663` |
| `UNISWAP_V2_FACTORY` | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` |
| `UNISWAP_V2_ROUTER` | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` |
| `WETH_ADDRESS` | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| `PROTOCOL_FEE_RECIPIENT` | Immutable once deployed. The script comment recommends a multisig such as a Safe. It must be able to accept plain ETH transfers. |
| `GRADUATION_ETH_WEI` | 0.01 ETH to 10,000 ETH in wei (example in the script: `2000000000000000000`) |
| `CREATION_FEE_WEI` | 0 to 1 ETH in wei (example in the script: `0`) |
| `ROBINHOOD_RPC_URL` | Used by the `robinhood` RPC alias in `foundry.toml` |
| `BLOCKSCOUT_API_KEY` | Used by the `[etherscan] robinhood` entry for `--verify` |

Command from the script header (uses a keystore account rather than a raw private key):

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify \
  --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

What the script checks:

- **Pre-flight**, before broadcasting: `block.chainid == EXPECTED_CHAIN_ID`; factory, router and WETH have code;
  `router.factory() == factory`; `router.WETH() == weth`; `factory.getPair(weth, 0xdead)` can be called; the fee
  recipient is not zero; `graduationEth` and `creationFee` are within the constructor bounds.
- **Address prediction**: each deployed address equals `vm.computeCreateAddress(deployer, nonce + i)`.
- **Post-flight**: every immutable on the launchpad, treasury, governor and token factory points where it should;
  the fee recipient, `graduationEth` and `creationFee` match the inputs; and `nationCount() == 0`.

### Deployment record

`Deploy.s.sol` writes the record with `vm.writeJson` (`foundry.toml` grants read-write access to `./deployments`).
Only a broadcast run (`vm.isContext` reports `ScriptBroadcast` or `ScriptResume`) writes
`contracts/deployments/<chainId>.json`, which on Robinhood Chain mainnet is **`contracts/deployments/4663.json`**. A
run without `--broadcast` writes the predicted addresses to `contracts/deployments/<chainId>.dry-run.json` instead
(gitignored) and logs `DRY RUN (nothing deployed); predicted addresses at …`. Keys (Foundry writes them in
alphabetical order):

```json
{
  "chainId": 4663,
  "creationFeeWei": "<wei, decimal string>",
  "deployedAtBlock": <number>,
  "deployedAtTimestamp": <unix seconds>,
  "deployer": "<address>",
  "governor": "<AtlasGovernor address>",
  "graduationEthWei": "<wei, decimal string>",
  "launchpad": "<AtlasLaunchpad address>",
  "protocolFeeRecipient": "<address>",
  "tokenFactory": "<NationTokenFactory address>",
  "treasury": "<NationTreasury address>",
  "uniswapV2Factory": "<address>",
  "uniswapV2Router": "<address>",
  "weth": "<address>"
}
```

Notes on the record:

- `deployedAtBlock` and `deployedAtTimestamp` are the `block.number` and `block.timestamp` the script saw before
  broadcasting. The contracts land a few blocks later, but `block.number` semantics differ on Arbitrum-based
  chains, so take the indexer's `ATLAS_DEPLOY_BLOCK` from the broadcast receipts under `contracts/broadcast/` (or
  the explorer) rather than from this field.
- A dry run never writes or overwrites `<chainId>.json`, so simulated addresses cannot end up in the deployment
  record. Always run `VerifyDeployment.s.sol` against the live chain after a broadcast.
- **Current state:** the repository contains only `contracts/deployments/31337.json`, a local anvil deployment that
  `.gitignore` excludes. **No `4663.json` exists. The mainnet deployment has not been performed, and no mainnet
  addresses are recorded.**

### `VerifyDeployment.s.sol`

`forge script script/VerifyDeployment.s.sol --rpc-url robinhood` reads `deployments/<chainId>.json` and checks,
without sending transactions:

- the chain id matches, and the launchpad, governor and treasury have code
- the launchpad's factory and WETH match the record, and `router.factory()` and `router.WETH()` match
- all cross-references between launchpad, treasury and governor are correct, and the fee recipient and token
  factory match the record
- **treasury solvency**: `treasury.balance >= totalHeld()`
- **launchpad solvency**: `launchpad.balance >= Σ getNation(i).realEth + protocolFeesAccrued()` over every nation

It then logs the nation count, proposal count and treasury ETH held. The solvency checks use `>=` because ETH can
be forced into any contract (for example through `SELFDESTRUCT`) without passing through its accounting, so
force-sent ETH cannot make verification fail.

### `SmokeTest.s.sol`

```bash
SMOKE_NAME="Atlas Test" SMOKE_SYMBOL=ATEST SMOKE_CONFIRM=I_UNDERSTAND \
forge script script/SmokeTest.s.sol --rpc-url robinhood --account deployer --broadcast
```

Reads the launchpad address from the deployment record, then:

1. Founds a nation with theme 6, a supply of 1,000,000,000 tokens and a founder allocation of 0, paying
   `creationFee + SMOKE_INITIAL_BUY_WEI` (default 0.0001 ETH).
2. Buys again with `SMOKE_BUY_WEI` (default 0.0002 ETH).
3. Approves and sells half of its balance.
4. Asserts the founder, remaining balance and voting power (auto-delegation).

Every trade in the script (the founding buy, the second buy and the sell) uses a minimum output of 0. The second
buy and the sell use a 10-minute deadline. The nation, its name and its symbol are permanent. Defaults are
`"Atlas Smoke Test"` and `SMOKE`.

### Local development

```bash
anvil &
cd contracts
forge script script/DeployLocal.s.sol --rpc-url local --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil's public dev key
```

`scripts/dev-local.sh` at the repository root wraps a full local stack: anvil, deployment and seeding through
`apps/indexer/scripts/seed-local.ts`, then the indexer and the web app.

---

## 13. Build and test

Toolchain (`contracts/foundry.toml`, `contracts/foundry.lock`):

- Solidity `0.8.28`, `evm_version = "cancun"`, optimizer on with 200 runs, `via_ir = false`
- `bytecode_hash = "none"`, `cbor_metadata = false`
- Dependencies (git submodules): `forge-std` v1.9.7 and OpenZeppelin Contracts v5.6.1
- Fuzz runs: 512 by default, 4,096 with `FOUNDRY_PROFILE=ci`. Invariant settings are Foundry's defaults.

```bash
git submodule update --init --recursive   # first checkout only
cd contracts
forge build
forge test                       # or: pnpm contracts:test (forge test -vv) from the repo root
FOUNDRY_PROFILE=ci forge test    # more fuzz runs
forge build --sizes
```

After contract changes, regenerate the TypeScript ABIs with `pnpm contracts:abi`, which writes
`packages/shared/src/abis/generated.ts` from `contracts/out`. When this document was written, the generated ABIs
matched the compiled output.

### Test results

`forge test` on 2026-10-06: **107 tests passed, 0 failed, 0 skipped** across 10 test suites in 6 files.

| File | Suite | Tests | Coverage |
|---|---|---|---|
| `test/AtlasLaunchpad.t.sol` | `AtlasLaunchpadDeploymentTest` | 5 | Immutable wiring; constructor bounds (zero addresses, graduation bounds, creation fee cap); factory is launchpad-only |
| | `AtlasLaunchpadFoundingTest` | 18 | Founding state and events; curve shape against the derivation; founder allocation; initial buy, its 10% cap and slippage; creation fee; case-insensitive name and symbol uniqueness; name, symbol, theme, supply and text validation; minimum and maximum supply (graduation at max supply); founding when the pair was pre-created |
| | `AtlasLaunchpadTradingTest` | 18 | Buys match quotes; fee split; `Trade` event; price increases; sells and fees; `sellWithPermit`; deadline, slippage and zero-amount reverts; unknown nation; selling without approval; founder tokens cannot be claimed (and so cannot be sold into the curve) before graduation; selling back everything the curve sold restores the curve; isolation between nations; protocol fee withdrawal; `setNationSymbol` access; 2 fuzz tests (round trip never profits, quote matches execution) |
| | `AtlasLaunchpadGraduationTest` | 7 | Uniswap seeding, LP burned to `DEAD`, price continuity; refund on the graduating buy; `NationGraduated` event; curve closed after graduation; Uniswap trading after graduation; donated WETH only raises the price; pool seeding blocked before graduation |
| | `AtlasLaunchpadFounderVestingTest` | 4 | Linear vesting and claims (the claim tests graduate the nation first); nothing vested; only the founder can claim; vesting continues after graduation |
| | `AtlasLaunchpadSecurityTest` | 5 | Re-entrancy on sell and on the graduation refund blocked; no minting possible; name collisions; price monotonic and `k` never decreasing |
| `test/AtlasGovernor.t.sol` | `AtlasGovernorTest` | 28 | Snapshot and quorum recording; Treasury timing; threshold (including tokens acquired in the same second); unknown nation; invalid, unknown and malformed payloads; description length; vote weights; double voting; tokens bought or transferred after the snapshot; support and reason validation; voting closed; defeat by missing quorum and by tie; abstain counts toward quorum; full Treasury lifecycle with timelock; release cap at execution; expiry; Symbol proposals; game action events; alliance lifecycle; cancel; unknown proposal; threshold view; flash buys cannot vote |
| `test/NationTreasury.t.sol` | `NationTreasuryTest` | 10 | Trade fees accrue; donations; unknown nation and zero deposit; direct ETH transfers rejected; release restricted to the governor; release cap and accounting; invalid recipient and amount; recipient rejecting ETH; isolation between nations |
| `test/NationToken.t.sol` | `NationTokenTest` | 8 | Metadata and timestamp clock; system addresses never delegated; auto-delegation; explicit delegation kept; past votes by timestamp; `markGraduated` only once; pair lock lifted after graduation; fuzz test of supply and vote conservation on transfers |
| `test/Invariants.t.sol` | `InvariantsTest` | 4 | Stateful invariants over three nations of different sizes and founder shares, driven by `LaunchpadHandler` (buy, sell, donate, warp, claimFounder; `claimFounder` claims only for graduated nations): `invariant_EthSolvency`, `invariant_TreasurySolvency`, `invariant_TokenCustody`, `invariant_RealEthMatchesVirtual` |

Supporting files: `test/Base.t.sol` (shared fixture that mirrors the address prediction in `Deploy.s.sol`; 2 ETH
graduation, 0.001 ETH creation fee, 1,000,000,000 supply), `test/mocks/WETH9.sol` and `test/mocks/UniswapV2.sol`
(local Uniswap V2 port).

Note on the invariant run: in Foundry's call table for `InvariantsTest`, every handler action (`buy`, `sell`,
`donate`, `warp`, `claimFounder`) executes with 0 reverts, so the invariant run exercises voluntary treasury donations
as well as trade-fee deposits.
