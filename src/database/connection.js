const { Pool } = require('pg');
const config = require('../config/config');
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.pool = new Pool(config.database);
        this.initialized = false;
    }

    async initialize() {
        try {
            // Test connection
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            
            // Run migrations
            await this.runMigrations();
            
            this.initialized = true;
            logger.info('Database connection established');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    async runMigrations() {
        const migrations = [
            `CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
                id SERIAL PRIMARY KEY,
                token_pair VARCHAR(100) NOT NULL,
                dex_buy VARCHAR(50) NOT NULL,
                dex_sell VARCHAR(50) NOT NULL,
                buy_price DECIMAL(20,8) NOT NULL,
                sell_price DECIMAL(20,8) NOT NULL,
                amount DECIMAL(20,8) NOT NULL,
                potential_profit DECIMAL(20,8) NOT NULL,
                gas_estimate BIGINT NOT NULL,
                platform_fees DECIMAL(20,8) NOT NULL,
                slippage_impact DECIMAL(20,8) NOT NULL,
                net_profit DECIMAL(20,8) NOT NULL,
                profit_margin DECIMAL(8,4) NOT NULL,
                status VARCHAR(20) DEFAULT 'detected',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )`,
            
            `CREATE TABLE IF NOT EXISTS executed_trades (
                id SERIAL PRIMARY KEY,
                opportunity_id INTEGER REFERENCES arbitrage_opportunities(id),
                transaction_hash VARCHAR(66) UNIQUE,
                block_number BIGINT,
                gas_used BIGINT,
                gas_price BIGINT,
                actual_profit DECIMAL(20,8),
                execution_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )`,
            
            `CREATE TABLE IF NOT EXISTS system_metrics (
                id SERIAL PRIMARY KEY,
                metric_name VARCHAR(100) NOT NULL,
                metric_value DECIMAL(20,8) NOT NULL,
                timestamp TIMESTAMP DEFAULT NOW()
            )`,
            
            `CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON arbitrage_opportunities(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_status ON executed_trades(status)`,
            `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp)`
        ];

        for (const migration of migrations) {
            await this.pool.query(migration);
        }

        logger.info('Database migrations completed');
    }

    async query(text, params) {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        const start = Date.now();
        try {
            const res = await this.pool.query(text, params);
            const duration = Date.now() - start;
            logger.debug('Executed query', { text, duration, rows: res.rowCount });
            return res;
        } catch (error) {
            logger.error('Query error:', { text, error: error.message });
            throw error;
        }
    }

    async close() {
        await this.pool.end();
        logger.info('Database connection closed');
    }
}

module.exports = new Database(); 