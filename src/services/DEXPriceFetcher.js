const axios = require('axios');
const { ethers } = require('ethers');
const config = require('../config/config');
const logger = require('../utils/logger');
const Cache = require('./Cache');

class DEXPriceFetcher {
    constructor() {
        this.dexConfigs = config.dexes;
        this.providers = {};
        this.cache = new Cache();
        this.rateLimiters = new Map();
        
        // Initialize providers
        this.initializeProviders();
    }

    initializeProviders() {
        // Initialize blockchain providers for each network
        for (const [networkName, networkConfig] of Object.entries(config.blockchain.networks)) {
            this.providers[networkName] = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
        }
    }

    async fetchAllPrices(tokenPairs) {
        const priceData = {};
        
        for (const [dexName, dexConfig] of Object.entries(this.dexConfigs)) {
            try {
                priceData[dexName] = await this.fetchDEXPrices(dexName, tokenPairs);
            } catch (error) {
                logger.error(`Failed to fetch prices from ${dexName}:`, error);
                priceData[dexName] = {};
            }
        }
        
        return priceData;
    }

    async fetchDEXPrices(dexName, tokenPairs) {
        const cacheKey = `prices_${dexName}_${Date.now()}`;
        const cached = await this.cache.get(cacheKey);
        
        if (cached) {
            return cached;
        }

        const prices = {};
        const dexConfig = this.dexConfigs[dexName];
        
        for (const tokenPair of tokenPairs) {
            try {
                const price = await this.fetchTokenPairPrice(dexConfig, tokenPair);
                prices[tokenPair] = price;
            } catch (error) {
                logger.error(`Failed to fetch ${tokenPair} price from ${dexName}:`, error);
                prices[tokenPair] = null;
            }
        }
        
        // Cache for 1 second
        await this.cache.set(cacheKey, prices, 1);
        return prices;
    }

    async fetchTokenPairPrice(dexConfig, tokenPair) {
        const [tokenA, tokenB] = tokenPair.split('/');
        
        // Try GraphQL API first (faster)
        try {
            return await this.fetchPriceFromGraph(dexConfig, tokenA, tokenB);
        } catch (error) {
            logger.debug('GraphQL fetch failed, falling back to RPC:', error.message);
        }
        
        // Fallback to direct contract calls
        return await this.fetchPriceFromContract(dexConfig, tokenA, tokenB);
    }

    async fetchPriceFromGraph(dexConfig, tokenA, tokenB) {
        if (!dexConfig.graphUrl) {
            throw new Error('No GraphQL URL configured');
        }

        const query = `
            query {
                pairs(where: {
                    token0: "${tokenA.toLowerCase()}",
                    token1: "${tokenB.toLowerCase()}"
                }) {
                    token0Price
                    token1Price
                    reserveUSD
                    volumeUSD
                }
            }
        `;

        const response = await axios.post(dexConfig.graphUrl, { query });
        
        if (response.data.errors) {
            throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
        }

        const pairs = response.data.data.pairs;
        if (pairs.length === 0) {
            throw new Error('Pair not found');
        }

        const pair = pairs[0];
        return {
            price: parseFloat(pair.token0Price),
            reserveUSD: parseFloat(pair.reserveUSD),
            volumeUSD: parseFloat(pair.volumeUSD),
            timestamp: Date.now()
        };
    }

    async fetchPriceFromContract(dexConfig, tokenA, tokenB) {
        const provider = this.providers.ethereum; // Default to Ethereum
        
        // Uniswap V2 style price fetching
        const factoryABI = [
            'function getPair(address tokenA, address tokenB) external view returns (address pair)'
        ];
        
        const pairABI = [
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() external view returns (address)',
            'function token1() external view returns (address)'
        ];

        const factory = new ethers.Contract(dexConfig.factory, factoryABI, provider);
        const pairAddress = await factory.getPair(tokenA, tokenB);
        
        if (pairAddress === ethers.ZeroAddress) {
            throw new Error('Pair does not exist');
        }

        const pair = new ethers.Contract(pairAddress, pairABI, provider);
        const [reserve0, reserve1] = await pair.getReserves();
        const token0 = await pair.token0();
        
        const isToken0A = token0.toLowerCase() === tokenA.toLowerCase();
        const reserveA = isToken0A ? reserve0 : reserve1;
        const reserveB = isToken0A ? reserve1 : reserve0;
        
        const price = Number(reserveB) / Number(reserveA);
        
        return {
            price,
            reserveA: ethers.formatEther(reserveA),
            reserveB: ethers.formatEther(reserveB),
            timestamp: Date.now()
        };
    }

    async estimateSlippageImpact(dexConfig, tokenPair, amount) {
        try {
            const priceData = await this.fetchTokenPairPrice(dexConfig, tokenPair);
            const reserveA = parseFloat(priceData.reserveA);
            const reserveB = parseFloat(priceData.reserveB);
            
            // Calculate price impact using constant product formula
            const amountOut = (amount * reserveB) / (reserveA + amount);
            const expectedAmountOut = amount * priceData.price;
            const slippage = Math.abs(expectedAmountOut - amountOut) / expectedAmountOut;
            
            return {
                slippagePercent: slippage * 100,
                expectedAmountOut,
                actualAmountOut: amountOut,
                priceImpact: slippage
            };
        } catch (error) {
            logger.error('Failed to estimate slippage:', error);
            return {
                slippagePercent: config.trading.maxSlippagePercent,
                priceImpact: config.trading.maxSlippagePercent / 100
            };
        }
    }
}

module.exports = DEXPriceFetcher; 