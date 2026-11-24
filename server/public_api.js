const express = require('express');
const router = express.Router();
const db = require('./database.js');

/**
 * Smart PWD ID Public API
 * Endpoints for third-party integrations
 */

// ============================================================
// MIDDLEWARE: API Key Authentication
// ============================================================

/**
 * Middleware to authenticate API requests using API keys.
 * Checks for 'X-API-Key' header and validates against database.
 */
function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Please provide a valid API key in the X-API-Key header',
            documentation: '/api-docs'
        });
    }

    const sql = `SELECT * FROM api_keys WHERE key = ? AND isActive = 1`;
    
    db.get(sql, [apiKey], (err, keyData) => {
        if (err) {
            console.error('API key validation error:', err.message);
            return res.status(500).json({ error: 'Server error during API key validation' });
        }

        if (!keyData) {
            return res.status(403).json({ 
                error: 'Invalid API key',
                message: 'The provided API key is invalid or inactive'
            });
        }

        // Check if key has expired
        if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
            return res.status(403).json({ 
                error: 'API key expired',
                message: 'The provided API key has expired. Please request a new one.'
            });
        }

        // Check rate limit
        checkRateLimit(keyData.id, keyData.rateLimit, (err, allowed) => {
            if (err) {
                console.error('Rate limit check error:', err.message);
                return res.status(500).json({ error: 'Server error during rate limit check' });
            }

            if (!allowed) {
                return res.status(429).json({ 
                    error: 'Rate limit exceeded',
                    message: `You have exceeded the rate limit of ${keyData.rateLimit} requests per hour`,
                    retryAfter: '1 hour'
                });
            }

            // Attach key data to request for logging
            req.apiKey = keyData;
            next();
        });
    });
}

/**
 * Check if an API key has exceeded its rate limit.
 * @param {string} keyId - The API key ID
 * @param {number} limit - The rate limit (requests per hour)
 * @param {function} callback - Callback function (err, allowed)
 */
function checkRateLimit(keyId, limit, callback) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const sql = `SELECT COUNT(*) as count FROM api_usage WHERE apiKeyId = ? AND timestamp > ?`;
    
    db.get(sql, [keyId, oneHourAgo], (err, result) => {
        if (err) {
            return callback(err, false);
        }
        
        const allowed = result.count < limit;
        callback(null, allowed);
    });
}

/**
 * Log an API usage event.
 * @param {string} keyId - The API key ID
 * @param {string} endpoint - The endpoint called
 */
function logApiUsage(keyId, endpoint) {
    const sql = `INSERT INTO api_usage (apiKeyId, endpoint, timestamp) VALUES (?, ?, ?)`;
    db.run(sql, [keyId, endpoint, new Date().toISOString()]);
}

// ============================================================
// PUBLIC API ENDPOINTS
// ============================================================

/**
 * [GET] /api/public/verify/:pwdId
 * Verify a PWD ID (QR/NFC verification)
 * Public endpoint - requires API key
 */
