const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const BCRYPT_SALT_ROUNDS = 10;

// The name of the database file — resolved relative to this file's directory.
const DB_SOURCE = path.join(__dirname, "smartpwd.db");

/**
 * Establishes a connection to the SQLite database.
 * The database is created if it doesn't exist.
 */
const db = new sqlite3.Database(DB_SOURCE, (err) => {
    if (err) {
        // Cannot open database
        console.error('Error opening database:', err.message);
        throw err;
    } else {
        console.log('Connected to the SQLite database.');
        initializeDb();
    }
});

/**
 * Creates the 'accounts' table if it doesn't exist and then seeds it.
 */
function initializeDb() {
    db.serialize(() => {
        // Create accounts table
        createAccountsTable();
        // Create applications table
        createApplicationsTable();
        // Create transactions table
        createTransactionsTable();
        // Create API keys table for public API
        createApiKeysTable();
        // Create API usage table for rate limiting
        createApiUsageTable();
    });
}

/**
 * Creates the 'accounts' table and seeds it.
 */
function createAccountsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        firstName TEXT NOT NULL,
        lastName TEXT NOT NULL,
        mobile TEXT,
        accountType TEXT NOT NULL,
        createdAt TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error("Error creating table:", err.message);
        } else {
            // Seed the database with demo accounts only if the table was just created
            seedDatabase();
        }
    });
}

/**
 * Creates the 'applications' table for PWD ID applications.
 */
function createApplicationsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        userEmail TEXT UNIQUE NOT NULL,
        userName TEXT NOT NULL,
        birthdate TEXT,
        contact TEXT,
        address TEXT,
        submittedAt TEXT NOT NULL,
        status TEXT NOT NULL, -- 'Pending', 'Approved', 'Rejected'
        FOREIGN KEY (userEmail) REFERENCES accounts (email)
    )`);
}

/**
 * Creates the 'transactions' table to log verification events.
 */
function createTransactionsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        pwdId TEXT NOT NULL,
        method TEXT NOT NULL,
        status TEXT NOT NULL,
        establishmentName TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (pwdId) REFERENCES accounts (id)
    )`);
}

/**
 * Creates the 'api_keys' table for public API access management.
 */
function createApiKeysTable() {
    db.run(`CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        ownerEmail TEXT NOT NULL,
        ownerName TEXT NOT NULL,
        organization TEXT,
        description TEXT,
        permissions TEXT DEFAULT 'read',
        rateLimit INTEGER DEFAULT 100,
        isActive INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        expiresAt TEXT,
        FOREIGN KEY (ownerEmail) REFERENCES accounts (email)
    )`, (err) => {
        if (err) {
            console.error("Error creating api_keys table:", err.message);
        } else {
            seedApiKeys();
        }
    });
}

/**
 * Creates the 'api_usage' table to track API calls for rate limiting.
 */
function createApiUsageTable() {
    db.run(`CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apiKeyId TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (apiKeyId) REFERENCES api_keys (id)
    )`);
}

/**
 * Seeds the database with demo API keys.
 */
function seedApiKeys() {
    const seedKeys = [
        { 
            id: 'key-1', 
            key: 'spwd_public_demo_key_2024', 
            ownerEmail: 'admin@smartpwd.ph', 
            ownerName: 'System Admin', 
            organization: 'Smart PWD Demo', 
            description: 'Demo API key for testing', 
            permissions: 'read', 
            rateLimit: 1000,
            isActive: 1,
            createdAt: new Date().toISOString(),
            expiresAt: '2025-12-31T23:59:59.000Z'
        },
        { 
            id: 'key-2', 
            key: 'spwd_establishment_key_2024', 
            ownerEmail: 'verifier@smartpwd.ph', 
            ownerName: 'Sample Verifier', 
            organization: 'Sample Pharmacy', 
            description: 'Establishment verification key', 
            permissions: 'verify', 
            rateLimit: 500,
            isActive: 1,
            createdAt: new Date().toISOString(),
            expiresAt: '2025-12-31T23:59:59.000Z'
        }
    ];

    const stmt = db.prepare(`INSERT OR IGNORE INTO api_keys (id, key, ownerEmail, ownerName, organization, description, permissions, rateLimit, isActive, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    seedKeys.forEach(key => {
        stmt.run(key.id, key.key, key.ownerEmail, key.ownerName, key.organization, key.description, key.permissions, key.rateLimit, key.isActive, key.createdAt, key.expiresAt);
    });

    stmt.finalize(() => console.log('API keys seeding complete.'));
}

/**
 * Inserts the initial demo accounts into the database with hashed passwords.
 * 'INSERT OR IGNORE' prevents errors if the server is restarted and accounts already exist.
 */
function seedDatabase() {
    const seedAccounts = [
        { id: 'pwd-1', email: "ken@gmail.com", password: "Ken123456", firstName: "Ken Mijay", lastName: "Espiritu", mobile: "09171234567", accountType: "pwd" },
        { id: 'est-1', email: "verifier@smartpwd.ph", password: "Verify123", firstName: "Sample", lastName: "Verifier", mobile: "09181234567", accountType: "establishment" },
        { id: 'admin-1', email: "admin@smartpwd.ph", password: "Admin123", firstName: "System", lastName: "Admin", mobile: "09191234567", accountType: "admin" }
    ];

    const stmt = db.prepare(`INSERT OR IGNORE INTO accounts (id, email, password, firstName, lastName, mobile, accountType, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    seedAccounts.forEach(acc => {
        const hash = bcrypt.hashSync(acc.password, BCRYPT_SALT_ROUNDS);
        stmt.run(acc.id, acc.email.toLowerCase(), hash, acc.firstName, acc.lastName, acc.mobile, acc.accountType, new Date().toISOString());
    });

    stmt.finalize(() => console.log('Database seeding complete (if it was needed).'));
}

module.exports = db;