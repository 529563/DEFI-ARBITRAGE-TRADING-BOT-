const { ethers } = require('ethers');

class Helpers {
    // Format numbers for display
    static formatNumber(num, decimals = 2) {
        if (num === null || num === undefined) return '0';
        return Number(num).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    // Format currency
    static formatCurrency(amount, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    // Format percentage
    static formatPercentage(value, decimals = 2) {
        return `${(value * 100).toFixed(decimals)}%`;
    }

    // Convert Wei to Ether
    static weiToEther(wei) {
        return ethers.formatEther(wei);
    }

    // Convert Ether to Wei
    static etherToWei(ether) {
        return ethers.parseEther(ether.toString());
    }

    // Format Ethereum address
    static formatAddress(address, length = 6) {
        if (!address) return '';
        return `${address.slice(0, length)}...${address.slice(-4)}`;
    }

    // Validate Ethereum address
    static isValidAddress(address) {
        return ethers.isAddress(address);
    }

    // Generate random ID
    static generateId(prefix = '') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 5);
        return `${prefix}${timestamp}_${random}`.toUpperCase();
    }

    // Sleep function
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Retry function with exponential backoff
    static async retry(fn, maxRetries = 3, baseDelay = 1000) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                if (i === maxRetries - 1) {
                    throw lastError;
                }
                
                const delay = baseDelay * Math.pow(2, i);
                await this.sleep(delay);
            }
        }
    }

    // Calculate percentage change
    static calculatePercentageChange(oldValue, newValue) {
        if (oldValue === 0) return newValue > 0 ? 100 : 0;
        return ((newValue - oldValue) / oldValue) * 100;
    }

    // Deep clone object
    static deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // Sanitize string for logging
    static sanitizeForLog(str, maxLength = 100) {
        if (!str) return '';
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }

    // Convert timestamp to human readable format
    static formatTimestamp(timestamp, includeTime = true) {
        const date = new Date(timestamp);
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            ...(includeTime && {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        };
        return date.toLocaleDateString('en-US', options);
    }

    // Calculate moving average
    static calculateMovingAverage(values, periods) {
        if (values.length < periods) return 0;
        
        const sum = values.slice(-periods).reduce((a, b) => a + b, 0);
        return sum / periods;
    }

    // Round to specified decimal places
    static roundTo(num, decimals) {
        return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
    }

    // Check if value is within range
    static isInRange(value, min, max) {
        return value >= min && value <= max;
    }

    // Convert seconds to human readable duration
    static formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    // Validate and parse JSON
    static safeJsonParse(str, defaultValue = null) {
        try {
            return JSON.parse(str);
        } catch (error) {
            return defaultValue;
        }
    }

    // Check if running in production
    static isProduction() {
        return process.env.NODE_ENV === 'production';
    }

    // Get environment variable with default
    static getEnvVar(name, defaultValue = null) {
        return process.env[name] || defaultValue;
    }
}

module.exports = Helpers; 