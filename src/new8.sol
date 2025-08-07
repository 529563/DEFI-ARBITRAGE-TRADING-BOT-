// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./Interfaces.sol";

/**
 * @title ArbitrageBot
 * @author Gemini
 * @notice This contract is designed to execute arbitrage trades across various DeFi exchanges.
 * It includes support for flash loans, multi-DEX routing, and robust security features.
 * This is a non-upgradeable version of the contract.
 *
 * This contract is built to be highly secure and gas-efficient. It uses custom errors
 * for cheaper reverts and provides comprehensive event logging for off-chain monitoring.
 */
contract ArbitrageBot is AccessControl, Pausable, ReentrancyGuard {

    //================================================================================
    // Roles
    //================================================================================
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    //================================================================================
    // State Variables
    //================================================================================

    // --- Configuration ---
    uint16 public slippageBps; // Default slippage tolerance in basis points (1 BPS = 0.01%)
    uint256 public minProfitThreshold; // Minimum profit required to execute a trade
    address public treasury; // Address where profits are sent

    // --- DEX & Protocol Addresses ---
    mapping(bytes32 => address) public dexRouters; // Mapping from DEX name to router address
    address public aaveLendingPool; // Aave V2 Lending Pool address for flash loans

    // --- Security ---
    mapping(address => bool) public tokenWhitelist;
    bool public whitelistEnabled;
    mapping(address => bool) public blacklistedTokens;


    //================================================================================
    // Structs
    //================================================================================

    /**
     * @dev Packs arbitrage parameters to optimize storage and memory usage.
     */
    struct ArbitrageParams {
        address tokenIn;        // Token to sell
        address tokenOut;       // Token to buy back
        uint96 amountIn;        // Amount of tokenIn to trade
        address dexBuy;         // Router address for the first trade (buy tokenOut)
        address dexSell;        // Router address for the second trade (sell tokenOut)
        uint32 deadline;        // Transaction deadline
        uint16 minProfitBPS;    // Minimum profit in BPS for this specific trade
    }

    //================================================================================
    // Custom Errors
    //================================================================================
    error DeadlineExpired(uint256 deadline, uint256 currentTime);
    error SlippageExceeded(uint256 expected, uint256 actual);
    error InsufficientProfit(uint256 required, uint256 actual);
    error InsufficientLiquidity(address dex, address token);
    error UnauthorizedCaller(address caller);
    error InvalidAmount();
    error TokenNotWhitelisted(address token);
    error TokenBlacklisted(address token);
    error InvalidDexRouter();
    error FlashloanFailed();
    error EstimationFailed();

    //================================================================================
    // Events
    //================================================================================
    event ArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        address indexed executor,
        uint256 amountIn,
        uint256 profit,
        string dexBuy,
        string dexSell
    );

    event OpportunityMissed(
        address indexed tokenA,
        address indexed tokenB,
        uint256 expectedProfit,
        string reason
    );

    event SlippageUpdated(uint16 newSlippageBps);
    event MinProfitUpdated(uint256 newMinProfit);
    event DexRouterUpdated(bytes32 indexed dexName, address indexed routerAddress);
    event TokenWhitelisted(address indexed token);
    event TokenUnwhitelisted(address indexed token);
    event WhitelistToggled(bool enabled);
    event TokenBlacklistedEvent(address indexed token); // FIX: Renamed to avoid conflict with error
    event TreasuryUpdated(address indexed newTreasury);

    //================================================================================
    // Constructor
    //================================================================================

    /**
     * @notice Initializes the contract, setting up roles and initial parameters.
     * @param _initialOwner The address to be granted OWNER, OPERATOR, and EMERGENCY roles.
     * @param _treasury The address where profits will be sent.
     * @param _slippageBps The initial slippage tolerance in basis points.
     * @param _minProfitThreshold The initial minimum profit threshold in wei.
     * @param _aaveLendingPool The address of the Aave V2 Lending Pool.
     */
    constructor(
        address _initialOwner,
        address _treasury,
        uint16 _slippageBps,
        uint256 _minProfitThreshold,
        address _aaveLendingPool
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        _grantRole(OWNER_ROLE, _initialOwner);
        _grantRole(OPERATOR_ROLE, _initialOwner);
        _grantRole(EMERGENCY_ROLE, _initialOwner);

        treasury = _treasury;
        slippageBps = _slippageBps;
        minProfitThreshold = _minProfitThreshold;
        aaveLendingPool = _aaveLendingPool;
    }

    //================================================================================
    // Core Arbitrage Logic
    //================================================================================

    /**
     * @notice Executes an arbitrage trade using the contract's own balance.
     * @param params The parameters for the arbitrage trade.
     */
    function executeArbitrage(ArbitrageParams calldata params)
        external
        whenNotPaused
        nonReentrant
        onlyRole(OPERATOR_ROLE)
    {
        // --- Pre-flight Checks ---
        if (block.timestamp > params.deadline) revert DeadlineExpired(params.deadline, block.timestamp);
        if (params.amountIn == 0) revert InvalidAmount();
        if (whitelistEnabled && (!tokenWhitelist[params.tokenIn] || !tokenWhitelist[params.tokenOut])) {
             revert TokenNotWhitelisted(whitelistEnabled && !tokenWhitelist[params.tokenIn] ? params.tokenIn : params.tokenOut);
        }
        if (blacklistedTokens[params.tokenIn] || blacklistedTokens[params.tokenOut]){
            revert TokenBlacklisted(blacklistedTokens[params.tokenIn] ? params.tokenIn : params.tokenOut);
        }

        // --- Pre-Swap Profit Validation ---
        _validateProfitability(params, params.amountIn);

        // --- Execute Trades ---
        uint256 amountOut = _executeTrade(params.dexBuy, params.tokenIn, params.tokenOut, params.amountIn);
        uint256 finalAmount = _executeTrade(params.dexSell, params.tokenOut, params.tokenIn, amountOut);

        // --- Post-Swap Profit Validation (Final Check) ---
        uint256 profit = finalAmount - params.amountIn;
        uint256 requiredProfit = (params.amountIn * params.minProfitBPS) / 10000;
        if (profit < requiredProfit || profit < minProfitThreshold) {
            // This revert acts as a final safeguard against front-running or unexpected slippage
            revert InsufficientProfit(requiredProfit, profit);
        }

        // --- Send Profit ---
        if (profit > 0) {
            IERC20(params.tokenIn).transfer(treasury, profit);
        }

        emit ArbitrageExecuted(
            params.tokenIn,
            params.tokenOut,
            msg.sender,
            params.amountIn,
            profit,
            "DEX_BUY", // In a real implementation, you'd map router addresses to names
            "DEX_SELL"
        );
    }

    /**
     * @notice Executes an arbitrage using a flash loan from Aave.
     * @param params The parameters for the arbitrage trade.
     * @param loanAmount The amount of tokenIn to borrow.
     */
    function executeFlashLoanArbitrage(ArbitrageParams calldata params, uint256 loanAmount)
        external
        whenNotPaused
        nonReentrant
        onlyRole(OPERATOR_ROLE)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired(params.deadline, block.timestamp);
        if (loanAmount == 0) revert InvalidAmount();

        address[] memory assets = new address[](1);
        assets[0] = params.tokenIn;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 for no debt, 1 for stable, 2 for variable

        bytes memory encodedParams = abi.encode(params);

        ILendingPool(aaveLendingPool).flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this), // onBehalfOf
            encodedParams,
            0 // referralCode
        );
    }

    /**
     * @notice Aave flash loan callback. This function is called by the Aave Lending Pool.
     * DO NOT CALL DIRECTLY.
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != aaveLendingPool) revert UnauthorizedCaller(msg.sender);

        ArbitrageParams memory tradeParams = abi.decode(params, (ArbitrageParams));
        uint256 loanAmount = amounts[0];
        uint256 premium = premiums[0];
        address token = assets[0];
        
        // --- Pre-Swap Profit Validation ---
        _validateProfitability(tradeParams, loanAmount);

        // --- Execute Trades ---
        uint256 amountOut = _executeTrade(tradeParams.dexBuy, tradeParams.tokenIn, tradeParams.tokenOut, loanAmount);
        uint256 finalAmount = _executeTrade(tradeParams.dexSell, tradeParams.tokenOut, tradeParams.tokenIn, amountOut);

        // --- Profit & Repayment Validation ---
        uint256 requiredToRepay = loanAmount + premium;
        if (finalAmount < requiredToRepay) {
            emit OpportunityMissed(tradeParams.tokenIn, tradeParams.tokenOut, 0, "Flashloan repayment failed");
            revert FlashloanFailed();
        }

        uint256 profit = finalAmount - requiredToRepay;
        uint256 requiredProfit = (loanAmount * tradeParams.minProfitBPS) / 10000;
        if (profit < requiredProfit || profit < minProfitThreshold) {
            revert InsufficientProfit(requiredProfit, profit);
        }

        // --- Repay Flash Loan ---
        IERC20(token).approve(aaveLendingPool, requiredToRepay);

        // --- Send Profit ---
        if(profit > 0) {
            IERC20(token).transfer(treasury, profit);
        }

        emit ArbitrageExecuted(
            tradeParams.tokenIn,
            tradeParams.tokenOut,
            initiator,
            loanAmount,
            profit,
            "DEX_BUY_FLASH",
            "DEX_SELL_FLASH"
        );

        return true;
    }


    //================================================================================
    // Internal Helper Functions
    //================================================================================
    
    /**
     * @dev Internal function that validates profitability before executing swaps.
     */
    function _validateProfitability(ArbitrageParams memory params, uint256 amountIn) internal view { // FIX: Changed to memory
        uint256 expectedFinalAmount;
        try IUniswapV2Router02(params.dexBuy).getAmountsOut(amountIn, getPath(params.tokenIn, params.tokenOut)) returns (uint256[] memory amountsOut) {
            try IUniswapV2Router02(params.dexSell).getAmountsOut(amountsOut[1], getPath(params.tokenOut, params.tokenIn)) returns (uint256[] memory finalAmounts) {
                expectedFinalAmount = finalAmounts[1];
            } catch {
                revert EstimationFailed();
            }
        } catch {
            revert EstimationFailed();
        }

        if (expectedFinalAmount <= amountIn) {
            revert InsufficientProfit(0, 0);
        }

        uint256 profit = expectedFinalAmount - amountIn;
        uint256 requiredProfit = (amountIn * params.minProfitBPS) / 10000;
        if (profit < requiredProfit || profit < minProfitThreshold) {
            revert InsufficientProfit(requiredProfit, profit);
        }
    }


    /**
     * @dev Internal function to handle the logic of a single trade on a DEX.
     * This is a simplified example for Uniswap V2-style routers.
     */
    function _executeTrade(address router, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        if (router == address(0)) revert InvalidDexRouter();

        IERC20(tokenIn).approve(router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256[] memory amounts = IUniswapV2Router02(router).swapExactTokensForTokens(
            amountIn,
            0, // amountOutMin - setting to 0 for simplicity, profit checks handle slippage
            path,
            address(this),
            block.timestamp
        );

        return amounts[1];
    }


    //================================================================================
    // Admin & Emergency Functions
    //================================================================================

    /** @notice Pauses the contract, halting all trading functions. */
    function pause() public onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /** @notice Unpauses the contract, resuming all trading functions. */
    function unpause() public onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    /** @notice Allows the owner to withdraw any ERC20 tokens from the contract in an emergency. */
    function emergencyWithdraw(address tokenAddress) external onlyRole(OWNER_ROLE) {
        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance > 0) {
            IERC20(tokenAddress).transfer(treasury, balance);
        }
    }
    
    /** @notice Updates the treasury address where profits are sent. */
    function updateTreasury(address _newTreasury) external onlyRole(OWNER_ROLE) {
        treasury = _newTreasury;
        emit TreasuryUpdated(_newTreasury);
    }

    /** @notice Updates the default slippage tolerance. */
    function updateSlippageTolerance(uint16 _newSlippageBps) external onlyRole(OWNER_ROLE) {
        slippageBps = _newSlippageBps;
        emit SlippageUpdated(_newSlippageBps);
    }

    /** @notice Updates the minimum profit threshold. */
    function updateMinProfitThreshold(uint256 _newMinProfit) external onlyRole(OWNER_ROLE) {
        minProfitThreshold = _newMinProfit;
        emit MinProfitUpdated(_newMinProfit);
    }

    /** @notice Adds or updates a DEX router address. */
    function setDexRouter(bytes32 _dexName, address _routerAddress) external onlyRole(OWNER_ROLE) {
        dexRouters[_dexName] = _routerAddress;
        emit DexRouterUpdated(_dexName, _routerAddress);
    }

    /** @notice Adds a token to the whitelist. */
    function addToWhitelist(address _token) external onlyRole(OWNER_ROLE) {
        tokenWhitelist[_token] = true;
        emit TokenWhitelisted(_token);
    }

    /** @notice Removes a token from the whitelist. */
    function removeFromWhitelist(address _token) external onlyRole(OWNER_ROLE) {
        tokenWhitelist[_token] = false;
        emit TokenUnwhitelisted(_token);
    }

    /** @notice Enables or disables the token whitelist requirement. */
    function setWhitelistEnabled(bool _enabled) external onlyRole(OWNER_ROLE) {
        whitelistEnabled = _enabled;
        emit WhitelistToggled(_enabled);
    }

    /** @notice Adds a token to the blacklist, preventing it from being traded. */
    function blacklistToken(address _token) external onlyRole(EMERGENCY_ROLE) {
        blacklistedTokens[_token] = true;
        emit TokenBlacklistedEvent(_token); // FIX: Emitting the renamed event
    }

    //================================================================================
    // View Functions
    //================================================================================

    /**
     * @notice Checks the potential profit of an arbitrage trade without executing it.
     * @dev This is an estimation and actual profit may vary due to price changes and gas costs.
     * @param params The parameters for the arbitrage trade.
     * @return profit The estimated profit in terms of tokenIn.
     */
    function estimateProfit(ArbitrageParams calldata params) external view returns (uint256 profit) {
        try IUniswapV2Router02(params.dexBuy).getAmountsOut(params.amountIn, getPath(params.tokenIn, params.tokenOut)) returns (uint256[] memory amountsOut) {
            try IUniswapV2Router02(params.dexSell).getAmountsOut(amountsOut[1], getPath(params.tokenOut, params.tokenIn)) returns (uint256[] memory finalAmounts) {
                if (finalAmounts[1] > params.amountIn) {
                    return finalAmounts[1] - params.amountIn;
                }
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
        return 0;
    }

    function getPath(address tokenA, address tokenB) internal pure returns (address[] memory) {
        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;
        return path;
    }
}