router.get('/verify/:pwdId', authenticateApiKey, (req, res) => {
    const { pwdId } = req.params;
    const { method } = req.query;

    if (!pwdId) {
        return res.status(400).json({ error: 'PWD ID is required' });
    }

    const sql = `SELECT id, firstName, lastName, accountType FROM accounts WHERE id = ? AND accountType = 'pwd'`;
    
    db.get(sql, [pwdId], (err, account) => {
        if (err) {
            console.error('Public verification error:', err.message);
            return res.status(500).json({ error: 'Server error during verification' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, `/api/public/verify/${pwdId}`);

        if (account) {
            // Log successful verification
            logTransaction(pwdId, method || 'API', 'Verified');
            
            res.status(200).json({
                status: 'verified',
                message: 'PWD ID is valid',
                data: {
                    id: account.id,
                    firstName: account.firstName,
                    lastName: account.lastName,
                    validUntil: 'Aug 12, 2031' // In production, this would come from database
                },
                verifiedAt: new Date().toISOString(),
                verificationMethod: method || 'API'
            });
        } else {
            // Log failed verification
            logTransaction(pwdId, method || 'API', 'Failed');
            
            res.status(404).json({ 
                status: 'not_found',
                message: 'PWD ID not found or invalid',
                verifiedAt: new Date().toISOString()
            });
        }
    });
});

/**
 * [POST] /api/public/verify
 * Verify multiple PWD IDs at once (batch verification)
 * Public endpoint - requires API key
 */
router.post('/verify', authenticateApiKey, (req, res) => {
    const { pwdIds, method } = req.body;

    if (!pwdIds || !Array.isArray(pwdIds) || pwdIds.length === 0) {
        return res.status(400).json({ error: 'Array of PWD IDs is required' });
    }

    if (pwdIds.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 PWD IDs per batch request' });
    }

    const placeholders = pwdIds.map(() => '?').join(',');
    const sql = `SELECT id, firstName, lastName FROM accounts WHERE id IN (${placeholders}) AND accountType = 'pwd'`;
    
    db.all(sql, pwdIds, (err, accounts) => {
        if (err) {
            console.error('Batch verification error:', err.message);
            return res.status(500).json({ error: 'Server error during batch verification' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, '/api/public/verify (batch)');

        // Create a map of found accounts
        const accountMap = {};
        accounts.forEach(acc => { accountMap[acc.id] = acc; });

        // Build results
        const results = pwdIds.map(pwdId => {
            const found = accountMap[pwdId];
            if (found) {
                logTransaction(pwdId, method || 'API', 'Verified');
                return {
                    id: pwdId,
                    status: 'verified',
                    firstName: found.firstName,
                    lastName: found.lastName
                };
            } else {
                logTransaction(pwdId, method || 'API', 'Failed');
                return {
                    id: pwdId,
                    status: 'not_found'
                };
            }
        });

        res.status(200).json({
            status: 'success',
            total: pwdIds.length,
            verified: results.filter(r => r.status === 'verified').length,
            notFound: results.filter(r => r.status === 'not_found').length,
            results: results
        });
    });
});

/**
 * [GET] /api/public/status/:pwdId
 * Check PWD ID status (active, expired, suspended, flagged)
 * Public endpoint - requires API key
 */
router.get('/status/:pwdId', authenticateApiKey, (req, res) => {
    const { pwdId } = req.params;

    if (!pwdId) {
        return res.status(400).json({ error: 'PWD ID is required' });
    }

    const sql = `SELECT id, firstName, lastName, accountType, createdAt FROM accounts WHERE id = ?`;
    
    db.get(sql, [pwdId], (err, account) => {
        if (err) {
            console.error('Status check error:', err.message);
            return res.status(500).json({ error: 'Server error during status check' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, `/api/public/status/${pwdId}`);

        if (account) {
            // In production, you'd have status, expiration, flags in the database
            const status = account.accountType === 'pwd' ? 'active' : 'inactive';
            
            res.status(200).json({
                status: 'success',
                data: {
                    id: account.id,
                    status: status,
                    firstName: account.firstName,
                    lastName: account.lastName,
                    registeredAt: account.createdAt,
                    validUntil: 'Aug 12, 2031',
                    flags: [] // In production: ['expired'], ['suspended'], etc.
                },
                checkedAt: new Date().toISOString()
            });
        } else {
            res.status(404).json({ 
                status: 'not_found',
                message: 'PWD ID not found'
            });
        }
    });
});

/**
 * [GET] /api/public/establishments
 * List all establishments that accept Smart PWD ID
 * Public endpoint - requires API key
 */
router.get('/establishments', authenticateApiKey, (req, res) => {
    const sql = `SELECT id, firstName, lastName, email FROM accounts WHERE accountType = 'establishment'`;
    
    db.all(sql, [], (err, establishments) => {
        if (err) {
            console.error('Establishments list error:', err.message);
            return res.status(500).json({ error: 'Server error fetching establishments' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, '/api/public/establishments');

        res.status(200).json({
            status: 'success',
            total: establishments.length,
            data: establishments.map(est => ({
                id: est.id,
                name: `${est.firstName} ${est.lastName}`,
                email: est.email
            }))
        });
    });
});

/**
 * [GET] /api/public/stats
 * Get public statistics (total PWDs, verifications, etc.)
 * Public endpoint - requires API key
 */
router.get('/stats', authenticateApiKey, (req, res) => {
    const statsQuery = `
        SELECT 
            (SELECT COUNT(*) FROM accounts WHERE accountType = 'pwd') as totalPwds,
            (SELECT COUNT(*) FROM accounts WHERE accountType = 'establishment') as totalEstablishments,
            (SELECT COUNT(*) FROM transactions) as totalVerifications,
            (SELECT COUNT(*) FROM transactions WHERE status = 'Verified') as successfulVerifications
    `;
    
    db.get(statsQuery, [], (err, stats) => {
        if (err) {
            console.error('Stats error:', err.message);
            return res.status(500).json({ error: 'Server error fetching statistics' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, '/api/public/stats');

        res.status(200).json({
            status: 'success',
            data: {
                totalPwds: stats.totalPwds || 0,
                totalEstablishments: stats.totalEstablishments || 0,
                totalVerifications: stats.totalVerifications || 0,
                successfulVerifications: stats.successfulVerifications || 0,
                successRate: stats.totalVerifications > 0 
                    ? ((stats.successfulVerifications / stats.totalVerifications) * 100).toFixed(2) + '%'
                    : '0%'
            },
            lastUpdated: new Date().toISOString()
        });
    });
});

/**
 * [GET] /api/public/transactions/recent
 * Get recent verification transactions
 * Public endpoint - requires API key
 */
router.get('/transactions/recent', authenticateApiKey, (req, res) => {
    const { limit = 10 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 10, 100);

    const sql = `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?`;
    
    db.all(sql, [limitNum], (err, transactions) => {
        if (err) {
            console.error('Recent transactions error:', err.message);
            return res.status(500).json({ error: 'Server error fetching recent transactions' });
        }

        // Log API usage
        logApiUsage(req.apiKey.id, '/api/public/transactions/recent');

        res.status(200).json({
            status: 'success',
            total: transactions.length,
            data: transactions.map(txn => ({
                id: txn.id,
                pwdId: txn.pwdId,
                method: txn.method,
                status: txn.status,
                timestamp: txn.timestamp
            }))
        });
    });
});

/**
 * [GET] /api/public/health
 * API health check endpoint (no auth required)
 */
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: 'Smart PWD ID Public API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        documentation: '/api-docs'
    });
});

/**
 * [GET] /api/public/info
 * Get API information and available endpoints
 */
router.get('/info', authenticateApiKey, (req, res) => {
    logApiUsage(req.apiKey.id, '/api/public/info');

    res.status(200).json({
        status: 'success',
        service: 'Smart PWD ID Public API',
        version: '1.0.0',
        endpoints: {
            verify: {
                single: 'GET /api/public/verify/:pwdId',
                batch: 'POST /api/public/verify'
            },
            status: 'GET /api/public/status/:pwdId',
            establishments: 'GET /api/public/establishments',
            stats: 'GET /api/public/stats',
            transactions: 'GET /api/public/transactions/recent',
            health: 'GET /api/public/health',
            info: 'GET /api/public/info'
        },
        rateLimit: `${req.apiKey.rateLimit} requests per hour`,
        documentation: '/api-docs'
    });
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Log a transaction to the database.
 * @param {string} pwdId - The PWD ID
 * @param {string} method - Verification method
 * @param {string} status - Verification status
 */
function logTransaction(pwdId, method, status) {
    const transaction = {
        id: 'TXN-' + Date.now(),
        pwdId: pwdId,
        method: method,
        status: status,
        establishmentName: 'Public API',
        timestamp: new Date().toISOString()
    };
    const sql = `INSERT INTO transactions (id, pwdId, method, status, establishmentName, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [transaction.id, transaction.pwdId, transaction.method, transaction.status, transaction.establishmentName, transaction.timestamp]);
}

module.exports = router;
