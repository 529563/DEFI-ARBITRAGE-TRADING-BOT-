const Joi = require('joi');

const schemas = {
    // Opportunity validation
    opportunity: Joi.object({
        tokenPair: Joi.string().pattern(/^[A-Z]+\/[A-Z]+$/).required(),
        buyDEX: Joi.string().valid('uniswap', 'sushiswap', 'pancakeswap').required(),
        sellDEX: Joi.string().valid('uniswap', 'sushiswap', 'pancakeswap').required(),
        buyPrice: Joi.number().positive().required(),
        sellPrice: Joi.number().positive().required(),
        amount: Joi.number().positive().required(),
        minProfitUSD: Joi.number().min(0).default(10)
    }),

    // Trade execution validation
    tradeExecution: Joi.object({
        opportunityId: Joi.string().required(),
        maxSlippagePercent: Joi.number().min(0).max(50).default(5),
        maxGasPrice: Joi.number().positive().optional(),
        deadline: Joi.number().integer().min(Date.now()).optional()
    }),

    // System configuration validation
    systemConfig: Joi.object({
        minProfitUSD: Joi.number().min(0).default(10),
        maxSlippagePercent: Joi.number().min(0).max(50).default(5),
        maxTransactionValue: Joi.number().positive().default(10000),
        gasBufferPercent: Joi.number().min(0).max(100).default(20),
        priceUpdateIntervalMs: Joi.number().min(1000).default(5000)
    }),

    // API query parameters
    queryParams: {
        opportunities: Joi.object({
            limit: Joi.number().integer().min(1).max(1000).default(50),
            offset: Joi.number().integer().min(0).default(0),
            status: Joi.string().valid('detected', 'validated', 'executed', 'rejected').optional(),
            tokenPair: Joi.string().pattern(/^[A-Z]+\/[A-Z]+$/).optional(),
            minProfit: Joi.number().min(0).optional(),
            startDate: Joi.date().iso().optional(),
            endDate: Joi.date().iso().optional()
        }),

        trades: Joi.object({
            limit: Joi.number().integer().min(1).max(1000).default(50),
            offset: Joi.number().integer().min(0).default(0),
            status: Joi.string().valid('pending', 'success', 'failed').optional(),
            minProfit: Joi.number().optional(),
            startDate: Joi.date().iso().optional(),
            endDate: Joi.date().iso().optional()
        })
    }
};

// Validation middleware factory
const validate = (schema, property = 'body') => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            allowUnknown: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors
            });
        }

        req[property] = value;
        next();
    };
};

// Specific validation functions
const validateOpportunity = validate(schemas.opportunity);
const validateTradeExecution = validate(schemas.tradeExecution);
const validateSystemConfig = validate(schemas.systemConfig);
const validateOpportunityQuery = validate(schemas.queryParams.opportunities, 'query');
const validateTradeQuery = validate(schemas.queryParams.trades, 'query');

module.exports = {
    schemas,
    validate,
    validateOpportunity,
    validateTradeExecution,
    validateSystemConfig,
    validateOpportunityQuery,
    validateTradeQuery
}; 