const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

class AuthMiddleware {
    // Generate JWT token for API access
    static generateToken(payload) {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    }

    // Verify JWT token
    static authenticate(req, res, next) {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            logger.warn('Invalid token attempt:', { ip: req.ip, token: token.substring(0, 20) });
            res.status(400).json({ error: 'Invalid token.' });
        }
    }

    // API key authentication (for external integrations)
    static apiKeyAuth(req, res, next) {
        const apiKey = req.header('X-API-Key');
        const validApiKeys = process.env.API_KEYS?.split(',') || [];

        if (!apiKey || !validApiKeys.includes(apiKey)) {
            logger.warn('Invalid API key attempt:', { ip: req.ip, apiKey: apiKey?.substring(0, 10) });
            return res.status(401).json({ error: 'Invalid API key.' });
        }

        next();
    }

    // Role-based authorization
    static authorize(roles = []) {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Access denied.' });
            }

            if (roles.length && !roles.includes(req.user.role)) {
                return res.status(403).json({ error: 'Insufficient permissions.' });
            }

            next();
        };
    }
}

module.exports = AuthMiddleware; 