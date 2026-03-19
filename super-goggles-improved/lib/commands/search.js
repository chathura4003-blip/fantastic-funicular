'use strict';

const axios = require('axios');
const { searchYouTube, searchAdultSite, searchAllAdult } = require('../search');
const { sendReact, presenceUpdate, truncate } = require('../utils');
const { storeSearchResults } = require('../handler');
const { handleAPIError, retryWithBackoff } = require('../error-handler');
const { isValidSearchQuery } = require('../validator');
const rateLimiter = require('../rate-limiter');
const msgMgr = require('../message-manager');

const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

const ADULT_SITE_MAP = {
    phsearch: 'Pornhub',
    xvsearch: 'XVideos',
    xhsearch: 'xHamster',
    ypsearch: 'YouPorn',
    sbsearch: 'SpankBang',
    rtsearch: 'RedTube',
};

function formatList(results, query, emoji, label) {
    let msg = `${emoji} *${label}*\n🔍 _"${truncate(query, 40)}"_\n${'─'.repeat(28)}\n\n`;
    results.forEach((v, i) => {
        msg += `${NUM_EMOJI[i] || `${i+1}.`} ${truncate(v.title, 45)} _(${v.duration || '?'})_\n`;
    });
    msg += `\n${'─'.repeat(28)}\n👉 *Reply 1–${results.length} to download*`;
    return msg;
}

module.exports = {
    name: 'search',
    aliases: ['yts', 'g', 'wiki', 'reddit', 'pinsearch', ...Object.keys(ADULT_SITE_MAP)],
    description: 'Multi-site search engine',

    async execute(sock, msg, from, args) {
        const q = args?.join(' ').trim() || '';
        if (!isValidSearchQuery(q)) {
            return msgMgr.sendTemp(sock, from, '🔍 Please provide a search keyword.', 5000);
        }

        const sender = msg?.key?.participant || msg?.key?.remoteJid;
        const limit = rateLimiter.check(sender, 'search', 5);
        if (!limit.allowed) {
            return msgMgr.sendTemp(sock, from, `⏳ Too many searches. Wait ${limit.resetIn}s.`, 5000);
        }

        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const command = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1) || 'yts';

        await sendReact(sock, from, msg, '🔍');
        await presenceUpdate(sock, from, 'composing');

        try {
            // ── YouTube ──────────────────────────────────────────────
            if (command === 'yts') {
                const results = await retryWithBackoff(
                    () => searchYouTube(q, 10),
                    { maxAttempts: 2, delayMs: 1000, throwOnFail: false, fallback: [] }
                );
                if (!results.length) {
                    return msgMgr.sendTemp(sock, from, `❌ No YouTube results for "${q}".`, 6000);
                }
                await msgMgr.send(sock, from, { text: formatList(results, q, '▶️', 'YouTube Search') });
                storeSearchResults(msg?.key?.id, sender, results);
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Adult sites ───────────────────────────────────────────
            const adultSite = ADULT_SITE_MAP[command];
            if (adultSite) {
                const results = await retryWithBackoff(
                    () => searchAdultSite(adultSite, q, 10),
                    { maxAttempts: 2, delayMs: 1000, throwOnFail: false, fallback: [] }
                );
                if (!results.length) {
                    return msgMgr.sendTemp(sock, from,
                        `🔞 No *${adultSite}* results for "${q}". Try again shortly.`, 7000);
                }
                await msgMgr.send(sock, from, { text: formatList(results, q, '🔞', `${adultSite} Search`) });
                storeSearchResults(msg?.key?.id, sender, results);
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── DuckDuckGo ────────────────────────────────────────────
            if (command === 'g') {
                const { data } = await axios.get(
                    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json`,
                    { timeout: 8000 }
                );
                let reply = `🌐 *DuckDuckGo Search*\n🔍 _"${truncate(q, 40)}"_\n${'─'.repeat(28)}\n\n`;
                if (data?.AbstractText) reply += `📋 ${truncate(data.AbstractText, 400)}\n\n`;
                (data?.RelatedTopics || []).slice(0, 5).forEach(r => {
                    if (r?.Text) reply += `• ${truncate(r.Text, 80)}\n`;
                });
                if (!data?.AbstractText) reply += `_No instant answer. Try .wiki ${q}_`;
                await msgMgr.send(sock, from, { text: reply });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Wikipedia ─────────────────────────────────────────────
            if (command === 'wiki') {
                const { data } = await axios.get(
                    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
                    { timeout: 8000 }
                );
                const reply =
                    `📖 *Wikipedia: ${truncate(data.title, 60)}*\n${'─'.repeat(28)}\n\n` +
                    `${truncate(data.extract, 600)}\n\n` +
                    `🔗 ${data?.content_urls?.desktop?.page || ''}`;
                await msgMgr.send(sock, from, { text: reply });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Reddit ────────────────────────────────────────────────
            if (command === 'reddit') {
                const { data } = await axios.get(
                    `https://www.reddit.com/r/${encodeURIComponent(q)}/hot.json?limit=8`,
                    { headers: { 'User-Agent': 'SupremeBot/3.0' }, timeout: 8000 }
                );
                const posts = (data?.data?.children || []).map(p => p.data).filter(Boolean);
                if (!posts.length) {
                    return msgMgr.sendTemp(sock, from, `❌ No posts in r/${q}.`, 5000);
                }
                let reply = `🔴 *Reddit — r/${truncate(q, 30)}*\n${'─'.repeat(28)}\n\n`;
                posts.slice(0, 8).forEach((p, i) => {
                    reply += `${NUM_EMOJI[i] || `${i+1}.`} *${truncate(p.title, 55)}*\n   👍 ${p.ups || 0} | 💬 ${p.num_comments || 0}\n\n`;
                });
                await msgMgr.send(sock, from, { text: reply });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Pinterest ─────────────────────────────────────────────
            if (command === 'pinsearch') {
                const link = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`;
                await msgMgr.send(sock, from, {
                    text: `📌 *Pinterest:* "${truncate(q, 40)}"\n\n🔗 ${link}\n\n_Open in browser._`
                });
                await sendReact(sock, from, msg, '✅');
                return;
            }

        } catch (err) {
            await sendReact(sock, from, msg, '❌');
            const fe = handleAPIError(err, 'Search');
            await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 7000);
        }
    },
};
