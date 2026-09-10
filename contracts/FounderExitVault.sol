// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title FounderExitVault
/// @notice Receives disclosed founder allocations, realizes predefined tranches through
///         a fixed Base Uniswap Universal Router, and sends realized Base USDC only to
///         the immutable beneficiary. The executor cannot change payout destination.
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
    error AmountTooLarge();

    // Canonical Permit2 deployment used by Uniswap across EVM networks.
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public immutable beneficiary;
    address public immutable baseUsdc;
    address public immutable router;
    address public executor;

    // Founder allocation: 10% of fixed token supply.
    uint256 public constant FOUNDER_BPS = 1_000;
    uint256 public constant BPS = 10_000;
    uint256 public constant INITIAL_MARKET_CAP_USDC = 10_000e6;
    uint256 public constant OUTPUT_HAIRCUT_BPS = 7_500;

    // Percentages below are of the founder bag, not total token supply.
    uint16[6] public trancheFounderBps = [500, 1000, 1500, 2000, 2000, 1500];
    uint16[6] public priceMultiples = [3, 5, 10, 20, 50, 100];
    mapping(address token => uint8 nextTranche) public nextTranche;

    uint256 private _entered;

    event ExecutorChanged(address indexed oldExecutor, address indexed newExecutor);
    event ExitExecuted(address indexed token, uint8 indexed tranche, uint256 tokenAmount, uint256 usdcOut, uint256 minimumUsdcOut);

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
        if (beneficiary_ == address(0) || executor_ == address(0) || baseUsdc_ == address(0) || router_ == address(0)) revert InvalidAddress();
        beneficiary = beneficiary_;
        executor = executor_;
        baseUsdc = baseUsdc_;
        router = router_;
    }

    function setExecutor(address newExecutor) external onlyBeneficiary {
        if (newExecutor == address(0)) revert InvalidAddress();
        emit ExecutorChanged(executor, newExecutor);
        executor = newExecutor;
    }

    function trancheAmount(address token) public view returns (uint256) {
        uint8 i = nextTranche[token];
        if (i >= trancheFounderBps.length) return 0;
        uint256 founderAllocation = (IERC20Minimal(token).totalSupply() * FOUNDER_BPS) / BPS;
        return (founderAllocation * trancheFounderBps[i]) / BPS;
    }

    function minimumUsdcOut(address token) public view returns (uint256) {
        uint8 i = nextTranche[token];
        if (i >= trancheFounderBps.length) return type(uint256).max;
        uint256 supply = IERC20Minimal(token).totalSupply();
        uint256 amountIn = trancheAmount(token);
        return (amountIn * INITIAL_MARKET_CAP_USDC * priceMultiples[i] * OUTPUT_HAIRCUT_BPS) / supply / BPS;
    }

    /// @notice Sells exactly the next predefined tranche. Off-chain automation supplies
    ///         Universal Router calldata, but cannot increase the approved token amount
    ///         or redirect the Base USDC proceeds from this vault.
    function executeExit(address token, bytes calldata routerCalldata)
        external
        onlyExecutor
        nonReentrant
        returns (uint256 usdcOut)
    {
        uint8 tranche = nextTranche[token];
        if (tranche >= trancheFounderBps.length) revert NoMoreTranches();

        uint256 amountIn = trancheAmount(token);
        if (IERC20Minimal(token).balanceOf(address(this)) < amountIn) revert InsufficientFounderTokens();
        uint256 minOut = minimumUsdcOut(token);

        usdcOut = _swapExactFounderTranche(token, amountIn, minOut, routerCalldata);
        nextTranche[token] = tranche + 1;
        _safeTransfer(baseUsdc, beneficiary, usdcOut);
        emit ExitExecuted(token, tranche, amountIn, usdcOut, minOut);
    }

    function _swapExactFounderTranche(address token, uint256 amountIn, uint256 minOut, bytes calldata routerCalldata)
        internal
        returns (uint256 usdcOut)
    {
        if (amountIn > type(uint160).max) revert AmountTooLarge();
        IERC20Minimal projectToken = IERC20Minimal(token);
        uint256 tokenBefore = projectToken.balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(baseUsdc).balanceOf(address(this));

        // Universal Router V4 token pulls use Permit2. Approve only this fixed tranche.
        _forceApprove(token, PERMIT2, amountIn);
        IPermit2Allowance(PERMIT2).approve(token, router, uint160(amountIn), uint48(block.timestamp + 300));

        (bool ok,) = router.call(routerCalldata);

        // Revoke both allowance layers immediately, even though the whole transaction
        // would revert on failure.
        IPermit2Allowance(PERMIT2).approve(token, router, 0, 0);
        _forceApprove(token, PERMIT2, 0);
        if (!ok) revert RouterCallFailed();

        if (tokenBefore - projectToken.balanceOf(address(this)) != amountIn) revert TokenSpendMismatch();
        usdcOut = IERC20Minimal(baseUsdc).balanceOf(address(this)) - usdcBefore;
        if (usdcOut < minOut) revert MinimumOutputNotMet();
    }

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
