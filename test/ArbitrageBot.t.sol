// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/ArbitrageBot.sol";
import "../src/Interfaces.sol";

/// @notice Minimal, test-only ERC20 token (mintable)
contract ERC20Mock is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function totalSupply() external view override returns (uint256) { return _totalSupply; }
    function balanceOf(address account) external view override returns (uint256) { return _balances[account]; }
    function allowance(address owner, address spender) external view override returns (uint256) { return _allowances[owner][spender]; }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(_balances[msg.sender] >= amount, "ERC20: insufficient");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        require(allowed >= amount, "ERC20: allowance");
        require(_balances[from] >= amount, "ERC20: insufficient");
        _allowances[from][msg.sender] = allowed - amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}

/// @notice Simple V2-like mock router. getAmountsOut returns a rate (num/den).
contract MockUniswapV2Router is IUniswapV2Router02 {
    mapping(bytes32 => uint256) public rateNum;
    mapping(bytes32 => uint256) public rateDen;
    mapping(bytes32 => uint256) public swapNum;
    mapping(bytes32 => uint256) public swapDen;

    function _key(address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b));
    }

    function setRate(address a, address b, uint256 num, uint256 den) external {
        rateNum[_key(a,b)] = num;
        rateDen[_key(a,b)] = den;
    }

    function setSwapRate(address a, address b, uint256 num, uint256 den) external {
        swapNum[_key(a,b)] = num;
        swapDen[_key(a,b)] = den;
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external view override returns (uint[] memory amounts) {
        require(path.length == 2, "only 2 tokens path");
        bytes32 k = _key(path[0], path[1]);
        uint num = rateNum[k]; uint den = rateDen[k];
        require(num != 0 && den != 0, "rate not set");
        uint amountOut = (amountIn * num) / den;
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external override returns (uint[] memory amounts) {
        require(path.length == 2, "only 2 tokens path");
        IERC20 tokenIn = IERC20(path[0]);
        IERC20 tokenOut = IERC20(path[1]);

        // Pull tokenIn from caller (the arbitrage contract)
        require(tokenIn.transferFrom(msg.sender, address(this), amountIn), "transferFrom failed");

        bytes32 k = _key(path[0], path[1]);
        uint num = swapNum[k]; uint den = swapDen[k];
        require(num != 0 && den != 0, "swap rate not set");
        uint amountOut = (amountIn * num) / den;
        require(amountOut >= amountOutMin, "insufficient output");

        // Send tokenOut from router's balance
        require(tokenOut.transfer(to, amountOut), "transfer out failed");

        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }
}

/// @notice Mock UniswapV3 router (very small subset used for tests)
contract MockSwapRouterV3 is ISwapRouter {
    mapping(bytes32 => uint256) public rateNum;
    mapping(bytes32 => uint256) public rateDen;

    function _key(address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b));
    }

    function setRate(address a, address b, uint256 num, uint256 den) external {
        rateNum[_key(a,b)] = num;
        rateDen[_key(a,b)] = den;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable override returns (uint256 amountOut) {
        bytes32 k = _key(params.tokenIn, params.tokenOut);
        uint num = rateNum[k]; uint den = rateDen[k];
        require(num != 0 && den != 0, "v3 rate not set");
        // Pull tokenIn from caller (the arbitrage contract)
        require(IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "transferFrom failed");
        amountOut = (params.amountIn * num) / den;
        require(IERC20(params.tokenOut).transfer(params.recipient, amountOut), "transfer out failed");
        return amountOut;
    }
}

