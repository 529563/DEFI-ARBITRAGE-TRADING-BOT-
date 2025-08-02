const config = require('../config/config');
const database = require('../database/connection');
const logger = require('../utils/logger');

class RiskManager {
    constructor() {
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenTime = 0;
        this.consecutiveFailures = 0;
        this.dailyLoss = 0;
        this.lastResetDate = new Date().toDateString();
        this.tradingPaused = false;
    }

    async initialize() {
        // Load current daily loss from database
        await this.loadDailyMetrics();
        logger.info('Risk Manager initialized');
    }

    async loadDailyMetrics() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await database.query(`
                SELECT 
                    COALESCE(SUM(CASE WHEN actual_profit < 0 THEN ABS(actual_profit) ELSE 0 END), 0) as daily_loss,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failure_count
                FROM executed_trades 
                WHERE DATE(execution_time) = $1
            `, [today]);

            if (result.rows.length > 0) {
                this.dailyLoss = parseFloat(result.rows[0].daily_loss) || 0;
            }
        } catch (error) {
            logger.error('Failed to load daily metrics:', error);
        }
    }

    async canTrade() {
        // Check if trading is manually paused
        if (this.tradingPaused) {
            return false;
        }

        // Check circuit breaker
        if (this.circuitBreakerOpen) {
            const timeElapsed = Date.now() - this.circuitBreakerOpenTime;
            if (timeElapsed < config.risk.circuitBreakerTimeoutMs) {
                return false;
            } else {
                // Reset circuit breaker
                this.circuitBreakerOpen = false;
                this.consecutiveFailures = 0;
                logger.info('Circuit breaker reset');
            }
        }

        // Check daily loss limit
        if (this.dailyLoss >= config.risk.maxDailyLoss) {
            logger.warn(`Daily loss limit reached: $${this.dailyLoss}`);
            return false;
        }

        // Reset daily metrics if new day
        const currentDate = new Date().toDateString();
        if (currentDate !== this.lastResetDate) {
            this.dailyLoss = 0;
            this.lastResetDate = currentDate;
            logger.info('Daily metrics reset');
        }

        return true;
    }

    async validateOpportunity(opportunity) {
        try {
            const validations = [
                this.checkProfitThreshold(opportunity),
                this.checkSlippageTolerance(opportunity),
                await this.checkLiquidityRequirements(opportunity),
                this.checkTransactionValue(opportunity),
                await this.checkTokenSafety(opportunity)
            ];

            const results = await Promise.all(validations);
            const allPassed = results.every(result => result.passed);

            if (!allPassed) {
                const failedChecks = results.filter(r => !r.passed).map(r => r.reason);
                logger.debug(`Opportunity validation failed: ${failedChecks.join(', ')}`);
            }

            return allPassed;
        } catch (error) {
            logger.error('Opportunity validation error:', error);
            return false;
        }
    }

    checkProfitThreshold(opportunity) {
        const minProfit = config.trading.minProfitUSD;
        const passed = opportunity.netProfit >= minProfit;
        
        return {
            passed,
            reason: `Net profit $${opportunity.netProfit.toFixed(2)} must be >= $${minProfit}`
        };
    }

    checkSlippageTolerance(opportunity) {
        const maxSlippage = config.trading.maxSlippagePercent;
        const estimatedSlippage = (opportunity.slippageImpact / (opportunity.buyPrice * opportunity.amount)) * 100;
        const passed = estimatedSlippage <= maxSlippage;
        
        return {
            passed,
            reason: `Slippage ${estimatedSlippage.toFixed(2)}% must be <= ${maxSlippage}%`
        };
    }

    async checkLiquidityRequirements(opportunity) {
        try {
            // This should integrate with the DEX price fetcher to check actual liquidity
            const transactionValue = opportunity.buyPrice * opportunity.amount;
            const minLiquidity = config.risk.minLiquidityUSD;
            
            // For now, use a simple heuristic based on transaction size
            const passed = transactionValue <= minLiquidity * 0.1; // Max 10% of liquidity
            
            return {
                passed,
                reason: `Transaction value $${transactionValue.toFixed(2)} exceeds liquidity threshold`
            };
        } catch (error) {
            logger.error('Liquidity check failed:', error);
            return { passed: false, reason: 'Liquidity check failed' };
        }
    }

    checkTransactionValue(opportunity) {
        const transactionValue = opportunity.buyPrice * opportunity.amount;
        const maxValue = config.trading.maxTransactionValue;
        const passed = transactionValue <= maxValue;
        
        return {
            passed,
            reason: `Transaction value $${transactionValue.toFixed(2)} must be <= $${maxValue}`
        };
    }

    async checkTokenSafety(opportunity) {
        // Implement token safety checks (blacklist, contract verification, etc.)
        // For now, return true
        return {
            passed: true,
            reason: 'Token safety check passed'
        };
    }

    async recordFailure(error) {
        this.consecutiveFailures++;
        
        // Open circuit breaker if too many failures
        if (this.consecutiveFailures >= config.risk.maxConsecutiveFailures) {
            this.circuitBreakerOpen = true;
            this.circuitBreakerOpenTime = Date.now();
            logger.warn(`Circuit breaker opened after ${this.consecutiveFailures} consecutive failures`);
        }

        // Record failure in database for analysis
        try {
            await database.query(`
                INSERT INTO system_metrics (metric_name, metric_value, timestamp)
                VALUES ('failure_count', 1, NOW())
            `);
        } catch (dbError) {
            logger.error('Failed to record failure metric:', dbError);
        }
    }

    recordSuccess() {
        // Reset consecutive failures on success
        this.consecutiveFailures = 0;
    }

    recordLoss(amount) {
        this.dailyLoss += Math.abs(amount);
    }

    pauseTrading() {
        this.tradingPaused = true;
        logger.warn('Trading manually paused');
    }

    resumeTrading() {
        this.tradingPaused = false;
        logger.info('Trading manually resumed');
    }

    getRiskMetrics() {
        return {
            circuitBreakerOpen: this.circuitBreakerOpen,
            consecutiveFailures: this.consecutiveFailures,
            dailyLoss: this.dailyLoss,
            maxDailyLoss: config.risk.maxDailyLoss,
            tradingPaused: this.tradingPaused,
            canTrade: this.canTrade()
        };
    }
}

module.exports = RiskManager; 