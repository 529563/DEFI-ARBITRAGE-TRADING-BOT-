const WebSocket = require('ws');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class WebSocketManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map();
        this.reconnectIntervals = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
    }

    async initialize() {
        // Initialize connections to DEX WebSocket APIs
        await this.connectToDEXs();
        logger.info('WebSocket Manager initialized');
    }

    async connectToDEXs() {
        // Connect to Uniswap subgraph WebSocket (if available)
        // For most DEXs, we'll use HTTP polling as WebSocket support is limited
        
        // Example connection to a WebSocket price feed
        try {
            await this.connect('prices', 'wss://api.example.com/prices');
        } catch (error) {
            logger.warn('Failed to connect to price WebSocket:', error);
        }
    }

    async connect(name, url, options = {}) {
        try {
            logger.info(`Connecting to WebSocket: ${name} (${url})`);
            
            const ws = new WebSocket(url, options);
            this.connections.set(name, ws);

            ws.on('open', () => {
                logger.info(`WebSocket ${name} connected`);
                this.clearReconnectInterval(name);
                this.emit('connected', name);
            });

            ws.on('message', (data) => {
                try {
                    const parsedData = JSON.parse(data);
                    this.emit('message', name, parsedData);
                } catch (error) {
                    logger.error(`Failed to parse WebSocket message from ${name}:`, error);
                }
            });

            ws.on('close', (code, reason) => {
                logger.warn(`WebSocket ${name} closed: ${code} ${reason}`);
                this.scheduleReconnect(name, url, options);
                this.emit('disconnected', name);
            });

            ws.on('error', (error) => {
                logger.error(`WebSocket ${name} error:`, error);
                this.emit('error', name, error);
            });

        } catch (error) {
            logger.error(`Failed to connect to WebSocket ${name}:`, error);
            this.scheduleReconnect(name, url, options);
        }
    }

    scheduleReconnect(name, url, options) {
        if (this.reconnectIntervals.has(name)) {
            return; // Already scheduled
        }

        let attempts = 0;
        const intervalId = setInterval(async () => {
            attempts++;
            
            if (attempts > this.maxReconnectAttempts) {
                logger.error(`Max reconnection attempts reached for WebSocket ${name}`);
                this.clearReconnectInterval(name);
                return;
            }

            logger.info(`Reconnection attempt ${attempts} for WebSocket ${name}`);
            await this.connect(name, url, options);
            
        }, this.reconnectDelay);

        this.reconnectIntervals.set(name, intervalId);
    }

    clearReconnectInterval(name) {
        const intervalId = this.reconnectIntervals.get(name);
        if (intervalId) {
            clearInterval(intervalId);
            this.reconnectIntervals.delete(name);
        }
    }

    send(name, data) {
        const ws = this.connections.get(name);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    disconnect(name) {
        const ws = this.connections.get(name);
        if (ws) {
            ws.close();
            this.connections.delete(name);
        }
        this.clearReconnectInterval(name);
    }

    disconnectAll() {
        for (const name of this.connections.keys()) {
            this.disconnect(name);
        }
    }

    getConnectionStatus() {
        const status = {};
        for (const [name, ws] of this.connections.entries()) {
            status[name] = {
                connected: ws.readyState === WebSocket.OPEN,
                readyState: ws.readyState
            };
        }
        return status;
    }
}

module.exports = WebSocketManager; 