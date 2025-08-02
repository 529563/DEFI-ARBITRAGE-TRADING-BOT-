const RiskManager = require('../../src/services/RiskManager');

describe('RiskManager', () => {
    let riskManager;

    beforeEach(async () => {
        riskManager = new RiskManager();
        await riskManager.initialize();
    });

    describe('validateOpportunity', () => {
        it('should validate profitable opportunity', async () => {
            const opportunity = createMockOpportunity({
                netProfit: 15, // Above minimum threshold
                slippageImpact: 1, // Low slippage
                buyPrice: 2000,
                amount: 1
            });

            const isValid = await riskManager.validateOpportunity(opportunity);
            expect(isValid).toBe(true);
        });

        it('should reject low profit opportunity', async () => {
            const opportunity = createMockOpportunity({
                netProfit: 5, // Below minimum threshold
            });

            const isValid = await riskManager.validateOpportunity(opportunity);
            expect(isValid).toBe(false);
        });

        it('should reject high slippage opportunity', async () => {
            const opportunity = createMockOpportunity({
                netProfit: 20,
                slippageImpact: 200, // Very high slippage
                buyPrice: 2000,
                amount: 1
            });

            const isValid = await riskManager.validateOpportunity(opportunity);
            expect(isValid).toBe(false);
        });
    });

    describe('circuit breaker', () => {
        it('should open circuit breaker after consecutive failures', async () => {
            // Simulate multiple failures
            for (let i = 0; i < 6; i++) {
                await riskManager.recordFailure(new Error('Test failure'));
            }

            const canTrade = await riskManager.canTrade();
            expect(canTrade).toBe(false);
            expect(riskManager.getRiskMetrics().circuitBreakerOpen).toBe(true);
        });
    });
}); 