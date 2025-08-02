const express = require('express');
const router = express.Router();
const database = require('../database/connection');
const logger = require('../utils/logger');

// Get recent arbitrage opportunities
router.get('/', async (req, res) => {
    try {
        const { limit = 50, status, tokenPair } = req.query;
        
        let query = `
            SELECT * FROM arbitrage_opportunities 
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (status) {
            query += ` AND status = $${++paramCount}`;
            params.push(status);
        }

        if (tokenPair) {
            query += ` AND token_pair = $${++paramCount}`;
            params.push(tokenPair);
        }

        query += ` ORDER BY created_at DESC LIMIT $${++paramCount}`;
        params.push(parseInt(limit));

        const result = await database.query(query, params);
        
        res.json({
            opportunities: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        logger.error('Failed to fetch opportunities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get opportunity statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await database.query(`
            SELECT 
                COUNT(*) as total_opportunities,
                COUNT(CASE WHEN status = 'executed' THEN 1 END) as executed_count,
                COUNT(CASE WHEN net_profit > 0 THEN 1 END) as profitable_count,
                AVG(net_profit) as avg_profit,
                SUM(net_profit) as total_potential_profit
            FROM arbitrage_opportunities
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);

        const tokenPairStats = await database.query(`
            SELECT 
                token_pair,
                COUNT(*) as opportunity_count,
                AVG(net_profit) as avg_profit,
                MAX(net_profit) as max_profit
            FROM arbitrage_opportunities
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY token_pair
            ORDER BY opportunity_count DESC
            LIMIT 10
        `);

        res.json({
            summary: stats.rows[0],
            byTokenPair: tokenPairStats.rows
        });
    } catch (error) {
        logger.error('Failed to fetch opportunity stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 