'use strict';

/**
 * Central command handler.
 * - Loads all commands from lib/commands/
 * - Routes prefix commands, button responses, list responses, and number replies
 * - Manages search results and quality-selection state with TTL caches
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');
const { MemoryCache } = require('./memory-cache');
const { handleAPIError, safeExecute } = require('./error-handler');
const { getMetadata, downloadAndSend } = require('./download-manager');
const msgMgr = require('./message-manager');
const { sendReact, presenceUpdate, truncate } = require('./utils');
const { BOT_NAME, PREFIX } = require('../config');

// Registry
const commands = new Map();

// State caches
const searchResults    = new MemoryCache(600000);  // jid:msgId → results[]
const lastSearch       = new MemoryCache(600000);  // sender   → { results, msgId }
const qualitySelection = new MemoryCache(300000);  // sender   → { meta }

// ── Loader ────────────────────────────────────────────────────────────────

function loadCommands() {
    const dir = path.join(__dirname, 'commands');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        try {
            const cmdPath = path.join(dir, file);
            delete require.cache[require.resolve(cmdPath)];
            const cmd = require(cmdPath);
            if (!cmd.name || typeof cmd.execute !== 'function') continue;
            commands.set(cmd.name, cmd);
            (cmd.aliases || []).forEach(a => commands.set(a, cmd));
        } catch (err) {
            logger(`[Handler] Failed to load ${file}: ${err.message}`);
        }
    }
    logger(`[Handler] Loaded ${commands.size} commands`);
}

// ── State helpers ─────────────────────────────────────────────────────────

function storeSearchResults(msgId, sender, results) {
    if (!msgId || !sender || !Array.isArray(results)) return;
    const entry = { results, sender };
    searchResults.set(`${sender}:${msgId}`, entry, 600000);
    lastSearch.set(sender, { results, msgId }, 600000);
}

async function showQualityMenu(sock, from, meta, sender) {
    if (!sock || !from || !meta) return;

    qualitySelection.set(sender, { meta }, 300000);

    const sizeStr = meta.filesize
        ? `${(meta.filesize / (1024 * 1024)).toFixed(1)} MB`
        : 'Calculating…';

    const menuText =
        `🎬 *VIDEO READY*\n` +
        `${'━'.repeat(28)}\n` +
        `📝 *${truncate(meta.title, 55)}*\n` +
        `⏱️ Duration: ${meta.duration || '?'}\n` +
        `🌐 Source: ${meta.source || 'Media'}\n` +
        `📦 Size: ${sizeStr}\n` +
        `${'━'.repeat(28)}\n` +
        `1️⃣ HD  |  2️⃣ SD  |  3️⃣ Audio\n` +
        `${'━'.repeat(28)}\n` +
        `_Reply with 1, 2, or 3 to download_`;

    const buttons = [
        { buttonId: `${PREFIX}yt hd ${meta.url}`, buttonText: { displayText: '1️⃣ HD' }, type: 1 },
        { buttonId: `${PREFIX}yt sd ${meta.url}`, buttonText: { displayText: '2️⃣ SD' }, type: 1 },
        { buttonId: `${PREFIX}yta ${meta.url}`,   buttonText: { displayText: '3️⃣ Audio' }, type: 1 },
    ];

    const content = {
        buttons,
        footer: `⚡ ${BOT_NAME} Downloader`,
    };

    if (meta.thumbnail) {
        content.image = { url: meta.thumbnail };
        content.caption = menuText;
    } else {
        content.text = menuText;
    }

    try {
        await msgMgr.send(sock, from, content);
    } catch {
        await msgMgr.send(sock, from, { text: menuText });
    }
}

// ── Main router ───────────────────────────────────────────────────────────

async function handleCommand(sock, msg, from, text) {
    if (!msg?.key || !from) return false;

    try {
        const sender = msg.key.participant || msg.key.remoteJid;

        // ── List response (menu selection) ────────────────────────────
        const listResp = msg.message?.listResponseMessage;
        const rowId = listResp?.singleSelectReply?.selectedRowId;
        if (rowId?.startsWith('pick:')) {
            const idx = parseInt(rowId.replace('pick:', ''), 10);
            const entry = lastSearch.get(sender);
            if (entry && !isNaN(idx) && entry.results?.[idx]) {
                const meta = await safeExecute(
                    () => getMetadata(entry.results[idx].url),
                    'GetMetadata'
                ) || entry.results[idx];
                await showQualityMenu(sock, from, meta, sender);
                return true;
            }
        }

        // ── Button response ───────────────────────────────────────────
        if (!text) {
            const btnResp = msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage;
            const btnId = btnResp?.selectedButtonId || btnResp?.selectedId;
            if (btnId) {
                return await handleCommand(sock, msg, from, btnId);
            }
        }

        const cmdText = text ||
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text || '';

        if (!cmdText) return false;

        const lower = cmdText.trim().toLowerCase();

        // ── Numeric reply (1–10) ──────────────────────────────────────
        if (/^\d+$/.test(lower)) {
            const num = parseInt(lower, 10);
            const idx = num - 1;

            // Quality selection (1=HD, 2=SD, 3=Audio)
            const qEntry = qualitySelection.get(sender);
            if (qEntry && num >= 1 && num <= 3) {
                const { meta } = qEntry;
                await sendReact(sock, from, msg, '⏳');
                await presenceUpdate(sock, from, num === 3 ? 'recording' : 'composing');
                try {
                    const quality = num === 1 ? 'hd' : 'sd';
                    const isAudio = num === 3;
                    await downloadAndSend(sock, from, meta.url, meta.source || 'Media', quality, isAudio);
                    await sendReact(sock, from, msg, '✅');
                    qualitySelection.delete(sender);
                } catch (err) {
                    const fe = handleAPIError(err, 'QualityDownload');
                    await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 5000);
                    await sendReact(sock, from, msg, '❌');
                }
                return true;
            }

            // Search result selection
            const ctxId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
            const key = ctxId ? `${sender}:${ctxId}` : null;
            const entry = (key && searchResults.get(key)) || lastSearch.get(sender);
            if (entry && idx >= 0 && idx < entry.results.length) {
                await sendReact(sock, from, msg, '🎬');
                const meta = await safeExecute(
                    () => getMetadata(entry.results[idx].url),
                    'GetMetadataFromSearch'
                ) || entry.results[idx];
                await showQualityMenu(sock, from, meta, sender);
                return true;
            }
        }

        // ── Prefix commands ───────────────────────────────────────────
        if (!cmdText.startsWith(PREFIX)) return false;

        const args = cmdText.slice(PREFIX.length).trim().split(/\s+/);
        const name = args.shift()?.toLowerCase();
        if (!name) return false;

        const cmd = commands.get(name);
        if (!cmd) return false;

        try {
            await cmd.execute(sock, msg, from, args);
        } catch (err) {
            logger(`[Command/${name}] ${err.message}`);
            await msgMgr.sendTemp(sock, from, '❌ Command error. Please try again.', 4000);
        }
        return true;

    } catch (err) {
        logger(`[Handler] Unexpected: ${err.message}`);
        return false;
    }
}

module.exports = {
    loadCommands,
    handleCommand,
    storeSearchResults,
    showQualityMenu,
};
