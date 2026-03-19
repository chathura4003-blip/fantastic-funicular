'use strict';

// Polyfill for Baileys/Nixpacks environments where global crypto might be missing
if (!global.crypto) {
    global.crypto = require('crypto');
}

/**
 * Entry point — starts the dashboard then the WhatsApp bot.
 * Usage: node index.js
 */

const { startBot, getSock } = require('./bot');
const { startDashboard } = require('./dashboard');
const { logger } = require('./logger');

process.on('uncaughtException',  err => logger(`[UNCAUGHT]  ${err.message}\n${err.stack}`));
process.on('unhandledRejection', err => logger(`[UNHANDLED] ${err?.message || err}`));

(async () => {
    try {
        // Start dashboard (non-blocking)
        startDashboard(getSock);

        // Start WhatsApp bot
        await startBot();
    } catch (err) {
        logger(`[Index] Fatal startup error: ${err.message}`);
        process.exit(1);
    }
})();
