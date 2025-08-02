const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Get system status
router.get('/status', (req, res) => {
    // This would be injected by the main app
    const arbitrageEngine = req.app.get('arbitrageEngine');
    const riskManager = req.app.get('riskManager');
    
    if (!arbitrageEngine || !riskManager) {
        return res.status(503).json({ error: 'Services not available' });
    }

    const status = {
        system: {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
        },
        arbitrageEngine: arbitrageEngine.getMetrics(),
        riskManager: riskManager.getRiskMetrics(),
        timestamp: new Date().toISOString()
    };

    res.json(status);
});

// Pause trading
router.post('/pause', (req, res) => {
    try {
        const riskManager = req.app.get('riskManager');
        if (!riskManager) {
            return res.status(503).json({ error: 'Risk manager not available' });
        }

        riskManager.pauseTrading();
        logger.info('Trading paused via API');
        
        res.json({ message: 'Trading paused successfully' });
    } catch (error) {
        logger.error('Failed to pause trading:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Resume trading
router.post('/resume', (req, res) => {
    try {
        const riskManager = req.app.get('riskManager');
        if (!riskManager) {
            return res.status(503).json({ error: 'Risk manager not available' });
        }

        riskManager.resumeTrading();
        logger.info('Trading resumed via API');
        
        res.json({ message: 'Trading resumed successfully' });
    } catch (error) {
        logger.error('Failed to resume trading:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 