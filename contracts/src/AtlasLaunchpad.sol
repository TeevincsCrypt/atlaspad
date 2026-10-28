// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NationToken} from "./NationToken.sol";
import {NationTokenFactory} from "./NationTokenFactory.sol";
import {IUniswapV2Pair} from "./interfaces/IUniswapV2Pair.sol";
import {INationTreasury} from "./interfaces/INationTreasury.sol";

/// @title AtlasLaunchpad
/// @notice Founds AtlasPad nations: deploys each nation's ERC-20, sells it for $WIF on a constant-product bonding
/// curve with virtual reserves, and — once the curve allocation sells out — migrates the raised $WIF plus the
/// reserved liquidity tokens into a nation/WIF Uniswap V2 pool whose LP tokens are burned (permanently locked).
///
/// $WIF is the only currency of AtlasPad: founding, buying, selling, fees, treasuries and graduated liquidity are
/// all denominated in $WIF. Every trade burns $WIF, every founding burns $WIF, and every graduated nation locks
/// its raised $WIF in a pool forever.
///
/// Trust model (no admin):
///  - No owner, no pause, no upgrade path. Every parameter is immutable or a compile-time constant.
///  - `protocolFeeRecipient` (immutable) receives the protocol share of the trade fee. Anyone may trigger the
///    payout; nobody can redirect it.
///  - The treasury share of the trade fee is deposited into the nation's account in `NationTreasury`, which only
///    releases funds through passed on-chain governance proposals of that nation's token holders.
///  - The burn share of the trade fee and the whole creation fee are sent to the dead address in the same
///    transaction. Nobody can recover them.
///  - `setNationSymbol` is callable only by the immutable `AtlasGovernor` (i.e. by a passed proposal).
contract AtlasLaunchpad is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants (disclosed in CONTRACTS.md and in the app before every transaction)
    // ---------------------------------------------------------------------------------------------

    uint256 public constant BPS = 10_000;
    /// @notice Total trade fee on bonding-curve trades, charged in $WIF: 1%.
    uint256 public constant TRADE_FEE_BPS = 100;
    /// @notice Share of trade value that goes to the nation treasury: 0.5%.
    uint256 public constant TREASURY_FEE_BPS = 50;
    /// @notice Share of trade value that is burned: 0.25%.
    uint256 public constant BURN_FEE_BPS = 25;
    /// @notice Share of trade value that goes to the protocol: 0.25%.
    uint256 public constant PROTOCOL_FEE_BPS = 25;
    /// @notice Share of total supply reserved for Uniswap V2 liquidity at graduation: 20%.
    uint256 public constant LP_RESERVE_BPS = 2_000;
    /// @notice Maximum founder allocation: 5% of supply, linearly vested.
    uint256 public constant MAX_FOUNDER_BPS = 500;
    /// @notice Founder allocation vesting duration (linear, starting at founding).
    uint256 public constant FOUNDER_VESTING = 30 days;
    /// @notice Maximum share of supply the founder may buy in the founding transaction: 10%.
    uint256 public constant MAX_INITIAL_BUY_BPS = 1_000;
    /// @notice Supply bounds, in whole tokens (18 decimals).
    uint256 public constant MIN_SUPPLY = 1_000_000 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 ether;
    /// @notice Bounds for the graduation target, in $WIF base units. Keeps curve math far from overflow.
    uint256 public constant MIN_GRADUATION_WIF = 1e6;
    uint256 public constant MAX_GRADUATION_WIF = 1e36;
    /// @notice Number of supported themes (Medieval, Cyberpunk, Space, Ocean, Jungle, Meme, AI, Fantasy).
    uint8 public constant THEME_COUNT = 8;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------------------------------

    address public immutable uniswapV2Factory;
    /// @notice The $WIF token: the currency of every nation's curve, treasury and Uniswap pool.
    IERC20 public immutable wif;
    INationTreasury public immutable treasury;
    address public immutable governor;
    address public immutable protocolFeeRecipient;
    /// @notice $WIF (base units) the curve raises before graduating. Determines curve shape for every nation.
    uint256 public immutable graduationWif;
    /// @notice Flat fee ($WIF base units) charged to found a nation. Burned in full. May be zero.
    uint256 public immutable creationFee;
    /// @notice Helper that deploys NationToken contracts; created in this constructor, usable only by this contract.
    NationTokenFactory public immutable tokenFactory;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    struct Nation {
        address token;
        address founder;
        address pair;
        uint64 createdAt;
        uint64 graduatedAt;
        uint8 theme;
        bool graduated;
        uint256 emblem;
        uint256 totalSupply;
        uint256 curveSupply; // tokens sold through the curve
        uint256 lpReserve; // tokens paired with raised $WIF at graduation
        uint256 founderAllocation; // vested to founder over FOUNDER_VESTING
        uint256 founderClaimed;
        uint256 initialVirtualWif;
        uint256 virtualWif; // includes real $WIF raised
        uint256 virtualTokens;
        uint256 realWif; // $WIF actually held for this nation's curve
        uint256 curveTokensRemaining;
    }

    struct FoundingParams {
        string name;
        string symbol;
        string description;
        string metadataURI;
        uint8 theme;
        uint256 emblem;
        uint256 totalSupply;
        uint16 founderBps;
        uint256 initialBuyWif; // optional founder buy, in $WIF (fee included)
        uint256 minTokensOut; // slippage bound for the optional initial buy
    }

    uint256 public nationCount;
    mapping(uint256 nationId => Nation) internal _nations;
    mapping(address token => uint256 nationId) public nationIdOfToken;
    mapping(uint256 nationId => string) public metadataURIOf;
    mapping(bytes32 nameKey => bool) public nameTaken;
    mapping(bytes32 symbolKey => bool) public symbolTaken;

    /// @notice Protocol fees accrued and not yet paid out, in $WIF.
    uint256 public protocolFeesAccrued;
    /// @notice Total $WIF burned by AtlasPad (creation fees + burn share of trade fees).
    uint256 public totalWifBurned;
    /// @notice $WIF burned on behalf of each nation (its creation fee + the burn share of its trades).
    mapping(uint256 nationId => uint256) public wifBurnedOf;
    /// @notice Total $WIF permanently locked in graduated nation/WIF pools.
    uint256 public totalWifLocked;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event NationFounded(
        uint256 indexed nationId,
        address indexed token,
        address indexed founder,
        string name,
        string symbol,
        uint8 theme,
        uint256 emblem,
        string description,
        string metadataURI
    );
    event CurveInitialized(
        uint256 indexed nationId,
        address pair,
        uint256 totalSupply,
        uint256 curveSupply,
        uint256 lpReserve,
        uint256 founderAllocation,
        uint256 virtualWif,
        uint256 virtualTokens
    );
    event Trade(
        uint256 indexed nationId,
        address indexed trader,
        bool isBuy,
        uint256 wifAmount, // buy: $WIF paid incl. fee; sell: $WIF received after fee
        uint256 tokenAmount,
        uint256 fee, // total fee in $WIF: treasury, burn and protocol shares
        uint256 virtualWif,
        uint256 virtualTokens,
        uint256 realWif,
        uint256 curveTokensRemaining
    );
    event WifBurned(uint256 indexed nationId, uint256 amount, bool creationFee);
    event NationGraduated(
        uint256 indexed nationId, address indexed pair, uint256 wifLiquidity, uint256 tokenLiquidity, uint256 lpBurned
    );
    event FounderTokensClaimed(uint256 indexed nationId, address indexed founder, uint256 amount);
    event NationSymbolUpdated(uint256 indexed nationId, uint256 emblem, string metadataURI);
    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error InvalidConfig();
    error InvalidName();
    error InvalidSymbol();
    error InvalidTheme();
    error InvalidSupply();
    error InvalidFounderBps();
    error TextTooLong();
    error NameTaken();
    error SymbolTaken();
    error InitialBuyTooLarge();
    error UnknownNation();
    error NationGraduatedAlready();
    error ZeroAmount();
    error Slippage();
    error Expired();
    error InsufficientCurveLiquidity();
    error UnsupportedToken();
    error OnlyGovernor();
    error NothingToClaim();
    error NotFounder();
    error NotGraduated();

    constructor(
        address uniswapV2Factory_,
        address wif_,
        address treasury_,
        address governor_,
        address protocolFeeRecipient_,
        uint256 graduationWif_,
        uint256 creationFee_
    ) {
        if (
            uniswapV2Factory_ == address(0) || wif_ == address(0) || treasury_ == address(0)
                || governor_ == address(0) || protocolFeeRecipient_ == address(0)
        ) revert InvalidConfig();
        if (graduationWif_ < MIN_GRADUATION_WIF || graduationWif_ > MAX_GRADUATION_WIF) revert InvalidConfig();
        if (creationFee_ > graduationWif_) revert InvalidConfig();
        uniswapV2Factory = uniswapV2Factory_;
        wif = IERC20(wif_);
        treasury = INationTreasury(treasury_);
        governor = governor_;
        protocolFeeRecipient = protocolFeeRecipient_;
        graduationWif = graduationWif_;
        creationFee = creationFee_;
        tokenFactory = new NationTokenFactory();
        // The treasury pulls the treasury share of each trade fee from this contract.
        IERC20(wif_).forceApprove(treasury_, type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------
    // Founding
    // ---------------------------------------------------------------------------------------------

    /// @notice Found a nation. Requires $WIF approval for `creationFee + p.initialBuyWif`. The creation fee is
    /// burned; `p.initialBuyWif` (if non-zero) is the founder's initial buy on the curve (capped at
    /// MAX_INITIAL_BUY_BPS of supply).
    function foundNation(FoundingParams calldata p) external nonReentrant returns (uint256 nationId, address token) {
        _validateText(p);
        if (p.theme >= THEME_COUNT) revert InvalidTheme();
        if (p.totalSupply < MIN_SUPPLY || p.totalSupply > MAX_SUPPLY || p.totalSupply % 1 ether != 0) {
            revert InvalidSupply();
        }
        if (p.founderBps > MAX_FOUNDER_BPS) revert InvalidFounderBps();

        bytes32 nameKey = keccak256(_lower(bytes(p.name)));
        bytes32 symbolKey = keccak256(bytes(p.symbol));
        if (nameTaken[nameKey]) revert NameTaken();
        if (symbolTaken[symbolKey]) revert SymbolTaken();
        nameTaken[nameKey] = true;
        symbolTaken[symbolKey] = true;

        nationId = ++nationCount;
        token = tokenFactory.deploy(p.name, p.symbol, nationId, p.totalSupply, uniswapV2Factory, address(wif));
        nationIdOfToken[token] = nationId;

        Nation storage n = _nations[nationId];
        n.token = token;
        n.founder = msg.sender;
        n.pair = NationToken(token).pair();
        n.createdAt = uint64(block.timestamp);
        n.theme = p.theme;
        n.emblem = p.emblem;
        n.totalSupply = p.totalSupply;
        _initCurve(n, p.founderBps);
        metadataURIOf[nationId] = p.metadataURI;
        _emitFounded(nationId, n, p);

        if (creationFee > 0) {
            wif.safeTransferFrom(msg.sender, DEAD, creationFee);
            _recordBurn(nationId, creationFee, true);
        }

        if (p.initialBuyWif > 0) {
            uint256 bought = _buy(nationId, n, msg.sender, p.initialBuyWif, p.minTokensOut);
            if (bought > (p.totalSupply * MAX_INITIAL_BUY_BPS) / BPS) revert InitialBuyTooLarge();
        }
    }

    function _emitFounded(uint256 nationId, Nation storage n, FoundingParams calldata p) internal {
        emit NationFounded(
            nationId, n.token, n.founder, p.name, p.symbol, p.theme, p.emblem, p.description, p.metadataURI
        );
        emit CurveInitialized(
            nationId,
            n.pair,
            n.totalSupply,
            n.curveSupply,
            n.lpReserve,
            n.founderAllocation,
            n.virtualWif,
            n.virtualTokens
        );
    }

    /// @dev Virtual reserves are chosen so that the curve's final price equals the Uniswap V2 opening price
    /// (raised $WIF / LP reserve). With C = curve supply, L = LP reserve and R = graduationWif:
    ///   virtualTokens0 = C² / (C − L),  virtualWif0 = R·L / (C − L).
    /// See GAME_MECHANICS.md / CONTRACTS.md for the derivation.
    function _initCurve(Nation storage n, uint16 founderBps) internal {
        uint256 supply = n.totalSupply;
        uint256 lp = (supply * LP_RESERVE_BPS) / BPS;
        uint256 founder = (supply * founderBps) / BPS;
        uint256 curve = supply - lp - founder;
        n.lpReserve = lp;
        n.founderAllocation = founder;
        n.curveSupply = curve;
        n.curveTokensRemaining = curve;
        uint256 vTokens = (curve * curve) / (curve - lp);
        uint256 vWif = (graduationWif * lp) / (curve - lp);
        n.virtualTokens = vTokens;
        n.virtualWif = vWif;
        n.initialVirtualWif = vWif;
    }

    // ---------------------------------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------------------------------

    /// @notice Buy nation tokens with $WIF on the bonding curve. Requires $WIF approval for `wifIn`. If the
    /// purchase sells out the curve, only the $WIF needed is pulled and the nation graduates to Uniswap V2 in the
    /// same transaction.
    function buy(uint256 nationId, uint256 wifIn, uint256 minTokensOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Nation storage n = _nationStorage(nationId);
        tokensOut = _buy(nationId, n, msg.sender, wifIn, minTokensOut);
    }

    /// @notice Sell nation tokens back to the bonding curve for $WIF. Requires prior ERC-20 approval.
    function sell(uint256 nationId, uint256 tokensIn, uint256 minWifOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 wifOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Nation storage n = _nationStorage(nationId);
        wifOut = _sell(nationId, n, tokensIn, minWifOut);
    }

    /// @notice Sell using an EIP-2612 permit signature instead of a separate approval transaction.
    /// If the permit was already consumed (e.g. front-run), the sell proceeds when allowance suffices.
    function sellWithPermit(
        uint256 nationId,
        uint256 tokensIn,
        uint256 minWifOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 wifOut) {
        if (block.timestamp > deadline) revert Expired();
        Nation storage n = _nationStorage(nationId);
        try IERC20Permit(n.token).permit(msg.sender, address(this), tokensIn, deadline, v, r, s) {} catch {}
        wifOut = _sell(nationId, n, tokensIn, minWifOut);
    }

    struct BuyQuote {
        uint256 tokensOut;
        uint256 netWif; // $WIF added to the curve
        uint256 fee; // total fee
        uint256 wifUsed; // netWif + fee: what the buyer actually pays
        bool graduates;
    }

    struct SellQuote {
        uint256 grossWif; // $WIF removed from the curve
        uint256 fee;
        uint256 wifOut; // grossWif - fee
    }

    function _quoteBuy(Nation storage n, uint256 wifIn) internal view returns (BuyQuote memory q) {
        q.fee = (wifIn * TRADE_FEE_BPS) / BPS;
        q.netWif = wifIn - q.fee;
        q.wifUsed = wifIn;
        uint256 vWif = n.virtualWif;
        uint256 vTok = n.virtualTokens;
        uint256 k = vWif * vTok;
        q.tokensOut = vTok - Math.ceilDiv(k, vWif + q.netWif);
        if (q.tokensOut >= n.curveTokensRemaining) {
            // Cap at the remaining curve supply and charge only the $WIF needed for it.
            q.tokensOut = n.curveTokensRemaining;
            q.netWif = Math.ceilDiv(k, vTok - q.tokensOut) - vWif;
            uint256 gross = Math.ceilDiv(q.netWif * BPS, BPS - TRADE_FEE_BPS);
            if (gross > wifIn) gross = wifIn; // rounding guard; netWif <= wifIn - original fee
            q.fee = gross - q.netWif;
            q.wifUsed = gross;
            q.graduates = true;
        }
    }

    function _quoteSell(Nation storage n, uint256 tokensIn) internal view returns (SellQuote memory q) {
        uint256 newVWif = Math.ceilDiv(n.virtualWif * n.virtualTokens, n.virtualTokens + tokensIn);
        q.grossWif = n.virtualWif - newVWif;
        q.fee = (q.grossWif * TRADE_FEE_BPS) / BPS;
        q.wifOut = q.grossWif - q.fee;
    }

    function _buy(uint256 nationId, Nation storage n, address buyer, uint256 wifIn, uint256 minTokensOut)
        internal
        returns (uint256)
    {
        if (n.graduated) revert NationGraduatedAlready();
        if (wifIn == 0) revert ZeroAmount();
        BuyQuote memory q = _quoteBuy(n, wifIn);
        if (q.tokensOut == 0) revert ZeroAmount();
        if (q.tokensOut < minTokensOut) revert Slippage();

        _pullWif(buyer, q.wifUsed);
        n.virtualWif += q.netWif;
        n.virtualTokens -= q.tokensOut;
        n.realWif += q.netWif;
        n.curveTokensRemaining -= q.tokensOut;
        _emitTrade(nationId, n, buyer, true, q.wifUsed, q.tokensOut, q.fee);

        IERC20(n.token).safeTransfer(buyer, q.tokensOut);
        _distributeFee(nationId, q.fee);
        if (q.graduates) _graduate(nationId, n);
        return q.tokensOut;
    }

    function _sell(uint256 nationId, Nation storage n, uint256 tokensIn, uint256 minWifOut)
        internal
        returns (uint256)
    {
        if (n.graduated) revert NationGraduatedAlready();
        if (tokensIn == 0) revert ZeroAmount();
        // Only tokens that were sold by the curve can be sold back into it, keeping every nation's $WIF reserve
        // isolated. Founder-allocation tokens never reach the curve: they are claimable only after graduation.
        if (n.curveTokensRemaining + tokensIn > n.curveSupply) revert InsufficientCurveLiquidity();
        SellQuote memory q = _quoteSell(n, tokensIn);
        if (q.grossWif > n.realWif) revert InsufficientCurveLiquidity();
        if (q.wifOut == 0) revert ZeroAmount();
        if (q.wifOut < minWifOut) revert Slippage();

        n.virtualWif -= q.grossWif;
        n.virtualTokens += tokensIn;
        n.realWif -= q.grossWif;
        n.curveTokensRemaining += tokensIn;
        _emitTrade(nationId, n, msg.sender, false, q.wifOut, tokensIn, q.fee);

        IERC20(n.token).safeTransferFrom(msg.sender, address(this), tokensIn);
        _distributeFee(nationId, q.fee);
        wif.safeTransfer(msg.sender, q.wifOut);
        return q.wifOut;
    }

    /// @dev Splits a trade fee: TREASURY_FEE_BPS to the nation treasury, BURN_FEE_BPS burned, rest to protocol.
    function _distributeFee(uint256 nationId, uint256 fee) internal {
        if (fee == 0) return;
        uint256 treasuryFee = (fee * TREASURY_FEE_BPS) / TRADE_FEE_BPS;
        uint256 burnFee = (fee * BURN_FEE_BPS) / TRADE_FEE_BPS;
        protocolFeesAccrued += fee - treasuryFee - burnFee;
        if (treasuryFee > 0) treasury.deposit(nationId, treasuryFee);
        if (burnFee > 0) {
            wif.safeTransfer(DEAD, burnFee);
            _recordBurn(nationId, burnFee, false);
        }
    }

    function _recordBurn(uint256 nationId, uint256 amount, bool isCreationFee) internal {
        totalWifBurned += amount;
        wifBurnedOf[nationId] += amount;
        emit WifBurned(nationId, amount, isCreationFee);
    }

    /// @dev Pulls exactly `amount` $WIF. Fee-on-transfer or rebasing tokens would break per-nation accounting, so
    /// a short receipt reverts.
    function _pullWif(address from, uint256 amount) internal {
        uint256 before = wif.balanceOf(address(this));
        wif.safeTransferFrom(from, address(this), amount);
        if (wif.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
    }

    function _emitTrade(
        uint256 nationId,
        Nation storage n,
        address trader,
        bool isBuy,
        uint256 wifAmount,
        uint256 tokenAmount,
        uint256 fee
    ) internal {
        emit Trade(
            nationId,
            trader,
            isBuy,
            wifAmount,
            tokenAmount,
            fee,
            n.virtualWif,
            n.virtualTokens,
            n.realWif,
            n.curveTokensRemaining
        );
    }

    /// @dev Seeds the nation/WIF Uniswap V2 pool directly ($WIF + tokens transferred to the pair, then `mint` to
    /// the burn address). Unsolicited $WIF sitting in the pair only raises the opening price and is locked with
    /// the rest of the liquidity; the nation token cannot be sent to the pair before `markGraduated`.
    function _graduate(uint256 nationId, Nation storage n) internal {
        uint256 wifLiquidity = n.realWif;
        uint256 tokenLiquidity = n.lpReserve;
        n.graduated = true;
        n.graduatedAt = uint64(block.timestamp);
        n.realWif = 0;
        n.lpReserve = 0;
        totalWifLocked += wifLiquidity;

        NationToken(n.token).markGraduated();
        wif.safeTransfer(n.pair, wifLiquidity);
        IERC20(n.token).safeTransfer(n.pair, tokenLiquidity);
        uint256 lpBurned = IUniswapV2Pair(n.pair).mint(DEAD);

        emit NationGraduated(nationId, n.pair, wifLiquidity, tokenLiquidity, lpBurned);
    }

    // ---------------------------------------------------------------------------------------------
    // Founder vesting, governance hooks, protocol fees
    // ---------------------------------------------------------------------------------------------

    /// @notice Founder allocation that has vested so far (claimed or not).
    function vestedFounderTokens(uint256 nationId) public view returns (uint256) {
        Nation storage n = _nationStorage(nationId);
        uint256 elapsed = block.timestamp - n.createdAt;
        if (elapsed >= FOUNDER_VESTING) return n.founderAllocation;
        return (n.founderAllocation * elapsed) / FOUNDER_VESTING;
    }

    /// @notice Transfer the vested, unclaimed founder allocation to the founder. Vesting runs from founding, but
    /// tokens can be claimed only once the nation has graduated, so they can never be sold back into the bonding
    /// curve against $WIF paid by other buyers; after graduation they trade on Uniswap like anyone else's.
    function claimFounderTokens(uint256 nationId) external nonReentrant returns (uint256 amount) {
        Nation storage n = _nationStorage(nationId);
        if (msg.sender != n.founder) revert NotFounder();
        if (!n.graduated) revert NotGraduated();
        amount = vestedFounderTokens(nationId) - n.founderClaimed;
        if (amount == 0) revert NothingToClaim();
        n.founderClaimed += amount;
        IERC20(n.token).safeTransfer(n.founder, amount);
        emit FounderTokensClaimed(nationId, n.founder, amount);
    }

    /// @notice Change a nation's emblem / metadata URI. Only callable by AtlasGovernor after a passed proposal.
    function setNationSymbol(uint256 nationId, uint256 emblem, string calldata metadataURI) external {
        if (msg.sender != governor) revert OnlyGovernor();
        Nation storage n = _nationStorage(nationId);
        if (bytes(metadataURI).length > 200) revert TextTooLong();
        n.emblem = emblem;
        metadataURIOf[nationId] = metadataURI;
        emit NationSymbolUpdated(nationId, emblem, metadataURI);
    }

    /// @notice Pay accrued protocol fees ($WIF) to the immutable `protocolFeeRecipient`. Callable by anyone.
    function withdrawProtocolFees() external nonReentrant {
        uint256 amount = protocolFeesAccrued;
        if (amount == 0) revert NothingToClaim();
        protocolFeesAccrued = 0;
        wif.safeTransfer(protocolFeeRecipient, amount);
        emit ProtocolFeesWithdrawn(protocolFeeRecipient, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getNation(uint256 nationId) external view returns (Nation memory) {
        return _nationStorage(nationId);
    }

    function tokenOf(uint256 nationId) external view returns (address) {
        return _nations[nationId].token;
    }

    /// @notice Spot price in $WIF base units per whole token (1e18 units), from the curve's virtual reserves.
    function spotPrice(uint256 nationId) external view returns (uint256) {
        Nation storage n = _nationStorage(nationId);
        return (n.virtualWif * 1 ether) / n.virtualTokens;
    }

    /// @notice Quote a curve buy. Returns tokens received, fee charged and $WIF actually used (pulled).
    function quoteBuy(uint256 nationId, uint256 wifIn)
        external
        view
        returns (uint256 tokensOut, uint256 fee, uint256 wifUsed, bool graduates)
    {
        Nation storage n = _nationStorage(nationId);
        if (n.graduated || wifIn == 0) return (0, 0, 0, false);
        BuyQuote memory q = _quoteBuy(n, wifIn);
        return (q.tokensOut, q.fee, q.wifUsed, q.graduates);
    }

    /// @notice Quote a curve sell. Returns $WIF received after fee and the fee. Zero if not sellable.
    function quoteSell(uint256 nationId, uint256 tokensIn) external view returns (uint256 wifOut, uint256 fee) {
        Nation storage n = _nationStorage(nationId);
        if (n.graduated || tokensIn == 0 || n.curveTokensRemaining + tokensIn > n.curveSupply) return (0, 0);
        SellQuote memory q = _quoteSell(n, tokensIn);
        if (q.grossWif > n.realWif) return (0, 0);
        return (q.wifOut, q.fee);
    }

    /// @notice $WIF still needed (fee included) to sell out the curve and graduate the nation.
    function wifToGraduate(uint256 nationId) external view returns (uint256) {
        Nation storage n = _nationStorage(nationId);
        if (n.graduated) return 0;
        uint256 k = n.virtualWif * n.virtualTokens;
        uint256 netWif = Math.ceilDiv(k, n.virtualTokens - n.curveTokensRemaining) - n.virtualWif;
        return Math.ceilDiv(netWif * BPS, BPS - TRADE_FEE_BPS);
    }

    function isNameAvailable(string calldata name) external view returns (bool) {
        return !nameTaken[keccak256(_lower(bytes(name)))];
    }

    function isSymbolAvailable(string calldata symbol) external view returns (bool) {
        return !symbolTaken[keccak256(bytes(symbol))];
    }

    // ---------------------------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------------------------

    function _nationStorage(uint256 nationId) internal view returns (Nation storage n) {
        n = _nations[nationId];
        if (n.token == address(0)) revert UnknownNation();
    }

    /// @dev Name: 2-32 printable ASCII chars, letters/digits/space/.-' only, no leading/trailing/double spaces.
    /// Symbol: 2-10 chars of A-Z / 0-9. Description <= 280 bytes, metadata URI <= 200 bytes.
    function _validateText(FoundingParams calldata p) internal pure {
        bytes memory name = bytes(p.name);
        if (name.length < 2 || name.length > 32) revert InvalidName();
        if (name[0] == 0x20 || name[name.length - 1] == 0x20) revert InvalidName();
        for (uint256 i; i < name.length; ++i) {
            bytes1 c = name[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x20
                || c == 0x2D || c == 0x2E || c == 0x27;
            if (!ok) revert InvalidName();
            if (c == 0x20 && i > 0 && name[i - 1] == 0x20) revert InvalidName();
        }
        bytes memory symbol = bytes(p.symbol);
        if (symbol.length < 2 || symbol.length > 10) revert InvalidSymbol();
        for (uint256 i; i < symbol.length; ++i) {
            bytes1 c = symbol[i];
            if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A))) revert InvalidSymbol();
        }
        if (bytes(p.description).length > 280 || bytes(p.metadataURI).length > 200) revert TextTooLong();
    }

    function _lower(bytes memory s) internal pure returns (bytes memory out) {
        out = new bytes(s.length);
        for (uint256 i; i < s.length; ++i) {
            bytes1 c = s[i];
            out[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
    }
}
