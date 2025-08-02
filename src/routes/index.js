const express = require('express');
const router = express.Router();
const opportunitiesRouter = require('./opportunities');
const tradesRouter = require('./trades');
const metricsRouter = require('./metrics');
const systemRouter = require('./system');

// Mount route modules
router.use('/opportunities', opportunitiesRouter);
router.use('/trades', tradesRouter);
router.use('/metrics', metricsRouter);
router.use('/system', systemRouter);

// API info endpoint
router.get('/', (req, res) => {
    res.json({
        name: 'DeFi Arbitrage Bot API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            opportunities: '/api/opportunities',
            trades: '/api/trades',
            metrics: '/api/metrics',
            system: '/api/system'
        }
    });
});

module.exports = router; 