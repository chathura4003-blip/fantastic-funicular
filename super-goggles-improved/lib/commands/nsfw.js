'use strict';

const axios = require('axios');
const { sendReact } = require('../utils');
const msgMgr = require('../message-manager');
const db = require('../db');
const { handleAPIError } = require('../error-handler');
const { isGroupAdmin, isOwner } = require('../utils');

const NSFW_SOURCES = [
    { tag: 'boobs', url: 'https://api.waifu.pics/nsfw/waifu' },
    { tag: 'ass',   url: 'https://api.waifu.pics/nsfw/waifu' },
    { tag: 'waifu', url: 'https://api.waifu.pics/nsfw/waifu' },
    { tag: 'blowjob', url: 'https://api.waifu.pics/nsfw/blowjob' },
];

function isNsfwEnabled(from) {
    const g = db.get('groups', from) || {};
    return !!g.nsfw;
}

module.exports = {
    name: 'nsfw',
    aliases: ['nsfwtoggle', 'boobs', 'ass', 'waifu', 'blowjob'],
    description: 'NSFW content (groups only, must be enabled by admin)',

    async execute(sock, msg, from, args) {
        if (!from.endsWith('@g.us')) {
            return msgMgr.sendTemp(sock, from, '🔞 NSFW is only available in groups.', 5000);
        }

        const sender = msg.key.participant || msg.key.remoteJid;
        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const cmd = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1);

        // Toggle
        if (cmd === 'nsfwtoggle' || cmd === 'nsfw') {
            const adminOk = await isGroupAdmin(sock, from, sender);
            if (!adminOk && !isOwner(sender)) {
                return msgMgr.sendTemp(sock, from, '❌ Admins only can toggle NSFW.', 4000);
            }
            const val = args[0]?.toLowerCase();
            if (val !== 'on' && val !== 'off') {
                return msgMgr.sendTemp(sock, from, '⚠️ Usage: .nsfw on / .nsfw off', 5000);
            }
            db.update('groups', from, { nsfw: val === 'on' });
            await msgMgr.send(sock, from, {
                text: val === 'on'
                    ? '🔞 NSFW mode *enabled* in this group.'
                    : '✅ NSFW mode *disabled* in this group.'
            });
            await sendReact(sock, from, msg, '✅');
            return;
        }

        // Fetch content
        if (!isNsfwEnabled(from)) {
            return msgMgr.sendTemp(sock, from,
                '🔞 NSFW is not enabled in this group.\nAsk an admin: `.nsfw on`', 6000);
        }

        const source = NSFW_SOURCES.find(s => s.tag === cmd) || NSFW_SOURCES[0];
        await sendReact(sock, from, msg, '🔞');

        try {
            const { data } = await axios.get(source.url, { timeout: 10000 });
            const url = data?.url;
            if (!url) throw new Error('No image URL returned');

            await sock.sendMessage(from, {
                image: { url },
                caption: `🔞 *${cmd.toUpperCase()}* | Powered by ${source.url.split('/')[2]}`,
            });
            await sendReact(sock, from, msg, '✅');
        } catch (err) {
            const fe = handleAPIError(err, 'NSFW');
            await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 5000);
            await sendReact(sock, from, msg, '❌');
        }
    },
};
