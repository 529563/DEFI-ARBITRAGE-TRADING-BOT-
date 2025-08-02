const redis = require('redis');
const config = require('../config/config');
const logger = require('../utils/logger');

class Cache {
    constructor() {
        this.client = null;
        this.connected = false;
    }

    async initialize() {
        try {
            this.client = redis.createClient({
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password
            });

            this.client.on('error', (err) => {
                logger.error('Redis client error:', err);
                this.connected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis client connected');
                this.connected = true;
            });

            await this.client.connect();
        } catch (error) {
            logger.error('Failed to initialize Redis cache:', error);
            // Continue without cache
        }
    }

    async get(key) {
        if (!this.connected) return null;
        
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    async set(key, value, expirationSeconds = 3600) {
        if (!this.connected) return false;
        
        try {
            await this.client.setEx(key, expirationSeconds, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.error('Cache set error:', error);
            return false;
        }
    }

    async del(key) {
        if (!this.connected) return false;
        
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            logger.error('Cache delete error:', error);
            return false;
        }
    }

    async exists(key) {
        if (!this.connected) return false;
        
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            logger.error('Cache exists error:', error);
            return false;
        }
    }
}

module.exports = Cache; 