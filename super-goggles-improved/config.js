'use strict';

const path = require('path');

module.exports = {
    BOT_NAME: process.env.BOT_NAME || 'Supreme MD Bot',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '94742514900',
    PREFIX: process.env.PREFIX || '.',
    PORT: parseInt(process.env.PORT) || 5000,
    DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || process.env.PORT) || 5000,

    // Dashboard credentials — override via env vars in production
    ADMIN_USER: process.env.ADMIN_USER || 'admin',
    ADMIN_PASS: process.env.ADMIN_PASS || 'changeme123',
    JWT_SECRET: process.env.JWT_SECRET || 'change_this_secret_in_production',

    // Paths
    SESSION_DIR: path.join(__dirname, 'session'),
    DOWNLOAD_DIR: path.join(__dirname, 'downloads'),

    // Baileys browser fingerprint
    BROWSER: ['SupremeBot', 'Chrome', '131.0'],

    // Feature flags
    AUTO_READ: process.env.AUTO_READ !== 'false',
    AUTO_TYPING: process.env.AUTO_TYPING !== 'false',
    NSFW_ENABLED: process.env.NSFW_ENABLED !== 'false',

    // Cache TTLs (ms)
    SEARCH_CACHE_TTL: 300000,   // 5 minutes
    DOWNLOAD_CACHE_TTL: 1800000, // 30 minutes
    MSG_CACHE_TTL: 3600000,      // 1 hour
};
