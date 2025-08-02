require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const database = require('./database/connection');
const ArbitrageEngine = require('./services/ArbitrageEngine');
const WebSocketManager = require('./services/WebSocketManager');
const routes = require('./routes');

class ArbitrageBotApp {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.arbitrageEngine = null;
        this.wsManager = null;
    }

    async initialize() {
        try {
            // Setup middleware
            this.setupMiddleware();
            
            // Setup routes
            this.setupRoutes();
            
            // Initialize database
            await database.initialize();
            logger.info('Database initialized');
            
            // Initialize services
            await this.initializeServices();
            
            // Start server
            this.startServer();
            
        } catch (error) {
            logger.error('Failed to initialize application:', error);
            process.exit(1);
        }
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(compression());
        
        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100 // limit each IP to 100 requests per windowMs
        });
        this.app.use('/api/', limiter);
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
    }

    setupRoutes() {
        this.app.use('/api', routes);
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });
    }

    async initializeServices() {
        // Initialize WebSocket manager
        this.wsManager = new WebSocketManager();
        await this.wsManager.initialize();
        
        // Initialize arbitrage engine
        this.arbitrageEngine = new ArbitrageEngine();
        await this.arbitrageEngine.initialize();
        
        // Start monitoring
        await this.arbitrageEngine.startMonitoring();
        
        logger.info('All services initialized successfully');
    }

    startServer() {
        this.app.listen(this.port, () => {
            logger.info(`Arbitrage Bot API server running on port ${this.port}`);
        });
    }
}

// Start the application
const app = new ArbitrageBotApp();
app.initialize(); 