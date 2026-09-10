// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title FounderExitVault
/// @notice Holds disclosed founder allocations and realizes fixed tranches only when
///         a swap can return a minimum amount of Base USDC. Sale proceeds always go
///         to the immutable beneficiary; the automation executor cannot redirect them.
/// @dev Designed for Clanker-style fixed-supply tokens. A production deployment must
///      use a verified Base router address and be reviewed before mainnet use.
contract FounderExitVault {
    error Unauthorized();
    error Reentrant();
    error NoMoreTranches();
    error InsufficientFounderTokens();
    error RouterCallFailed();
    error TokenSpendMismatch();
    error MinimumOutputNotMet();
    error TransferFailed();
    error InvalidAddress();

    address public immutable beneficiary;
    address public immutable baseUsdc;
    address public immutable router;
    address public executor;

    // Total founder allocation is 10% of total token supply.
    uint256 public constant FOUNDER_BPS = 1_000;
    uint256 public constant BPS = 10_000;
    uint256 public constant INITIAL_MARKET_CAP_USDC = 10_000e6;
    uint256 public constant OUTPUT_HAIRCUT_BPS = 7_500; // require >=75% of milestone notional

    // Sell percentages are percentages of the 10% founder allocation, not total supply.
    uint16[6] public trancheFounderBps = [500, 1000, 1500, 2000, 2000, 1500];
    uint16[6] public priceMultiples = [3, 5, 10, 20, 50, 100];
    mapping(address token => uint8 nextTranche) public nextTranche;

    uint256 private _entered;

    event ExecutorChanged(address indexed oldExecutor, address indexed newExecutor);
    event ExitExecuted(
        address indexed token,
        uint8 indexed tranche,
        uint256 tokenAmount,
        uint256 usdcOut,
        uint256 minimumUsdcOut
    );

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor && msg.sender != beneficiary) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address beneficiary_, address executor_, address baseUsdc_, address router_) {
        if (beneficiary_ == address(0) || executor_ == address(0) || baseUsdc_ == address(0) || router_ == address(0)) {
            revert InvalidAddress();
        }
        beneficiary = beneficiary_;
        executor = executor_;
        baseUsdc = baseUsdc_;
        router = router_;
    }

    /// @notice Beneficiary can rotate the automation executor without changing where proceeds go.
    function setExecutor(address newExecutor) external onlyBeneficiary {
        if (newExecutor == address(0)) revert InvalidAddress();
        emit ExecutorChanged(executor, newExecutor);
        executor = newExecutor;
    }

    /// @notice Minimum Base USDC that must arrive for the next tranche to succeed.
    /// @dev Uses actual total supply, so the threshold is tied to the token's original
    ///      $10k starting-market-cap model and the predefined milestone multiple.
    function minimumUsdcOut(address token) public view returns (uint256) {
        uint8 i = nextTranche[token];
        if (i >= trancheFounderBps.length) return type(uint256).max;
        uint256 supply = IERC20Minimal(token).totalSupply();
        uint256 founderAllocation = (supply * FOUNDER_BPS) / BPS;
        uint256 amountIn = (founderAllocation * trancheFounderBps[i]) / BPS;
        return (amountIn * INITIAL_MARKET_CAP_USDC * priceMultiples[i] * OUTPUT_HAIRCUT_BPS)
            / supply / BPS;
    }

    function trancheAmount(address token) public view returns (uint256) {
        uint8 i = nextTranche[token];
        if (i >= trancheFounderBps.length) return 0;
        uint256 supply = IERC20Minimal(token).totalSupply();
        uint256 founderAllocation = (supply * FOUNDER_BPS) / BPS;
        return (founderAllocation * trancheFounderBps[i]) / BPS;
    }

    /// @notice Execute the next predefined sale through the immutable router.
    /// @param token Founder token held by this vault.
    /// @param routerCalldata Exact calldata prepared for the immutable Base router.
    ///        The executor cannot change the beneficiary and cannot approve more than
    ///        the predefined tranche amount. If Base USDC output is below the milestone
    ///        floor, the entire transaction reverts.
    function executeExit(address token, bytes calldata routerCalldata)
        external
        onlyExecutor
        nonReentrant
        returns (uint256 usdcOut)
    {
        uint8 i = nextTranche[token];
        if (i >= trancheFounderBps.length) revert NoMoreTranches();

        uint256 amountIn = trancheAmount(token);
        IERC20Minimal projectToken = IERC20Minimal(token);
        uint256 tokenBefore = projectToken.balanceOf(address(this));
        if (tokenBefore < amountIn) revert InsufficientFounderTokens();

        uint256 minOut = minimumUsdcOut(token);
        uint256 usdcBefore = IERC20Minimal(baseUsdc).balanceOf(address(this));

        _forceApprove(token, router, amountIn);
        (bool ok,) = router.call(routerCalldata);
        _forceApprove(token, router, 0);
        if (!ok) revert RouterCallFailed();

        uint256 tokenAfter = projectToken.balanceOf(address(this));
        uint256 spent = tokenBefore - tokenAfter;
        if (spent == 0 || spent > amountIn) revert TokenSpendMismatch();

        uint256 usdcAfter = IERC20Minimal(baseUsdc).balanceOf(address(this));
        usdcOut = usdcAfter - usdcBefore;
        if (usdcOut < minOut) revert MinimumOutputNotMet();

        nextTranche[token] = i + 1;
        _safeTransfer(baseUsdc, beneficiary, usdcOut);
        emit ExitExecuted(token, i, spent, usdcOut, minOut);
    }

    /// @notice Recover accidental tokens, except project-token sale logic is intentionally
    ///         not exposed to the executor. Only the beneficiary can recover assets.
    function recover(address token, uint256 amount) external onlyBeneficiary {
        _safeTransfer(token, beneficiary, amount);
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool ok0, bytes memory d0) = token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, 0));
        if (!ok0 || (d0.length != 0 && !abi.decode(d0, (bool)))) revert TransferFailed();
        if (amount != 0) {
            (bool ok, bytes memory d) = token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount));
            if (!ok || (d.length != 0 && !abi.decode(d, (bool)))) revert TransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory d) = token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok || (d.length != 0 && !abi.decode(d, (bool)))) revert TransferFailed();
    }
}
