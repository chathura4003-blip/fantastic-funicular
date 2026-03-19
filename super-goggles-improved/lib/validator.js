'use strict';

/**
 * Input validation helpers.
 */

function isValidUrl(str) {
    if (!str || typeof str !== 'string') return false;
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
}

function isValidSearchQuery(q, maxLen = 100) {
    if (!q || typeof q !== 'string') return false;
    const clean = q.trim();
    return clean.length > 0 && clean.length <= maxLen;
}

function isValidJID(jid) {
    if (!jid || typeof jid !== 'string') return false;
    return /^[0-9]+-?[0-9]*@(g\.us|s\.whatsapp\.net)$/.test(jid);
}

function extractPhone(jid) {
    if (!jid) return '';
    return jid.split('@')[0].replace(/\D/g, '');
}

/**
 * Parse command args into { urls, keywords, flags }.
 * flags: hd, sd, low, audio, mp3
 */
function parseArgs(args) {
    const result = { urls: [], keywords: [], flags: {} };
    if (!Array.isArray(args)) return result;
    for (const arg of args) {
        if (!arg || typeof arg !== 'string') continue;
        const clean = arg.trim();
        if (!clean) continue;
        if (isValidUrl(clean)) {
            result.urls.push(clean);
        } else if (['hd', 'sd', 'low', 'audio', 'mp3'].includes(clean.toLowerCase())) {
            result.flags[clean.toLowerCase()] = true;
        } else {
            result.keywords.push(clean);
        }
    }
    return result;
}

module.exports = { isValidUrl, isValidSearchQuery, isValidJID, extractPhone, parseArgs };
