const database = require('../src/database/connection');
const { createClient } = require('redis');

// Global test setup
beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = 'arbitrage_bot_test';
    process.env.LOG_LEVEL = 'error';
    
    // Initialize test database
    await database.initialize();
    
    // Clear all tables before tests
    await database.query('TRUNCATE TABLE executed_trades, arbitrage_opportunities, system_metrics RESTART IDENTITY CASCADE');
});

afterAll(async () => {
    // Clean up database connection
    await database.close();
});

// Helper functions for tests
global.createMockOpportunity = (overrides = {}) => {
    return {
        id: 'test_opportunity_1',
        tokenPair: 'WETH/USDC',
        buyDEX: 'uniswap',
        sellDEX: 'sushiswap',
        buyPrice: 2000,
        sellPrice: 2010,
        amount: 1,
        grossProfit: 10,
        gasEstimate: 5,
        platformFees: 1,
        slippageImpact: 0.5,
        netProfit: 3.5,
        profitMargin: 0.175,
        profitable: true,
        timestamp: Date.now(),
        ...overrides
    };
};

global.createMockTrade = (overrides = {}) => {
    return {
        transactionHash: '0x1234567890abcdef',
        blockNumber: 18000000,
        gasUsed: 250000,
        gasPrice: '20000000000',
        actualProfit: 3.2,
        status: 'success',
        ...overrides
    };
}; 