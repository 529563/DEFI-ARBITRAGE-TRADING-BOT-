const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

class ProfitCalculator {
    constructor() {
        this.gasPrice = null;
        this.lastGasPriceUpdate = 0;
        this.gasPriceUpdateInterval = 30000; // 30 seconds
    }

    async calculateNetProfit(opportunity) {
        const {
            buyPrice, sellPrice, amount,
            buyDEX, sellDEX, tokenPair
        } = opportunity;

        try {
            // Calculate gross profit
            const grossProfit = (sellPrice - buyPrice) * amount;

            // Get current gas price
            await this.updateGasPrice();

            // Estimate gas fees
            const gasEstimate = await this.estimateGasFees(opportunity);

            // Calculate platform fees
            const platformFees = this.calculatePlatformFees(
                buyPrice * amount, sellPrice * amount, buyDEX, sellDEX
            );

            // Calculate slippage impact
            const slippageImpact = await this.calculateSlippageImpact(opportunity);

            // Calculate net profit
            const netProfit = grossProfit - gasEstimate - platformFees - slippageImpact;
            const profitMargin = netProfit > 0 ? (netProfit / (buyPrice * amount)) * 100 : 0;

            return {
                grossProfit,
                gasEstimate,
                platformFees,
                slippageImpact,
                netProfit,
                profitMargin,
                profitable: netProfit >= config.trading.minProfitUSD,
                breakdown: {
                    buyAmount: buyPrice * amount,
                    sellAmount: sellPrice * amount,
                    buyFee: (buyPrice * amount) * config.dexes[buyDEX].fee,
                    sellFee: (sellPrice * amount) * config.dexes[sellDEX].fee,
                    gasEstimateGwei: this.gasPrice ? ethers.formatUnits(this.gasPrice, 'gwei') : 0
                }
            };
        } catch (error) {
            logger.error('Profit calculation failed:', error);
            throw error;
        }
    }

    calculatePlatformFees(buyAmount, sellAmount, buyDEX, sellDEX) {
        const buyDEXConfig = config.dexes[buyDEX];
        const sellDEXConfig = config.dexes[sellDEX];

        if (!buyDEXConfig || !sellDEXConfig) {
            logger.warn(`Unknown DEX in fee calculation: ${buyDEX} or ${sellDEX}`);
            return (buyAmount + sellAmount) * 0.003; // Default 0.3% fee
        }

        const buyFee = buyAmount * buyDEXConfig.fee;
        const sellFee = sellAmount * sellDEXConfig.fee;

        return buyFee + sellFee;
    }

    async estimateGasFees(opportunity) {
        try {
            // Base gas estimate for arbitrage transaction
            const baseGasLimit = config.blockchain.networks.ethereum.gasLimit;
            
            // Add buffer for complexity
            const gasLimit = Math.floor(baseGasLimit * (1 + config.trading.gasBufferPercent / 100));
            
            // Calculate gas cost
            const gasCost = BigInt(gasLimit) * BigInt(this.gasPrice || '20000000000'); // 20 gwei default
            
            // Convert to USD (approximate ETH price)
            const ethPriceUSD = await this.getETHPriceUSD();
            const gasCostETH = parseFloat(ethers.formatEther(gasCost));
            const gasCostUSD = gasCostETH * ethPriceUSD;

            return gasCostUSD;
        } catch (error) {
            logger.error('Gas fee estimation failed:', error);
            // Return conservative estimate
            return 50; // $50 USD
        }
    }

    async calculateSlippageImpact(opportunity) {
        const { amount, buyDEX, sellDEX, tokenPair } = opportunity;
        
        try {
            // Estimate slippage for both DEXs
            const DEXPriceFetcher = require('./DEXPriceFetcher');
            const priceFetcher = new DEXPriceFetcher();
            
            const buySlippage = await priceFetcher.estimateSlippageImpact(
                config.dexes[buyDEX], tokenPair, amount
            );
            
            const sellSlippage = await priceFetcher.estimateSlippageImpact(
                config.dexes[sellDEX], tokenPair, amount
            );

            // Calculate total slippage impact in USD
            const totalSlippagePercent = buySlippage.slippagePercent + sellSlippage.slippagePercent;
            const slippageImpactUSD = (opportunity.buyPrice * amount) * (totalSlippagePercent / 100);

            return slippageImpactUSD;
        } catch (error) {
            logger.error('Slippage calculation failed:', error);
            // Return conservative estimate based on amount
            return (opportunity.buyPrice * amount) * (config.trading.slippageTolerancePercent / 100);
        }
    }

    async updateGasPrice() {
        const now = Date.now();
        if (now - this.lastGasPriceUpdate < this.gasPriceUpdateInterval) {
            return;
        }

        try {
            const provider = new ethers.JsonRpcProvider(config.blockchain.networks.ethereum.rpcUrl);
            const feeData = await provider.getFeeData();
            
            // Use EIP-1559 gas pricing if available
            this.gasPrice = feeData.gasPrice || feeData.maxFeePerGas || '20000000000';
            this.lastGasPriceUpdate = now;
            
            logger.debug(`Gas price updated: ${ethers.formatUnits(this.gasPrice, 'gwei')} gwei`);
        } catch (error) {
            logger.error('Failed to update gas price:', error);
        }
    }

    async getETHPriceUSD() {
        try {
            // Use a price API or oracle
            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            return response.data.ethereum.usd;
        } catch (error) {
            logger.error('Failed to get ETH price:', error);
            return 2000; // Default fallback price
        }
    }

    calculateMinimumProfitThreshold(amount, tokenPrice) {
        // Dynamic minimum profit based on transaction size
        const transactionValueUSD = amount * tokenPrice;
        const baseMinProfit = config.trading.minProfitUSD;
        
        // Scale minimum profit with transaction size
        const dynamicMinProfit = Math.max(
            baseMinProfit,
            transactionValueUSD * 0.005 // 0.5% of transaction value
        );

        return dynamicMinProfit;
    }
}

module.exports = ProfitCalculator; 