const EventEmitter = require('events');
const DEXPriceFetcher = require('./DEXPriceFetcher');
const ProfitCalculator = require('./ProfitCalculator');
const RiskManager = require('./RiskManager');
const ContractInteraction = require('./ContractInteraction');
const database = require('../database/connection');
const logger = require('../utils/logger');
const config = require('../config/config');

class ArbitrageEngine extends EventEmitter {
    constructor() {
        super();
        this.priceFetcher = new DEXPriceFetcher();
        this.profitCalculator = new ProfitCalculator();
        this.riskManager = new RiskManager();
        this.contractInteraction = new ContractInteraction();
        
        this.isRunning = false;
        this.monitoringInterval = null;
        this.tokenPairs = ['WETH/USDC', 'WETH/USDT', 'WETH/DAI']; // Default pairs
        this.opportunities = new Map();
        
        this.metrics = {
            opportunitiesFound: 0,
            tradesExecuted: 0,
            successfulTrades: 0,
            totalProfit: 0,
            averageExecutionTime: 0
        };
    }

    async initialize() {
        try {
            await this.contractInteraction.initialize();
            await this.riskManager.initialize();
            
            // Load token pairs from config or database
            await this.loadTokenPairs();
            
            logger.info('Arbitrage Engine initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Arbitrage Engine:', error);
            throw error;
        }
    }

    async loadTokenPairs() {
        // Load from database or use defaults
        try {
            const result = await database.query(
                'SELECT DISTINCT token_pair FROM arbitrage_opportunities WHERE created_at > NOW() - INTERVAL \'7 days\''
            );
            
            if (result.rows.length > 0) {
                this.tokenPairs = result.rows.map(row => row.token_pair);
            }
            
            logger.info(`Loaded ${this.tokenPairs.length} token pairs for monitoring`);
        } catch (error) {
            logger.warn('Failed to load token pairs from database, using defaults:', error);
        }
    }

    async startMonitoring() {
        if (this.isRunning) {
            logger.warn('Arbitrage monitoring is already running');
            return;
        }

        this.isRunning = true;
        logger.info('Starting arbitrage monitoring...');

        // Start the main monitoring loop
        this.monitoringInterval = setInterval(
            () => this.monitoringLoop(),
            config.trading.priceUpdateIntervalMs
        );

        // Start monitoring loop immediately
        this.monitoringLoop();
    }

