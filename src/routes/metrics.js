const express = require('express');
const router = express.Router();
const database = require('../database/connection');
const logger = require('../utils/logger');

// Get system metrics
router.get('/', async (req, res) => {
    try {
        // Get recent performance metrics
        const performanceMetrics = await database.query(`
            SELECT 
                COUNT(*) as total_trades,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_trades,
                AVG(actual_profit) as avg_profit,
                SUM(actual_profit) as total_profit,
                AVG(gas_used) as avg_gas_used
            FROM executed_trades
            WHERE execution_time > NOW() - INTERVAL '24 hours'
        `);

        // Get hourly trade volume
        const hourlyVolume = await database.query(`
            SELECT 
                DATE_TRUNC('hour', execution_time) as hour,
                COUNT(*) as trade_count,
                SUM(actual_profit) as total_profit
            FROM executed_trades
            WHERE execution_time > NOW() - INTERVAL '24 hours'
            GROUP BY hour
            ORDER BY hour
        `);

        // Get DEX performance
        const dexPerformance = await database.query(`
            SELECT 
                o.dex_buy,
                o.dex_sell,
                COUNT(*) as trade_count,
                AVG(t.actual_profit) as avg_profit,
                SUM(t.actual_profit) as total_profit
            FROM executed_trades t
            JOIN arbitrage_opportunities o ON t.opportunity_id = o.id
            WHERE t.execution_time > NOW() - INTERVAL '24 hours'
            GROUP BY o.dex_buy, o.dex_sell
            ORDER BY total_profit DESC
        `);

        res.json({
            performance: performanceMetrics.rows[0],
            hourlyVolume: hourlyVolume.rows,
            dexPerformance: dexPerformance.rows
        });
    } catch (error) {
        logger.error('Failed to fetch metrics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get profit/loss report
router.get('/pnl', async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        
        let interval;
        switch (period) {
            case '1d': interval = '1 day'; break;
            case '7d': interval = '7 days'; break;
            case '30d': interval = '30 days'; break;
            default: interval = '7 days';
        }

        const pnlData = await database.query(`
            SELECT 
                DATE(execution_time) as date,
                SUM(CASE WHEN actual_profit > 0 THEN actual_profit ELSE 0 END) as profits,
                SUM(CASE WHEN actual_profit < 0 THEN ABS(actual_profit) ELSE 0 END) as losses,
                SUM(actual_profit) as net_pnl,
                COUNT(*) as trade_count
            FROM executed_trades
            WHERE execution_time > NOW() - INTERVAL $1
            GROUP BY DATE(execution_time)
            ORDER BY date
        `, [interval]);

        const summary = await database.query(`
            SELECT 
                SUM(CASE WHEN actual_profit > 0 THEN actual_profit ELSE 0 END) as total_profits,
                SUM(CASE WHEN actual_profit < 0 THEN ABS(actual_profit) ELSE 0 END) as total_losses,
                SUM(actual_profit) as net_pnl,
                COUNT(CASE WHEN actual_profit > 0 THEN 1 END) as winning_trades,
                COUNT(CASE WHEN actual_profit < 0 THEN 1 END) as losing_trades,
                COUNT(*) as total_trades
            FROM executed_trades
            WHERE execution_time > NOW() - INTERVAL $1
        `, [interval]);

        res.json({
            period,
            summary: summary.rows[0],
            daily: pnlData.rows
        });
    } catch (error) {
        logger.error('Failed to fetch P&L data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 