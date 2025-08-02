const database = require('./connection');
const logger = require('../utils/logger');

async function seedDatabase() {
    try {
        await database.initialize();
        logger.info('Starting database seeding...');

        // Seed sample arbitrage opportunities
        const opportunities = [
            {
                token_pair: 'WETH/USDC',
                dex_buy: 'uniswap',
                dex_sell: 'sushiswap',
                buy_price: 2000,
                sell_price: 2015,
                amount: 1,
                potential_profit: 15,
                gas_estimate: 8,
                platform_fees: 2,
                slippage_impact: 1,
                net_profit: 4,
                profit_margin: 0.2,
                status: 'detected'
            },
            {
                token_pair: 'WETH/USDT',
                dex_buy: 'sushiswap',
                dex_sell: 'pancakeswap',
                buy_price: 2005,
                sell_price: 2020,
                amount: 0.5,
                potential_profit: 7.5,
                gas_estimate: 6,
                platform_fees: 1.5,
                slippage_impact: 0.5,
                net_profit: -0.5,
                profit_margin: -0.025,
                status: 'rejected'
            }
        ];

        for (const opp of opportunities) {
            await database.query(`
                INSERT INTO arbitrage_opportunities (
                    token_pair, dex_buy, dex_sell, buy_price, sell_price, amount,
                    potential_profit, gas_estimate, platform_fees, slippage_impact,
                    net_profit, profit_margin, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                opp.token_pair, opp.dex_buy, opp.dex_sell, opp.buy_price, opp.sell_price,
                opp.amount, opp.potential_profit, opp.gas_estimate, opp.platform_fees,
                opp.slippage_impact, opp.net_profit, opp.profit_margin, opp.status
            ]);
        }

        // Seed sample executed trades
        const trades = [
            {
                opportunity_id: 1,
                transaction_hash: '0x1234567890abcdef1234567890abcdef12345678',
                block_number: 18000000,
                gas_used: 245000,
                gas_price: '25000000000',
                actual_profit: 3.8,
                status: 'success'
            },
            {
                opportunity_id: 2,
                transaction_hash: '0xabcdef1234567890abcdef1234567890abcdef12',
                block_number: 18000001,
                gas_used: 0,
                gas_price: '0',
                actual_profit: 0,
                status: 'failed',
                error_message: 'Insufficient liquidity'
            }
        ];

        for (const trade of trades) {
            await database.query(`
                INSERT INTO executed_trades (
                    opportunity_id, transaction_hash, block_number, gas_used, gas_price,
                    actual_profit, execution_time, status, error_message
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
            `, [
                trade.opportunity_id, trade.transaction_hash, trade.block_number,
                trade.gas_used, trade.gas_price, trade.actual_profit, trade.status,
                trade.error_message
            ]);
        }

        // Seed system metrics
        const metrics = [
            { metric_name: 'total_opportunities', metric_value: 150 },
            { metric_name: 'successful_trades', metric_value: 45 },
            { metric_name: 'total_profit_usd', metric_value: 1250.50 },
            { metric_name: 'avg_execution_time_ms', metric_value: 15000 }
        ];

        for (const metric of metrics) {
            await database.query(`
                INSERT INTO system_metrics (metric_name, metric_value)
                VALUES ($1, $2)
            `, [metric.metric_name, metric.metric_value]);
        }

        logger.info('Database seeding completed successfully');
        
    } catch (error) {
        logger.error('Database seeding failed:', error);
        throw error;
    } finally {
        await database.close();
    }
}

// Run seeding if called directly
if (require.main === module) {
    seedDatabase()
        .then(() => {
            console.log('Seeding completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Seeding failed:', error);
            process.exit(1);
        });
}

module.exports = seedDatabase; 