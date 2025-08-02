const ProfitCalculator = require('../../src/services/ProfitCalculator');

describe('ProfitCalculator', () => {
    let calculator;

    beforeEach(() => {
        calculator = new ProfitCalculator();
    });

    describe('calculateNetProfit', () => {
        it('should calculate net profit correctly for profitable opportunity', async () => {
            const opportunity = {
                buyPrice: 2000,
                sellPrice: 2010,
                amount: 1,
                buyDEX: 'uniswap',
                sellDEX: 'sushiswap',
                tokenPair: 'WETH/USDC'
            };

            const result = await calculator.calculateNetProfit(opportunity);

            expect(result.grossProfit).toBe(10);
            expect(result.netProfit).toBeGreaterThan(0);
            expect(result.profitable).toBe(true);
            expect(result.profitMargin).toBeGreaterThan(0);
        });

        it('should calculate net loss for unprofitable opportunity', async () => {
            const opportunity = {
                buyPrice: 2000,
                sellPrice: 2005,
                amount: 1,
                buyDEX: 'uniswap',
                sellDEX: 'sushiswap',
                tokenPair: 'WETH/USDC'
            };

            const result = await calculator.calculateNetProfit(opportunity);

            expect(result.grossProfit).toBe(5);
            expect(result.netProfit).toBeLessThan(5); // After fees and gas
            expect(result.profitable).toBe(false);
        });
    });

    describe('calculatePlatformFees', () => {
        it('should calculate fees for different DEXs', () => {
            const buyAmount = 2000;
            const sellAmount = 2010;

            const fees = calculator.calculatePlatformFees(
                buyAmount, sellAmount, 'uniswap', 'sushiswap'
            );

            // Uniswap 0.3% + SushiSwap 0.3%
            const expectedFees = (buyAmount * 0.003) + (sellAmount * 0.003);
            expect(fees).toBe(expectedFees);
        });

        it('should use default fee for unknown DEX', () => {
            const buyAmount = 1000;
            const sellAmount = 1005;

            const fees = calculator.calculatePlatformFees(
                buyAmount, sellAmount, 'unknown_dex', 'sushiswap'
            );

            expect(fees).toBeGreaterThan(0);
        });
    });
}); 