    async stopMonitoring() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        logger.info('Arbitrage monitoring stopped');
    }

    async monitoringLoop() {
        try {
            // Check if risk manager allows trading
            if (!await this.riskManager.canTrade()) {
                logger.debug('Trading paused by risk manager');
                return;
            }

            // Fetch prices from all DEXs
            const allPrices = await this.priceFetcher.fetchAllPrices(this.tokenPairs);
            
            // Find arbitrage opportunities
            const opportunities = await this.findArbitrageOpportunities(allPrices);
            
            // Process each opportunity
            for (const opportunity of opportunities) {
                await this.processOpportunity(opportunity);
            }

            // Clean up expired opportunities
            this.cleanupExpiredOpportunities();

        } catch (error) {
            logger.error('Error in monitoring loop:', error);
            await this.riskManager.recordFailure(error);
        }
    }

    async findArbitrageOpportunities(allPrices) {
        const opportunities = [];

        for (const tokenPair of this.tokenPairs) {
            const dexNames = Object.keys(allPrices);
            
            // Compare prices across all DEX combinations
            for (let i = 0; i < dexNames.length; i++) {
                for (let j = i + 1; j < dexNames.length; j++) {
                    const dex1 = dexNames[i];
                    const dex2 = dexNames[j];
                    
                    const price1 = allPrices[dex1][tokenPair];
                    const price2 = allPrices[dex2][tokenPair];
                    
                    if (!price1 || !price2) continue;
                    
                    // Check both directions
                    const opp1 = this.createOpportunity(tokenPair, dex1, dex2, price1.price, price2.price);
                    const opp2 = this.createOpportunity(tokenPair, dex2, dex1, price2.price, price1.price);
                    
                    if (opp1) opportunities.push(opp1);
                    if (opp2) opportunities.push(opp2);
                }
            }
        }

        return opportunities;
    }

    createOpportunity(tokenPair, buyDEX, sellDEX, buyPrice, sellPrice) {
        // Check if there's a price difference worth considering
        const priceDifference = sellPrice - buyPrice;
        const priceDifferencePercent = (priceDifference / buyPrice) * 100;
        
        if (priceDifferencePercent < 0.5) { // Less than 0.5% difference
            return null;
        }

        // Calculate optimal trade amount based on liquidity
        const amount = this.calculateOptimalAmount(tokenPair, buyPrice, sellPrice);
        
        return {
            id: `${tokenPair}_${buyDEX}_${sellDEX}_${Date.now()}`,
            tokenPair,
            buyDEX,
            sellDEX,
            buyPrice,
            sellPrice,
            amount,
            priceDifference,
            priceDifferencePercent,
            timestamp: Date.now()
        };
    }

    calculateOptimalAmount(tokenPair, buyPrice, sellPrice) {
        // Simple implementation - use fixed amount for now
        // In production, this should consider liquidity depth, gas costs, etc.
        const maxTransactionValueUSD = config.trading.maxTransactionValue;
        const optimalAmountUSD = Math.min(maxTransactionValueUSD, 1000); // Start with $1000
        
        return optimalAmountUSD / buyPrice;
    }

    async processOpportunity(opportunity) {
        try {
            const opportunityId = opportunity.id;
            
            // Skip if already processing this opportunity
            if (this.opportunities.has(opportunityId)) {
                return;
            }

            this.opportunities.set(opportunityId, opportunity);
            this.metrics.opportunitiesFound++;

            // Calculate detailed profit
            const profitAnalysis = await this.profitCalculator.calculateNetProfit(opportunity);
            
            // Enhanced opportunity with profit analysis
            const enhancedOpportunity = {
                ...opportunity,
                ...profitAnalysis
            };

            // Validate with risk manager
            const isValid = await this.riskManager.validateOpportunity(enhancedOpportunity);
            
            if (!isValid) {
                logger.debug(`Opportunity ${opportunityId} rejected by risk manager`);
                await this.recordOpportunity(enhancedOpportunity, 'rejected');
                return;
            }

            // Record opportunity in database
            await this.recordOpportunity(enhancedOpportunity, 'validated');

            // Execute if profitable
            if (enhancedOpportunity.profitable) {
                await this.executeArbitrage(enhancedOpportunity);
            } else {
                logger.debug(`Opportunity ${opportunityId} not profitable: $${enhancedOpportunity.netProfit.toFixed(2)}`);
            }

        } catch (error) {
            logger.error(`Error processing opportunity ${opportunity.id}:`, error);
        } finally {
            // Clean up
            this.opportunities.delete(opportunity.id);
        }
    }

    async recordOpportunity(opportunity, status) {
        try {
            await database.query(`
                INSERT INTO arbitrage_opportunities (
                    token_pair, dex_buy, dex_sell, buy_price, sell_price, amount,
                    potential_profit, gas_estimate, platform_fees, slippage_impact,
                    net_profit, profit_margin, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                opportunity.tokenPair,
                opportunity.buyDEX,
                opportunity.sellDEX,
                opportunity.buyPrice,
                opportunity.sellPrice,
                opportunity.amount,
                opportunity.grossProfit || 0,
                opportunity.gasEstimate || 0,
                opportunity.platformFees || 0,
                opportunity.slippageImpact || 0,
                opportunity.netProfit || 0,
                opportunity.profitMargin || 0,
                status
            ]);
        } catch (error) {
            logger.error('Failed to record opportunity:', error);
        }
    }

    async executeArbitrage(opportunity) {
        const startTime = Date.now();
        let transactionHash = null;

        try {
            logger.info(`Executing arbitrage for ${opportunity.tokenPair}: Buy ${opportunity.buyDEX} -> Sell ${opportunity.sellDEX}, Expected profit: $${opportunity.netProfit.toFixed(2)}`);

            // Execute the arbitrage transaction
            transactionHash = await this.contractInteraction.executeArbitrage(opportunity);
            
            // Wait for transaction confirmation
            const receipt = await this.contractInteraction.waitForTransaction(transactionHash);
            
            // Calculate actual results
            const executionTime = Date.now() - startTime;
            const actualProfit = await this.calculateActualProfit(receipt, opportunity);
            
            // Update metrics
            this.metrics.tradesExecuted++;
            this.metrics.successfulTrades++;
            this.metrics.totalProfit += actualProfit;
            this.metrics.averageExecutionTime = (
                (this.metrics.averageExecutionTime * (this.metrics.tradesExecuted - 1) + executionTime) / 
                this.metrics.tradesExecuted
            );

            // Record successful trade
            await this.recordTrade(opportunity, transactionHash, receipt, actualProfit, 'success');
            
            logger.info(`Arbitrage executed successfully! Profit: $${actualProfit.toFixed(2)}, Gas used: ${receipt.gasUsed}`);
            
            // Emit success event
            this.emit('arbitrageExecuted', {
                opportunity,
                transactionHash,
                actualProfit,
                executionTime
            });

        } catch (error) {
            logger.error(`Arbitrage execution failed for ${opportunity.tokenPair}:`, error);
            
            // Record failed trade
            await this.recordTrade(opportunity, transactionHash, null, 0, 'failed', error.message);
            
            // Update risk manager
            await this.riskManager.recordFailure(error);
            
            // Emit failure event
            this.emit('arbitrageFailed', {
                opportunity,
                error: error.message
            });
        }
    }

    async calculateActualProfit(receipt, opportunity) {
        try {
            // Parse transaction logs to get actual amounts
            // This is a simplified calculation - in production, parse the actual token transfer events
            const gasUsed = BigInt(receipt.gasUsed);
            const gasPrice = BigInt(receipt.gasPrice || receipt.effectiveGasPrice);
            const gasCostWei = gasUsed * gasPrice;
            
            // Convert gas cost to USD
            const ethPriceUSD = await this.profitCalculator.getETHPriceUSD();
            const gasCostUSD = parseFloat(ethers.formatEther(gasCostWei)) * ethPriceUSD;
            
            // For now, use the estimated profit minus actual gas cost
            // In production, calculate from actual token transfers
            return Math.max(0, opportunity.grossProfit - gasCostUSD - opportunity.platformFees);
            
        } catch (error) {
            logger.error('Failed to calculate actual profit:', error);
            return 0;
        }
    }

    async recordTrade(opportunity, transactionHash, receipt, actualProfit, status, errorMessage = null) {
        try {
            // First get the opportunity ID from database
            const oppResult = await database.query(
                'SELECT id FROM arbitrage_opportunities WHERE token_pair = $1 AND dex_buy = $2 AND dex_sell = $3 ORDER BY created_at DESC LIMIT 1',
                [opportunity.tokenPair, opportunity.buyDEX, opportunity.sellDEX]
            );

            const opportunityId = oppResult.rows[0]?.id;

            await database.query(`
                INSERT INTO executed_trades (
                    opportunity_id, transaction_hash, block_number, gas_used, gas_price,
                    actual_profit, execution_time, status, error_message
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                opportunityId,
                transactionHash,
                receipt?.blockNumber || null,
                receipt?.gasUsed || null,
                receipt?.gasPrice || receipt?.effectiveGasPrice || null,
                actualProfit,
                new Date(),
                status,
                errorMessage
            ]);
        } catch (error) {
            logger.error('Failed to record trade:', error);
        }
    }

    cleanupExpiredOpportunities() {
        const now = Date.now();
        const timeout = config.trading.opportunityTimeoutMs;
        
        for (const [id, opportunity] of this.opportunities.entries()) {
            if (now - opportunity.timestamp > timeout) {
                this.opportunities.delete(id);
            }
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            isRunning: this.isRunning,
            activeOpportunities: this.opportunities.size,
            tokenPairsMonitored: this.tokenPairs.length,
            averageSuccessRate: this.metrics.tradesExecuted > 0 ? 
                (this.metrics.successfulTrades / this.metrics.tradesExecuted) * 100 : 0
        };
    }
}

module.exports = ArbitrageEngine; 