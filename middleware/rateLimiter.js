// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 3, 
    message: {
        success: false,
        message: 'Demasiados intentos fallidos. Por favor, espera 10 segundos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return `${req.ip}-${req.body?.tenant_id || 'unknown'}`;
    }
});

module.exports = { loginLimiter };