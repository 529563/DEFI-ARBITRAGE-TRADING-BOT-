module.exports = {
    // Database configuration
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'arbitrage_bot',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        pool: {
            min: 2,
            max: 10
        }
    },

    // Redis configuration
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || null
    },

    // Blockchain configuration
    blockchain: {
        networks: {
            ethereum: {
                rpcUrl: process.env.ETHEREUM_RPC_URL,
                chainId: 1,
                gasLimit: 300000,
                maxGasPrice: '50000000000' // 50 gwei
            },
            polygon: {
                rpcUrl: process.env.POLYGON_RPC_URL,
                chainId: 137,
                gasLimit: 300000,
                maxGasPrice: '30000000000' // 30 gwei
            }
        },
        privateKey: process.env.PRIVATE_KEY,
        contractAddress: process.env.ARBITRAGE_CONTRACT_ADDRESS
    },

    // DEX configuration
    dexes: {
        uniswap: {
            name: 'Uniswap V2',
            router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
            factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            fee: 0.003, // 0.3%
            graphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2'
        },
        sushiswap: {
            name: 'SushiSwap',
            router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
            factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
            fee: 0.003, // 0.3%
            graphUrl: 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange'
        },
        pancakeswap: {
            name: 'PancakeSwap',
            router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
            fee: 0.0025, // 0.25%
            graphUrl: 'https://bsc.streamingfast.io/subgraphs/name/pancakeswap2'
        }
    },

    // Trading configuration
    trading: {
        minProfitUSD: 10, // Minimum profit in USD
        maxSlippagePercent: 5, // Maximum slippage tolerance
        slippageTolerancePercent: 3, // Default slippage tolerance
        maxTransactionValue: 10000, // Maximum transaction value in USD
        gasBufferPercent: 20, // Gas estimation buffer
        priceUpdateIntervalMs: 1000, // Price update interval
        opportunityTimeoutMs: 30000 // Opportunity timeout
    },

    // Risk management
    risk: {
        maxDailyLoss: 1000, // Maximum daily loss in USD
        maxConsecutiveFailures: 5,
        circuitBreakerTimeoutMs: 300000, // 5 minutes
        minLiquidityUSD: 50000 // Minimum liquidity requirement
    }
}; 