const ArbitrageEngine = require('../../src/services/ArbitrageEngine');
const EventEmitter = require('events');

describe('ArbitrageEngine', () => {
    let engine;

    beforeEach(async () => {
        engine = new ArbitrageEngine();
        // Mock the contract interaction to avoid real blockchain calls
        engine.contractInteraction = {
            initialize: jest.fn(),
            executeArbitrage: jest.fn().mockResolvedValue('0x123'),
            waitForTransaction: jest.fn().mockResolvedValue({
                blockNumber: 18000000,
                gasUsed: 250000,
                gasPrice: '20000000000',
                status: 1
            })
        };
        await engine.initialize();
    });

    afterEach(async () => {
        await engine.stopMonitoring();
    });

    describe('findArbitrageOpportunities', () => {
        it('should find opportunities when price differences exist', async () => {
            const mockPrices = {
                uniswap: {
                    'WETH/USDC': { price: 2000, timestamp: Date.now() }
                },
                sushiswap: {
                    'WETH/USDC': { price: 2015, timestamp: Date.now() }
                }
            };

            const opportunities = await engine.findArbitrageOpportunities(mockPrices);
            
            expect(opportunities.length).toBeGreaterThan(0);
            expect(opportunities[0].priceDifferencePercent).toBeGreaterThan(0);
        });

        it('should not find opportunities when prices are similar', async () => {
            const mockPrices = {
                uniswap: {
                    'WETH/USDC': { price: 2000, timestamp: Date.now() }
                },
                sushiswap: {
                    'WETH/USDC': { price: 2001, timestamp: Date.now() }
                }
            };

            const opportunities = await engine.findArbitrageOpportunities(mockPrices);
            
            expect(opportunities.length).toBe(0);
        });
    });

    describe('event emission', () => {
        it('should emit arbitrageExecuted event on successful trade', (done) => {
            const opportunity = createMockOpportunity();

            engine.once('arbitrageExecuted', (data) => {
                expect(data.opportunity).toBeDefined();
                expect(data.transactionHash).toBe('0x123');
                expect(data.actualProfit).toBeGreaterThan(0);
                done();
            });

            engine.executeArbitrage(opportunity);
        });
    });
}); 