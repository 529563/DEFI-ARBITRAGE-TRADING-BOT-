// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDEXRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(uint amountIn, address[] calldata path)
        external view returns (uint[] memory amounts);
        
    function factory() external pure returns (address);
}

interface IDEXFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IDEXPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

contract TriangularArbitrageBot is ReentrancyGuard, Ownable {
    
    using SafeERC20 for IERC20;

    // ==================== CONSTANTS & IMMUTABLES ====================
    
    uint256 private constant MAX_INT = 2**256 - 1;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_SLIPPAGE = 1000; // 10% max slippage
    uint256 private constant MIN_SLIPPAGE = 1;    // 0.01% min slippage
    uint256 private constant PLATFORM_FEE = 50;   // 50% platform fee
    uint256 private constant GAS_LIMIT = 500000;  // Gas limit for swaps
    
    // ==================== STATE VARIABLES ====================
    
    struct User {
        uint256 balance;
        uint256 totalProfit;
        bool isActive;
        uint256 subscriptionExpiry;
        uint256 nonce; // For replay protection
    }
    
    struct ArbitrageParams {
        address tokenA;        // Starting token
        address tokenB;        // Intermediate token 1
        address tokenC;        // Intermediate token 2
        uint256 amountIn;      // Input amount
        uint256 minAmountOut;  // Minimum expected output
        address dex1;          // First DEX router
        address dex2;          // Second DEX router
        address dex3;          // Third DEX router
        uint256 maxSlippage;   // Maximum allowed slippage (in basis points)
        uint256 deadline;      // Transaction deadline
        bytes32 commitment;    // MEV protection commitment
    }
    
    struct SwapCache {
        uint256 initialBalance;
        uint256 intermediateBalance1;
        uint256 intermediateBalance2;
        uint256 finalBalance;
        uint256 totalGasUsed;
    }
    
    mapping(address => User) public users;
    mapping(address => bool) public authorizedDEXs;
    mapping(address => bool) public supportedTokens;
    mapping(bytes32 => bool) public usedCommitments; // MEV protection
    mapping(address => uint256) public userNonces;
    
    address public immutable platformWallet;
    uint256 public totalPlatformEarnings;
    uint256 public totalArbitrages;
    
    // Gas optimization: Pack frequently accessed variables
    struct PackedData {
        uint128 minProfitThreshold;
        uint128 maxGasPrice;
        bool paused;
        bool emergencyStop;
    }
    
    PackedData public packedData;
    
    // Events - optimized for gas
    event ArbitrageExecuted(
        address indexed user,
        uint256 indexed nonce,
        uint256 profit,
        uint256 gasUsed
    );
    
    event UserSubscribed(address indexed user, uint256 expiry);
    event FundsDeposited(address indexed user, uint256 amount);
    event FundsWithdrawn(address indexed user, uint256 amount);
    
    // ==================== CONSTRUCTOR ====================
    
    constructor(
        address _platformWallet,
        address[] memory _initialDEXs,
        address[] memory _initialTokens
    ) Ownable(msg.sender) {
        require(_platformWallet != address(0), "Invalid platform wallet");
        
        platformWallet = _platformWallet;
        
        // Initialize packed data
        packedData = PackedData({
            minProfitThreshold: 1e15, // 0.001 ETH minimum profit
            maxGasPrice: 100 gwei,    // Maximum gas price
            paused: false,
            emergencyStop: false
        });
        
        // Initialize authorized DEXs
        for (uint256 i = 0; i < _initialDEXs.length; i++) {
            authorizedDEXs[_initialDEXs[i]] = true;
        }
        
        // Initialize supported tokens
        for (uint256 i = 0; i < _initialTokens.length; i++) {
            supportedTokens[_initialTokens[i]] = true;
        }
    }
    
    // ==================== MODIFIERS ====================
    
    modifier validSlippage(uint256 slippage) {
        require(slippage >= MIN_SLIPPAGE && slippage <= MAX_SLIPPAGE, "Invalid slippage");
        _;
    }
    
    modifier onlyActiveUser() {
        require(
            users[msg.sender].isActive && 
            users[msg.sender].subscriptionExpiry > block.timestamp,
            "User not active"
        );
        _;
    }
    
    modifier gasOptimized() {
        require(tx.gasprice <= packedData.maxGasPrice, "Gas price too high");
        uint256 gasStart = gasleft();
        _;
        // Gas refund mechanism could be implemented here
    }
    
    modifier antiMEV(bytes32 commitment) {
        require(!usedCommitments[commitment], "Commitment already used");
        require(
            commitment == keccak256(abi.encodePacked(msg.sender, block.timestamp, userNonces[msg.sender])),
            "Invalid commitment"
        );
        usedCommitments[commitment] = true;
        userNonces[msg.sender]++;
        _;
    }
    
    modifier notPaused() {
        require(!packedData.paused && !packedData.emergencyStop, "Contract paused");
        _;
    }
    
    // ==================== CORE ARBITRAGE FUNCTION ====================
    
    function executeTriangularArbitrage(
        ArbitrageParams calldata params
    ) 
        external 
        nonReentrant 
        onlyActiveUser 
        gasOptimized
        validSlippage(params.maxSlippage)
        antiMEV(params.commitment)
        notPaused
        returns (uint256 profit)
    {
        // Input validation (gas optimized)
        require(params.deadline > block.timestamp, "Expired");
        require(params.amountIn > 0, "Zero amount");
        require(
            supportedTokens[params.tokenA] && 
            supportedTokens[params.tokenB] && 
            supportedTokens[params.tokenC],
            "Unsupported token"
        );
        require(
            authorizedDEXs[params.dex1] && 
            authorizedDEXs[params.dex2] && 
            authorizedDEXs[params.dex3],
            "Unauthorized DEX"
        );
        require(users[msg.sender].balance >= params.amountIn, "Insufficient balance");
        
        // Create swap cache for gas optimization
        SwapCache memory cache;
        cache.initialBalance = IERC20(params.tokenA).balanceOf(address(this));
        
        // Deduct amount from user balance
        users[msg.sender].balance -= params.amountIn;
        
        // Execute triangular arbitrage
        profit = _executeTriangularSwaps(params, cache);
        
        // Validate minimum profit
        require(profit >= packedData.minProfitThreshold, "Insufficient profit");
        require(profit >= params.minAmountOut, "Below min output");
        
        // Distribute profits
        _distributeProfits(msg.sender, profit);
        
        // Update statistics
        totalArbitrages++;
        
        emit ArbitrageExecuted(msg.sender, userNonces[msg.sender] - 1, profit, cache.totalGasUsed);
        
        return profit;
    }
    
    // ==================== INTERNAL SWAP LOGIC ====================
    
    function _executeTriangularSwaps(
        ArbitrageParams calldata params,
        SwapCache memory cache
    ) private returns (uint256 finalProfit) {
        
        // Step 1: TokenA -> TokenB (DEX1)
        cache.intermediateBalance1 = _executeSingleSwap(
            params.tokenA,
            params.tokenB,
            params.amountIn,
            params.dex1,
            params.maxSlippage,
            params.deadline
        );
        
        // Step 2: TokenB -> TokenC (DEX2)
        cache.intermediateBalance2 = _executeSingleSwap(
            params.tokenB,
            params.tokenC,
            cache.intermediateBalance1,
            params.dex2,
            params.maxSlippage,
            params.deadline
        );
        
        // Step 3: TokenC -> TokenA (DEX3)
        cache.finalBalance = _executeSingleSwap(
            params.tokenC,
            params.tokenA,
            cache.intermediateBalance2,
            params.dex3,
            params.maxSlippage,
            params.deadline
        );
        
        // Calculate profit
        require(cache.finalBalance > params.amountIn, "No arbitrage profit");
        finalProfit = cache.finalBalance - params.amountIn;
        
        return finalProfit;
    }
    
    function _executeSingleSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address router,
        uint256 maxSlippage,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        
        // Get expected output with slippage protection
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256[] memory amounts = IDEXRouter(router).getAmountsOut(amountIn, path);
        uint256 expectedOut = amounts[1];
        uint256 minAmountOut = expectedOut - (expectedOut * maxSlippage) / 10000;
        
        // Approve token spending (gas optimized)
        IERC20 tokenContract = IERC20(tokenIn);
        if (tokenContract.allowance(address(this), router) < amountIn) {
            tokenContract.approve(router, 0);
            tokenContract.approve(router, MAX_INT);
        }
        
        
        // Record balance before swap
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        
        // Execute swap with gas limit
        try IDEXRouter(router).swapExactTokensForTokens{gas: GAS_LIMIT}(
            amountIn,
            minAmountOut,
            path,
            address(this),
            deadline
        ) returns (uint256[] memory swapAmounts) {
            amountOut = swapAmounts[1];
        } catch {
            // Fallback: Calculate actual received amount
            uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
            amountOut = balanceAfter - balanceBefore;
            require(amountOut >= minAmountOut, "Swap failed");
        }
        
        return amountOut;
    }
    
    // ==================== PROFIT DISTRIBUTION ====================
    
    function _distributeProfits(address user, uint256 totalProfit) private {
        uint256 platformShare = (totalProfit * PLATFORM_FEE) / 100;
        uint256 userShare = totalProfit - platformShare;
        
        // Update user balance and profits
        users[user].balance += userShare;
        users[user].totalProfit += userShare;
        
        // Update platform earnings
        totalPlatformEarnings += platformShare;
        
        // Transfer platform share (gas optimized)
        if (platformShare > 0) {
            payable(platformWallet).transfer(platformShare);
        }
    }
    
    // ==================== SIMULATION FUNCTIONS ====================
    
    function simulateTriangularArbitrage(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        address dex1,
        address dex2,
        address dex3
    ) external view returns (
        uint256 expectedProfit,
        uint256 gasEstimate,
        bool profitable
    ) {
        if (amountIn == 0) return (0, 0, false);
        
        try this._simulateSwapChain(tokenA, tokenB, tokenC, amountIn, dex1, dex2, dex3) 
        returns (uint256 finalAmount) {
            if (finalAmount > amountIn) {
                expectedProfit = finalAmount - amountIn;
                gasEstimate = 450000; // Estimated gas for triangular arbitrage
                profitable = expectedProfit >= packedData.minProfitThreshold;
            }
        } catch {
            expectedProfit = 0;
            gasEstimate = 0;
            profitable = false;
        }
    }
    
    function _simulateSwapChain(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        address dex1,
        address dex2,
        address dex3
    ) external view returns (uint256 finalAmount) {
        // Simulate first swap: A -> B
        address[] memory path1 = new address[](2);
        path1[0] = tokenA;
        path1[1] = tokenB;
        uint256[] memory amounts1 = IDEXRouter(dex1).getAmountsOut(amountIn, path1);
        
        // Simulate second swap: B -> C
        address[] memory path2 = new address[](2);
        path2[0] = tokenB;
        path2[1] = tokenC;
        uint256[] memory amounts2 = IDEXRouter(dex2).getAmountsOut(amounts1[1], path2);
        
        // Simulate third swap: C -> A
        address[] memory path3 = new address[](2);
        path3[0] = tokenC;
        path3[1] = tokenA;
        uint256[] memory amounts3 = IDEXRouter(dex3).getAmountsOut(amounts2[1], path3);
        
        finalAmount = amounts3[1];
    }
    
    // ==================== USER MANAGEMENT ====================
    
    function subscribe() external payable {
        require(msg.value >= 1000 ether, "Insufficient fee"); // Adjust for actual token
        
        users[msg.sender].isActive = true;
        users[msg.sender].subscriptionExpiry = block.timestamp + 30 days;
        
        payable(platformWallet).transfer(msg.value);
        
        emit UserSubscribed(msg.sender, users[msg.sender].subscriptionExpiry);
    }
    
    function depositFunds() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit");
        
        users[msg.sender].balance += msg.value;
        
        emit FundsDeposited(msg.sender, msg.value);
    }
    
    function withdrawFunds(uint256 amount) external nonReentrant onlyActiveUser {
        require(users[msg.sender].balance >= amount, "Insufficient balance");
        require(amount > 0, "Zero withdrawal");
        
        users[msg.sender].balance -= amount;
        payable(msg.sender).transfer(amount);
        
        emit FundsWithdrawn(msg.sender, amount);
    }
    
    // ==================== VIEW FUNCTIONS ====================
    
    function getUserInfo(address user) external view returns (
        uint256 balance,
        uint256 totalProfit,
        bool isActive,
        uint256 subscriptionExpiry,
        uint256 nonce
    ) {
        User memory userData = users[user];
        return (
            userData.balance,
            userData.totalProfit,
            userData.isActive && userData.subscriptionExpiry > block.timestamp,
            userData.subscriptionExpiry,
            userNonces[user]
        );
    }
    
    function getContractStats() external view returns (
        uint256 totalEarnings,
        uint256 totalTrades,
        uint256 minProfit,
        uint256 maxGasPrice
    ) {
        return (
            totalPlatformEarnings,
            totalArbitrages,
            packedData.minProfitThreshold,
            packedData.maxGasPrice
        );
    }
    
    // ==================== ADMIN FUNCTIONS ====================
    
    function updatePackedData(
        uint128 minProfit,
        uint128 maxGas,
        bool pauseState
    ) external onlyOwner {
        packedData.minProfitThreshold = minProfit;
        packedData.maxGasPrice = maxGas;
        packedData.paused = pauseState;
    }
    
    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
    }
    
    function addAuthorizedDEX(address dex) external onlyOwner {
        authorizedDEXs[dex] = true;
    }
    
    function emergencyStop() external onlyOwner {
        packedData.emergencyStop = true;
    }
    
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }
    
    // ==================== RECEIVE FUNCTION ====================
    

    receive() external payable {
        if (users[msg.sender].isActive) {
            users[msg.sender].balance += msg.value;
            emit FundsDeposited(msg.sender, msg.value);
        }
    }
}