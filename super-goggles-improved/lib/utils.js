'use strict';

const { OWNER_NUMBER } = require('../config');
const msgMgr = require('./message-manager');
const { safeExecute } = require('./error-handler');

async function sendReact(sock, from, msg, emoji) {
    if (!sock || !from || !msg?.key || !emoji) return;
    await msgMgr.react(sock, from, msg.key, emoji);
}

async function presenceUpdate(sock, from, type = 'composing') {
    if (!sock || !from) return;
    await safeExecute(() => sock.sendPresenceUpdate(type, from), 'PresenceUpdate');
}

function isOwner(sender) {
    if (!sender) return false;
    return sender.replace(/\D/g, '') === OWNER_NUMBER.replace(/\D/g, '');
}

async function isGroupAdmin(sock, from, sender) {
    if (!sock || !from || !sender) return false;
    if (!from.endsWith('@g.us')) return false;
    try {
        const meta = await sock.groupMetadata(from);
        const p = meta?.participants?.find(x => x.id === sender);
        return p?.admin === 'admin' || p?.admin === 'superadmin';
    } catch { return false; }
}

/**
 * Truncate string to max characters.
 */
function truncate(str, max = 50) {
    if (!str || typeof str !== 'string') return 'Unknown';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = { sendReact, presenceUpdate, isOwner, isGroupAdmin, truncate };
