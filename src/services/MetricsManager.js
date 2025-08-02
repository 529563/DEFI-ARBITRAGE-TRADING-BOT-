const client = require('prom-client');
const logger = require('../utils/logger');

class MetricsManager {
    constructor() {
        // Create a Registry
        this.register = new client.Registry();
        
        // Add default metrics
        client.collectDefaultMetrics({ register: this.register });
        
        this.initializeCustomMetrics();
    }

    initializeCustomMetrics() {
        // Arbitrage opportunities counter
        this.opportunitiesFoundCounter = new client.Counter({
            name: 'arbitrage_opportunities_found_total',
            help: 'Total number of arbitrage opportunities found',
            labelNames: ['token_pair', 'buy_dex', 'sell_dex']
        });

        // Arbitrage executions counter
        this.executionsCounter = new client.Counter({
            name: 'arbitrage_executions_total',
            help: 'Total number of arbitrage executions',
            labelNames: ['token_pair', 'status']
        });

        // Profit histogram
        this.profitHistogram = new client.Histogram({
            name: 'arbitrage_profit_usd',
            help: 'Arbitrage profit in USD',
            buckets: [0, 5, 10, 25, 50, 100, 250, 500, 1000],
            labelNames: ['token_pair']
        });

        // Gas usage histogram
        this.gasUsageHistogram = new client.Histogram({
            name: 'arbitrage_gas_used',
            help: 'Gas used for arbitrage transactions',
            buckets: [100000, 150000, 200000, 250000, 300000, 400000, 500000],
            labelNames: ['token_pair']
        });

        // Execution time histogram
        this.executionTimeHistogram = new client.Histogram({
            name: 'arbitrage_execution_time_seconds',
            help: 'Time taken to execute arbitrage in seconds',
            buckets: [1, 5, 10, 30, 60, 120, 300],
            labelNames: ['token_pair']
        });

        // Active opportunities gauge
        this.activeOpportunitiesGauge = new client.Gauge({
            name: 'arbitrage_active_opportunities',
            help: 'Number of currently active arbitrage opportunities'
        });

        // DEX price gauge
        this.dexPriceGauge = new client.Gauge({
            name: 'dex_token_price_usd',
            help: 'Token price on DEX in USD',
            labelNames: ['token_pair', 'dex']
        });

        // Risk metrics gauge
        this.riskMetricsGauge = new client.Gauge({
            name: 'risk_metrics',
            help: 'Risk management metrics',
            labelNames: ['metric_type']
        });

        // Register all metrics
        this.register.registerMetric(this.opportunitiesFoundCounter);
        this.register.registerMetric(this.executionsCounter);
        this.register.registerMetric(this.profitHistogram);
        this.register.registerMetric(this.gasUsageHistogram);
        this.register.registerMetric(this.executionTimeHistogram);
        this.register.registerMetric(this.activeOpportunitiesGauge);
        this.register.registerMetric(this.dexPriceGauge);
        this.register.registerMetric(this.riskMetricsGauge);
    }

    // Record metrics methods
    recordOpportunityFound(tokenPair, buyDEX, sellDEX) {
        this.opportunitiesFoundCounter.inc({
            token_pair: tokenPair,
            buy_dex: buyDEX,
            sell_dex: sellDEX
        });
    }

    recordExecution(tokenPair, status, profit, gasUsed, executionTime) {
        this.executionsCounter.inc({
            token_pair: tokenPair,
            status: status
        });

        if (profit > 0) {
            this.profitHistogram.observe({ token_pair: tokenPair }, profit);
        }

        if (gasUsed > 0) {
            this.gasUsageHistogram.observe({ token_pair: tokenPair }, gasUsed);
        }

        if (executionTime > 0) {
            this.executionTimeHistogram.observe({ token_pair: tokenPair }, executionTime / 1000);
        }
    }

    updateActiveOpportunities(count) {
        this.activeOpportunitiesGauge.set(count);
    }

    updateDEXPrice(tokenPair, dex, price) {
        this.dexPriceGauge.set({
            token_pair: tokenPair,
            dex: dex
        }, price);
    }

    updateRiskMetrics(circuitBreakerOpen, dailyLoss, consecutiveFailures) {
        this.riskMetricsGauge.set({ metric_type: 'circuit_breaker_open' }, circuitBreakerOpen ? 1 : 0);
        this.riskMetricsGauge.set({ metric_type: 'daily_loss_usd' }, dailyLoss);
        this.riskMetricsGauge.set({ metric_type: 'consecutive_failures' }, consecutiveFailures);
    }

    // Get metrics endpoint handler
    getMetrics() {
        return this.register.metrics();
    }

    // Get metrics in JSON format
    async getMetricsJSON() {
        const metrics = await this.register.getMetricsAsJSON();
        return metrics;
    }

    // Clear all metrics (useful for testing)
    clearMetrics() {
        this.register.clear();
        this.initializeCustomMetrics();
    }
}

module.exports = MetricsManager; 