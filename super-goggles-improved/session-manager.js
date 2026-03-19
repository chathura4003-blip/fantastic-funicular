'use strict';

/**
 * Session manager — wraps Baileys auth state with file persistence.
 * Provides: initSession, clearSession, hasSession.
 */

const fs = require('fs');
const path = require('path');
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { logger } = require('./logger');
const { SESSION_DIR } = require('./config');

function hasSession() {
    return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
}

async function initSession() {
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    return { state, saveCreds };
}

function clearSession() {
    if (!fs.existsSync(SESSION_DIR)) return false;
    try {
        for (const file of fs.readdirSync(SESSION_DIR)) {
            fs.unlinkSync(path.join(SESSION_DIR, file));
        }
        logger('[Session] Cleared session files.');
        return true;
    } catch (err) {
        logger(`[Session] Clear error: ${err.message}`);
        return false;
    }
}

module.exports = { initSession, clearSession, hasSession };
