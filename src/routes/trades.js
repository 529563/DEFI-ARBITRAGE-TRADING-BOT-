const express = require('express');
const router = express.Router();
const database = require('../database/connection');
const logger = require('../utils/logger');

// Get executed trades
router.get('/', async (req, res) => {
    try {
        const { limit = 50, status } = req.query;
        
        let query = `
            SELECT 
                t.*,
                o.token_pair,
                o.dex_buy,
                o.dex_sell,
                o.buy_price,
                o.sell_price,
                o.amount
            FROM executed_trades t
            LEFT JOIN arbitrage_opportunities o ON t.opportunity_id = o.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (status) {
            query += ` AND t.status = $${++paramCount}`;
            params.push(status);
        }

        query += ` ORDER BY t.execution_time DESC LIMIT $${++paramCount}`;
        params.push(parseInt(limit));

        const result = await database.query(query, params);
        
        res.json({
            trades: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        logger.error('Failed to fetch trades:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get trade by transaction hash
router.get('/:hash', async (req, res) => {
    try {
        const { hash } = req.params;
        
        const result = await database.query(`
            SELECT 
                t.*,
                o.token_pair,
                o.dex_buy,
                o.dex_sell,
                o.buy_price,
                o.sell_price,
                o.amount,
                o.potential_profit,
                o.gas_estimate,
                o.platform_fees
            FROM executed_trades t
            LEFT JOIN arbitrage_opportunities o ON t.opportunity_id = o.id
            WHERE t.transaction_hash = $1
        `, [hash]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Trade not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Failed to fetch trade:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 