contract ArbitrageBotTest is Test {
    ArbitrageBot bot;
    ERC20Mock tokenA;
    ERC20Mock tokenB;
    ERC20Mock tokenC;
    MockUniswapV2Router routerV2;
    MockSwapRouterV3 routerV3;
    address treasury = address(0xBEEF);

    function setUp() public {
        tokenA = new ERC20Mock("TokenA", "TKA");
        tokenB = new ERC20Mock("TokenB", "TKB");
        tokenC = new ERC20Mock("TokenC", "TKC");

        routerV2 = new MockUniswapV2Router();
        routerV3 = new MockSwapRouterV3();

        // Deploy arbitrage bot. test contract (this) will be the initial owner/relayer.
        bot = new ArbitrageBot(address(this), treasury, 0 /*slippageBps*/, 0 /*minProfitThreshold*/, address(0));
    }

    function _buildPathV2(address r, address tIn, address tOut) internal pure returns (ArbitrageBot.SwapStep memory s) {
        s.router = r;
        s.tokenIn = tIn;
        s.tokenOut = tOut;
        s.dexType = ArbitrageBot.DexType.UniswapV2;
        s.fee = 0;
    }

    function _buildPathV3(address r, address tIn, address tOut, uint24 fee) internal pure returns (ArbitrageBot.SwapStep memory s) {
        s.router = r;
        s.tokenIn = tIn;
        s.tokenOut = tOut;
        s.dexType = ArbitrageBot.DexType.UniswapV3;
        s.fee = fee;
    }

    /// @notice happy path: V2 triangular arbitrage that is profitable
    function testSuccessfulArbitrage() public {
        uint256 amountIn = 1 ether;

        // Fund the bot with the initial tokenA
        tokenA.mint(address(bot), amountIn);

        // Router pricing (estimation): A->B = 2x, B->C = 1x, C->A = 1x  => final = 2 * amountIn
        routerV2.setRate(address(tokenA), address(tokenB), 2, 1);
        routerV2.setRate(address(tokenB), address(tokenC), 1, 1);
        routerV2.setRate(address(tokenC), address(tokenA), 1, 1);

        // Router swap behavior: we mirror rates (swap will do same as getAmountsOut here)
        routerV2.setSwapRate(address(tokenA), address(tokenB), 2, 1);
        routerV2.setSwapRate(address(tokenB), address(tokenC), 1, 1);
        routerV2.setSwapRate(address(tokenC), address(tokenA), 1, 1);

        // Pre-fund router with output tokens so it can send them during swap
        tokenB.mint(address(routerV2), 1000 ether);
        tokenC.mint(address(routerV2), 1000 ether);
        tokenA.mint(address(routerV2), 1000 ether);

        // Build path
        ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](3);
        path[0] = _buildPathV2(address(routerV2), address(tokenA), address(tokenB));
        path[1] = _buildPathV2(address(routerV2), address(tokenB), address(tokenC));
        path[2] = _buildPathV2(address(routerV2), address(tokenC), address(tokenA));

        // Execute
        bot.executeArbitrage(path, amountIn, block.timestamp + 1000);

        // After the triangular trade final amount should be 2 * amountIn and profit = amountIn
        uint256 treasuryBal = tokenA.balanceOf(treasury);
        assertEq(treasuryBal, amountIn, "treasury should receive the profit (amountIn)");
    }

    /// @notice If the router reports a big output in getAmountsOut but swap actually pays less -> final revert
    function testSlippageCausesRevert() public {
        uint256 amountIn = 1 ether;
        tokenA.mint(address(bot), amountIn);

        // Estimation is 2x
        routerV2.setRate(address(tokenA), address(tokenB), 2, 1);
        routerV2.setRate(address(tokenB), address(tokenA), 1, 1);

        // BUT swap returns only 110% (not 200%) -> post-swap check should fail
        routerV2.setSwapRate(address(tokenA), address(tokenB), 11, 10); // 1.1x
        routerV2.setSwapRate(address(tokenB), address(tokenA), 1, 1);

        tokenB.mint(address(routerV2), 1000 ether);
        tokenA.mint(address(routerV2), 1000 ether);

        ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](2);
        path[0] = _buildPathV2(address(routerV2), address(tokenA), address(tokenB));
        path[1] = _buildPathV2(address(routerV2), address(tokenB), address(tokenA));

        vm.expectRevert();
        bot.executeArbitrage(path, amountIn, block.timestamp + 1000);
    }

    /// @notice Passing a V3 step should revert during estimation (on-chain V3 estimation not supported)
// ...existing code...
function testV3EstimationReverts() public {
    uint256 amountIn = 1 ether;

    // Declare the path array with 2 steps
    ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](2);

    // Step 1 - V3 swap
    path[0] = ArbitrageBot.SwapStep({
        router: address(routerV3),
        tokenIn: address(tokenA),
        tokenOut: address(tokenB),
        dexType: ArbitrageBot.DexType.UniswapV3, // V3
        fee: 3000
    });

    // Step 2 - V2 swap
    path[1] = ArbitrageBot.SwapStep({
        router: address(routerV2),
        tokenIn: address(tokenB),
        tokenOut: address(tokenA),
        dexType: ArbitrageBot.DexType.UniswapV2, // V2
        fee: 0
    });

    vm.expectRevert(
        abi.encodeWithSelector(
            ArbitrageBot.EstimationFailed.selector,
            "On-chain V3 estimation not supported"
        )
    );

    bot.executeArbitrage(path, amountIn, block.timestamp + 1000);
}
// ...existing code...


    function testDeadlineExpiredReverts() public {
        uint256 amountIn = 1 ether;
        tokenA.mint(address(bot), amountIn);

        routerV2.setRate(address(tokenA), address(tokenB), 1, 1);
        routerV2.setSwapRate(address(tokenA), address(tokenB), 1, 1);
        tokenB.mint(address(routerV2), 1000 ether);

        ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](1);
        path[0] = _buildPathV2(address(routerV2), address(tokenA), address(tokenB));

        // Use a deadline in the past
        vm.expectRevert();
        bot.executeArbitrage(path, amountIn, block.timestamp - 1);
    }

    function testBlacklistedTokenReverts() public {
        uint256 amountIn = 1 ether;
        tokenA.mint(address(bot), amountIn);

        // Blacklist tokenA
        bot.blacklistToken(address(tokenA));

        routerV2.setRate(address(tokenA), address(tokenB), 1, 1);
        routerV2.setSwapRate(address(tokenA), address(tokenB), 1, 1);
        tokenB.mint(address(routerV2), 1000 ether);

        ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](1);
        path[0] = _buildPathV2(address(routerV2), address(tokenA), address(tokenB));

        vm.expectRevert();
        bot.executeArbitrage(path, amountIn, block.timestamp + 1000);
    }

    function testOnlyRelayerRole() public {
        uint256 amountIn = 1 ether;

        // Start with funding bot (so other checks don't interfere)
        tokenA.mint(address(bot), amountIn);
        routerV2.setRate(address(tokenA), address(tokenB), 1, 1);
        routerV2.setSwapRate(address(tokenA), address(tokenB), 1, 1);
        tokenB.mint(address(routerV2), 1000 ether);

        ArbitrageBot.SwapStep[] memory path = new ArbitrageBot.SwapStep[](1);
        path[0] = _buildPathV2(address(routerV2), address(tokenA), address(tokenB));

        // Call from another address that doesn't have RELAYER_ROLE
        vm.prank(address(0x1234));
        vm.expectRevert(); // AccessControl revert
        bot.executeArbitrage(path, amountIn, block.timestamp + 1000);
    }
}