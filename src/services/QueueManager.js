const Queue = require('bull');
const logger = require('../utils/logger');
const config = require('../config/config');

class QueueManager {
    constructor() {
        this.queues = {};
        this.redisConfig = {
            redis: config.redis
        };
        
        this.initializeQueues();
    }

    initializeQueues() {
        // Arbitrage execution queue
        this.queues.arbitrage = new Queue('arbitrage execution', this.redisConfig);
        
        // Price monitoring queue
        this.queues.priceMonitoring = new Queue('price monitoring', this.redisConfig);
        
        // Notification queue
        this.queues.notifications = new Queue('notifications', this.redisConfig);
        
        // Analytics queue
        this.queues.analytics = new Queue('analytics', this.redisConfig);
        
        this.setupProcessors();
        this.setupEventListeners();
    }

    setupProcessors() {
        // Arbitrage execution processor
        this.queues.arbitrage.process('execute', 5, async (job) => {
            const { opportunity } = job.data;
            logger.info(`Processing arbitrage job: ${job.id}`);
            
            try {
                // This would integrate with your ArbitrageEngine
                const ArbitrageEngine = require('./ArbitrageEngine');
                const engine = new ArbitrageEngine();
                await engine.executeArbitrage(opportunity);
                
                return { success: true, opportunity: opportunity.id };
            } catch (error) {
                logger.error(`Arbitrage job ${job.id} failed:`, error);
                throw error;
            }
        });

        // Price monitoring processor
        this.queues.priceMonitoring.process('fetchPrices', 10, async (job) => {
            const { tokenPairs } = job.data;
            
            try {
                const DEXPriceFetcher = require('./DEXPriceFetcher');
                const fetcher = new DEXPriceFetcher();
                const prices = await fetcher.fetchAllPrices(tokenPairs);
                
                return { success: true, prices };
            } catch (error) {
                logger.error(`Price monitoring job ${job.id} failed:`, error);
                throw error;
            }
        });

        // Notifications processor
        this.queues.notifications.process('sendAlert', async (job) => {
            const { type, message, recipients } = job.data;
            
            try {
                // Implement notification logic (email, Slack, Discord, etc.)
                await this.sendNotification(type, message, recipients);
                return { success: true };
            } catch (error) {
                logger.error(`Notification job ${job.id} failed:`, error);
                throw error;
            }
        });
    }

    setupEventListeners() {
        Object.entries(this.queues).forEach(([name, queue]) => {
            queue.on('active', (job) => {
                logger.debug(`Job ${job.id} in queue ${name} started`);
            });

            queue.on('completed', (job, result) => {
                logger.debug(`Job ${job.id} in queue ${name} completed`);
            });

            queue.on('failed', (job, err) => {
                logger.error(`Job ${job.id} in queue ${name} failed:`, err);
            });

            queue.on('stalled', (job) => {
                logger.warn(`Job ${job.id} in queue ${name} stalled`);
            });
        });
    }

    // Add jobs to queues
    async addArbitrageJob(opportunity, options = {}) {
        return await this.queues.arbitrage.add('execute', { opportunity }, {
            priority: 10,
            attempts: 3,
            backoff: 'exponential',
            delay: 0,
            ...options
        });
    }

    async addPriceMonitoringJob(tokenPairs, options = {}) {
        return await this.queues.priceMonitoring.add('fetchPrices', { tokenPairs }, {
            repeat: { every: 5000 }, // Every 5 seconds
            attempts: 2,
            ...options
        });
    }

    async addNotificationJob(type, message, recipients, options = {}) {
        return await this.queues.notifications.add('sendAlert', { type, message, recipients }, {
            attempts: 3,
            backoff: 'fixed',
            ...options
        });
    }

    async sendNotification(type, message, recipients) {
        // Implement different notification channels
        switch (type) {
            case 'slack':
                await this.sendSlackNotification(message, recipients);
                break;
            case 'email':
                await this.sendEmailNotification(message, recipients);
                break;
            case 'discord':
                await this.sendDiscordNotification(message, recipients);
                break;
            default:
                logger.warn(`Unknown notification type: ${type}`);
        }
    }

    async sendSlackNotification(message, webhookUrl) {
        const axios = require('axios');
        
        try {
            await axios.post(webhookUrl, {
                text: message,
                username: 'Arbitrage Bot',
                icon_emoji: ':robot_face:'
            });
        } catch (error) {
            logger.error('Failed to send Slack notification:', error);
            throw error;
        }
    }

    async sendEmailNotification(message, recipients) {
        // Implement email sending logic (using SendGrid, SES, etc.)
        logger.info(`Email notification sent to ${recipients.length} recipients`);
    }

    async sendDiscordNotification(message, webhookUrl) {
        const axios = require('axios');
        
        try {
            await axios.post(webhookUrl, {
                content: message,
                username: 'Arbitrage Bot'
            });
        } catch (error) {
            logger.error('Failed to send Discord notification:', error);
            throw error;
        }
    }

    // Queue management methods
    getQueueStats(queueName) {
        const queue = this.queues[queueName];
        if (!queue) return null;

        return queue.getJobs(['active', 'waiting', 'completed', 'failed']);
    }

    async pauseQueue(queueName) {
        const queue = this.queues[queueName];
        if (queue) {
            await queue.pause();
            logger.info(`Queue ${queueName} paused`);
        }
    }

    async resumeQueue(queueName) {
        const queue = this.queues[queueName];
        if (queue) {
            await queue.resume();
            logger.info(`Queue ${queueName} resumed`);
        }
    }

    async cleanQueue(queueName, grace = 5000) {
        const queue = this.queues[queueName];
        if (queue) {
            await queue.clean(grace, 'completed');
            await queue.clean(grace, 'failed');
            logger.info(`Queue ${queueName} cleaned`);
        }
    }

    async closeAll() {
        for (const [name, queue] of Object.entries(this.queues)) {
            await queue.close();
            logger.info(`Queue ${name} closed`);
        }
    }
}

module.exports = QueueManager; 