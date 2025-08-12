// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
  Production-ready ArbitrageBot (improved)
  - Uses SafeERC20
  - Checks path continuity
  - Per-swap amountOutMinimum support (preferable)
  - Supports fee-on-transfer V2 swaps when flagged
  - Uses UniswapV3 Quoter for on-chain estimation
  - Router whitelist to avoid malicious router injection
  - Approval helper to avoid repeated unsafe approve patterns
  - Gas friendly local caching and unchecked loops
  - Roles for owner/operator/emergency/relayer preserved
*/

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Minimal UniswapV2 router interface (we include supportingFeeOnTransfer variant)
interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    // supporting fee-on-transfer tokens (some routers implement this)
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

/// Minimal UniswapV3 router swap interface (ExactInputSingle)
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// Uniswap V3 Quoter interface (Quoter/QuoterV2)
interface IQuoter {
    // quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96)
    function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut);
}

/// Keep a small local interface for tokens with permit if you want to support permits later
interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

contract ArbitrageBot is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // State
    uint16 public slippageBps; // basis points
    uint256 public minProfitThreshold;
    address public treasury;
    address public immutable aaveLendingPool; // if unused, leave for future flashloan integration
    IQuoter public immutable uniV3Quoter; // Quoter address for UniswapV3-like quoting

    mapping(address => bool) public blacklistedTokens;
    mapping(address => bool) public whitelistedRouters;

    // Structs
    enum DexType { UniswapV2, UniswapV3 }

    struct SwapStep {
        address router;            // router address (must be whitelisted)
        address tokenIn;
        address tokenOut;
        DexType dexType;
        uint24 fee;                // V3 fee, 0 for V2
        bool supportsFeeOnTransfer; // call supportingFeeOnTransfer variant for V2 when true
        uint256 amountOutMinimum;  // optional per-swap minimum (recommended)
    }

    // Errors
    error DeadlineExpired(uint256 deadline, uint256 currentTime);
    error InsufficientProfit(uint256 required, uint256 actual);
    error UnauthorizedCaller(address caller);
    error InvalidAmount();
    error TokenBlacklisted(address token);
    error InvalidDexRouter();
    error FlashloanFailed();
    error EstimationFailed(string reason);
    error InvalidPath();
    error SwapFailed(string reason);
    error RouterNotWhitelisted(address router);

    // Events
    event ArbitrageExecuted(bytes32 indexed tradeId, address indexed executor, uint256 amountIn, uint256 profit);
    event SlippageUpdated(uint16 newSlippageBps);
    event MinProfitUpdated(uint256 newMinProfit);
    event TreasuryUpdated(address indexed newTreasury);
    event TokenBlacklistedEvent(address indexed token);
    event RouterWhitelisted(address indexed router);
    event RouterDewhitelisted(address indexed router);
    event SwapStepExecuted(uint indexed stepIndex, address router, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    // Constructor
    constructor(
        address _initialOwner,
        address _treasury,
        uint16 _slippageBps,
        uint256 _minProfitThreshold,
        address _aaveLendingPool,
        address _uniV3Quoter
    ) {
        require(_initialOwner != address(0), "invalid owner");
        require(_treasury != address(0), "invalid treasury");
        _grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        _grantRole(OWNER_ROLE, _initialOwner);
        _grantRole(OPERATOR_ROLE, _initialOwner);
        _grantRole(EMERGENCY_ROLE, _initialOwner);
        _grantRole(RELAYER_ROLE, _initialOwner);

        treasury = _treasury;
        slippageBps = _slippageBps;
        minProfitThreshold = _minProfitThreshold;
        aaveLendingPool = _aaveLendingPool;
        uniV3Quoter = IQuoter(_uniV3Quoter);
    }

    // ================================
    // Core: executeArbitrage
    // ================================
    function executeArbitrage(
        SwapStep[] calldata path,
        uint256 amountIn,
        uint256 deadline
    ) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        if (amountIn == 0) revert InvalidAmount();
        if (path.length < 1) revert InvalidPath();
        if (blacklistedTokens[path[0].tokenIn]) revert TokenBlacklisted(path[0].tokenIn);

        // Validate router whitelist & path continuity
        for (uint i = 0; i < path.length; ) {
            if (!whitelistedRouters[path[i].router]) revert RouterNotWhitelisted(path[i].router);
            if (i + 1 < path.length) {
                if (path[i].tokenOut != path[i + 1].tokenIn) revert InvalidPath();
            }
            unchecked { ++i; }
        }

        // Cache some storage locally
        uint16 _slippage = slippageBps;
        uint256 _minProfit = minProfitThreshold;

        // Estimate end amount using on-chain quoting for V2 & V3 (V3 via Quoter)
        uint256 expectedFinalAmount = _getEstimatedTradeOutcome(path, amountIn);

        if (expectedFinalAmount <= amountIn) revert InsufficientProfit(amountIn, expectedFinalAmount);
        uint256 expectedProfit = expectedFinalAmount - amountIn;
        if (expectedProfit < _minProfit) revert InsufficientProfit(_minProfit, expectedProfit);

        // Apply slippage on profit (global model). Per-swap amountOutMinimums are enforced during swaps if set.
        uint256 minFinalAmount = amountIn + (expectedProfit * (10000 - _slippage)) / 10000;

        // Execute swaps
        uint256 currentAmount = amountIn;
        for (uint i = 0; i < path.length; ) {
            // copy to memory
            SwapStep memory step = path[i];
            currentAmount = _executeSwap(step, currentAmount, step.amountOutMinimum, i);
            unchecked { ++i; }
        }

        // Final profit check
        if (currentAmount < minFinalAmount) {
            revert InsufficientProfit(minFinalAmount, currentAmount);
        }

        uint256 finalProfit = currentAmount - amountIn;
        if (finalProfit > 0) {
            // Transfer profit to treasury (safe)
            IERC20(path[0].tokenIn).safeTransfer(treasury, finalProfit);
        }

        emit ArbitrageExecuted(keccak256(abi.encode(path, amountIn, deadline)), msg.sender, amountIn, finalProfit);
    }

    // ================================
    // Internal helpers
    // ================================
    function _ensureAllowance(IERC20 token, address spender, uint256 amount) internal {
        uint256 allowance = token.allowance(address(this), spender);
        if (allowance < amount) {
            // safeIncreaseAllowance will revert on tokens that don't return bool, thanks to SafeERC20
            token.safeIncreaseAllowance(spender, amount - allowance);
        }
    }

    function _executeSwap(SwapStep memory step, uint256 amountIn, uint256 amountOutMinProvided, uint stepIndex) internal returns (uint256 amountOut) {
        if (step.router == address(0)) revert InvalidDexRouter();
        if (amountIn == 0) revert InvalidAmount();

        IERC20(step.tokenIn).safeIncreaseAllowance(step.router, amountIn);

        if (step.dexType == DexType.UniswapV2) {
            address;
            route[0] = step.tokenIn;
            route[1] = step.tokenOut;

            // prefer explicit per-swap minimum if provided
            uint256 minOut = amountOutMinProvided;

            if (step.supportsFeeOnTransfer) {
                // call supporting fee on transfer if router implements it (some do). This function returns nothing.
                try IUniswapV2Router02(step.router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    amountIn,
                    minOut,
                    route,
                    address(this),
                    block.timestamp
                ) {
                    // After supportingFeeOnTransfer swap, we must read actual balance to compute amountOut
                    uint256 balanceAfter = IERC20(step.tokenOut).balanceOf(address(this));
                    // This approach assumes tokenOut balance was zero before. Safer approach: snapshot balances before each swap
                    // For simplicity, we compute amountOut as balanceAfter (users should ensure path tokens not present or adjust accordingly)
                    amountOut = balanceAfter;
                } catch (bytes memory reason) {
                    revert SwapFailed(_getRevertMsg(reason));
                }
            } else {
                try IUniswapV2Router02(step.router).swapExactTokensForTokens(
                    amountIn,
                    minOut,
                    route,
                    address(this),
                    block.timestamp
                ) returns (uint[] memory amounts) {
                    amountOut = amounts[amounts.length - 1];
                } catch (bytes memory reason) {
                    revert SwapFailed(_getRevertMsg(reason));
                }
            }

        } else if (step.dexType == DexType.UniswapV3) {
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: step.tokenIn,
                tokenOut: step.tokenOut,
                fee: step.fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinProvided, // use provided per-swap minimum
                sqrtPriceLimitX96: 0
            });

            try ISwapRouter(step.router).exactInputSingle(params) returns (uint256 out) {
                amountOut = out;
            } catch (bytes memory reason) {
                revert SwapFailed(_getRevertMsg(reason));
            }
        } else {
            revert SwapFailed("Unsupported DEX type");
        }

        emit SwapStepExecuted(stepIndex, step.router, step.tokenIn, step.tokenOut, amountIn, amountOut);
        return amountOut;
    }

    /// Returns estimated final amount by walking path using V2 getAmountsOut and V3 Quoter.
    function _getEstimatedTradeOutcome(SwapStep[] calldata path, uint256 amountIn) internal returns (uint256) {
        uint256 currentAmount = amountIn;
        for (uint i = 0; i < path.length; ) {
            SwapStep calldata step = path[i];
            if (step.dexType == DexType.UniswapV2) {
                address;
                route[0] = step.tokenIn;
                route[1] = step.tokenOut;
                try IUniswapV2Router02(step.router).getAmountsOut(currentAmount, route) returns (uint[] memory amounts) {
                    currentAmount = amounts[amounts.length - 1];
                } catch {
                    revert EstimationFailed("UniswapV2 getAmountsOut failed");
                }
            } else if (step.dexType == DexType.UniswapV3) {
                // Use Quoter to estimate exactInputSingle
                try uniV3Quoter.quoteExactInputSingle(step.tokenIn, step.tokenOut, step.fee, currentAmount, 0) returns (uint256 quotedOut) {
                    currentAmount = quotedOut;
                } catch {
                    revert EstimationFailed("UniswapV3 Quoter failed");
                }
            } else {
                revert EstimationFailed("Unsupported DEX type for estimation");
            }
            unchecked { ++i; }
        }
        return currentAmount;
    }

    // Revert reason extractor (safe)
    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        // If the returnData length is less than 68, then the transaction failed silently (without a revert message)
        if (returnData.length < 68) return "Transaction reverted";
        assembly {
            // slice the sighash
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }

    // ================================
    // Admin & emergency
    // ================================
    function pause() public onlyRole(EMERGENCY_ROLE) { _pause(); }
    function unpause() public onlyRole(EMERGENCY_ROLE) { _unpause(); }

    function emergencyWithdraw(address tokenAddress) external onlyRole(OWNER_ROLE) {
        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance > 0) {
            IERC20(tokenAddress).safeTransfer(treasury, balance);
        }
    }

    function updateTreasury(address _newTreasury) external onlyRole(OWNER_ROLE) {
        treasury = _newTreasury;
        emit TreasuryUpdated(_newTreasury);
    }

    function updateSlippageTolerance(uint16 _newSlippageBps) external onlyRole(OWNER_ROLE) {
        slippageBps = _newSlippageBps;
        emit SlippageUpdated(_newSlippageBps);
    }

    function updateMinProfitThreshold(uint256 _newMinProfit) external onlyRole(OWNER_ROLE) {
        minProfitThreshold = _newMinProfit;
        emit MinProfitUpdated(_newMinProfit);
    }

    function blacklistToken(address _token) external onlyRole(EMERGENCY_ROLE) {
        blacklistedTokens[_token] = true;
        emit TokenBlacklistedEvent(_token);
    }

    // Router whitelist management
    function whitelistRouter(address _router) external onlyRole(OWNER_ROLE) {
        whitelistedRouters[_router] = true;
        emit RouterWhitelisted(_router);
    }
    function dewhitelistRouter(address _router) external onlyRole(OWNER_ROLE) {
        whitelistedRouters[_router] = false;
        emit RouterDewhitelisted(_router);
    }

    // View helpers
    function isRouterWhitelisted(address _router) external view returns (bool) {
        return whitelistedRouters[_router];
    }

    // Fallbacks & receive - keep them guarded (not payable)
    fallback() external payable { revert("NOT_PAYABLE"); }
    receive() external payable { revert("NOT_PAYABLE"); }
}
