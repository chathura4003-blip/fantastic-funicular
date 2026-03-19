'use strict';

/**
 * Universal media downloader command.
 * Supports: YouTube, TikTok, Instagram, Facebook + adult sites.
 * Modes: direct URL (quality picker) and keyword search.
 */

const { getMetadata, downloadAndSend } = require('../download-manager');
const { searchYouTube, searchAdultSite, searchAllAdult } = require('../search');
const { sendReact, presenceUpdate, truncate } = require('../utils');
const { storeSearchResults, showQualityMenu } = require('../handler');
const { isValidUrl, isValidSearchQuery, parseArgs } = require('../validator');
const { handleAPIError, retryWithBackoff } = require('../error-handler');
const rateLimiter = require('../rate-limiter');
const msgMgr = require('../message-manager');
const { logger } = require('../../logger');

const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

const SITE_MAP = {
    yt:   { name: 'YouTube',   adult: false },
    yta:  { name: 'YouTube',   adult: false },
    tt:   { name: 'TikTok',    adult: false },
    ig:   { name: 'Instagram', adult: false },
    fb:   { name: 'Facebook',  adult: false },
    ph:   { name: 'Pornhub',   adult: true  },
    xnxx: { name: 'XNXX',      adult: true  },
    xv:   { name: 'XVideos',   adult: true  },
    xh:   { name: 'xHamster',  adult: true  },
    yp:   { name: 'YouPorn',   adult: true  },
    sb:   { name: 'SpankBang', adult: true  },
    rt:   { name: 'RedTube',   adult: true  },
};

function getCommand(msg) {
    const t = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
    return t.trim().toLowerCase().split(/\s+/)[0].slice(1) || 'yt';
}

module.exports = {
    name: 'download',
    aliases: Object.keys(SITE_MAP),
    description: 'Universal media downloader',

    async execute(sock, msg, from, args) {
        if (!msg?.key || !from) return;

        const sender = msg.key.participant || msg.key.remoteJid;
        const command = getCommand(msg);
        const site = SITE_MAP[command] || { name: 'Media', adult: false };

        // Rate limit: 3 downloads per minute per user
        const limit = rateLimiter.check(sender, 'download', 3);
        if (!limit.allowed) {
            await msgMgr.sendTemp(sock, from, `⏳ Slow down! Wait ${limit.resetIn}s.`, 5000);
            return;
        }

        const { urls, keywords, flags } = parseArgs(args);
        const isAudio = command === 'yta' || flags.audio || flags.mp3;
        let quality = flags.hd ? 'hd' : flags.low ? 'low' : 'sd';
        const url = urls[0];
        const keyword = keywords.join(' ');

        // ── Nothing provided ──────────────────────────────────────────
        if (!url && !keyword) {
            await sendReact(sock, from, msg, '❓');
            await msgMgr.sendTemp(sock, from,
                `⚠️ *Usage*\n*.${command} <link>* — direct download\n*.${command} <keyword>* — search\n\n_Example: .${command} funny cats_`,
                8000);
            return;
        }

        // ── Keyword search ────────────────────────────────────────────
        if (!url && keyword) {
            if (!isValidSearchQuery(keyword)) {
                await msgMgr.sendTemp(sock, from, '❌ Invalid query (max 100 chars).', 4000);
                return;
            }

            await sendReact(sock, from, msg, '🔍');
            await presenceUpdate(sock, from, 'composing');
            await msgMgr.sendTemp(sock, from, `🔍 Searching *${site.name}*…`, 3000);

            try {
                let results = await retryWithBackoff(
                    async () => {
                        if (!site.adult) return searchYouTube(keyword, 10);
                        const r = await searchAdultSite(site.name, keyword, 10);
                        return r.length ? r : searchAllAdult(keyword, 10);
                    },
                    { maxAttempts: 2, delayMs: 1000, context: 'MediaSearch', throwOnFail: false, fallback: [] }
                );

                if (!results?.length) {
                    await msgMgr.sendTemp(sock, from, '❌ No results found.', 5000);
                    await sendReact(sock, from, msg, '❌');
                    return;
                }

                results = results.slice(0, 10);
                const emoji = site.adult ? '🔞' : '🎥';
                let listMsg = `${emoji} *${site.name.toUpperCase()} SEARCH*\n`;
                listMsg += `🔍 _"${truncate(keyword, 35)}"_\n${'─'.repeat(30)}\n\n`;
                results.forEach((v, i) => {
                    listMsg += `${NUM_EMOJI[i] || `${i+1}.`} ${truncate(v.title, 45)}\n   ⏱️ ${v.duration || '?'}\n`;
                });
                listMsg += `\n${'─'.repeat(30)}\n👉 *Reply 1–${results.length} to select*`;

                await msgMgr.send(sock, from, { text: listMsg });
                storeSearchResults(msg.key.id, sender, results);
                await sendReact(sock, from, msg, '✅');

            } catch (err) {
                const fe = handleAPIError(err, 'Search');
                await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 5000);
                await sendReact(sock, from, msg, '❌');
            }
            return;
        }

        // ── Direct URL ────────────────────────────────────────────────
        if (!isValidUrl(url)) {
            await msgMgr.sendTemp(sock, from, '❌ Invalid URL.', 4000);
            await sendReact(sock, from, msg, '❌');
            return;
        }

        const hasQuality = flags.hd || flags.sd || flags.low || isAudio;

        // Show quality picker if no quality specified
        if (!hasQuality) {
            await sendReact(sock, from, msg, '🎬');
            await presenceUpdate(sock, from, 'composing');
            try {
                const meta = await getMetadata(url);
                if (meta) {
                    await showQualityMenu(sock, from, meta, sender);
                } else {
                    await msgMgr.sendTemp(sock, from,
                        `🎬 *Select Quality:*\n*.${command} ${url} hd*\n*.${command} ${url} sd*\n*.yta ${url}* (Audio)`,
                        10000);
                }
            } catch (err) {
                logger(`[Download] Metadata: ${err.message}`);
            }
            return;
        }

        // Begin download
        await sendReact(sock, from, msg, '⏳');
        await presenceUpdate(sock, from, isAudio ? 'recording' : 'composing');

        try {
            await downloadAndSend(sock, from, url, site.name, quality, isAudio);
            await sendReact(sock, from, msg, '✅');
        } catch (err) {
            const fe = handleAPIError(err, 'Download');
            await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 5000);
            await sendReact(sock, from, msg, '❌');
            logger(`[Download] Error: ${err.message}`);
        }
    },
};
