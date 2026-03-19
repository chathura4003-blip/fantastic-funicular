'use strict';

const os = require('os');
const { sendReact } = require('../utils');
const { BOT_NAME, PREFIX, OWNER_NUMBER } = require('../../config');
const msgMgr = require('../message-manager');

module.exports = {
    name: 'ping',
    aliases: ['alive', 'system', 'status'],
    description: 'System status and ping',

    async execute(sock, msg, from, args) {
        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const cmd = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1);

        if (cmd === 'ping') {
            await sendReact(sock, from, msg, '🏓');
            const start = Date.now();
            const sent = await sock.sendMessage(from, { text: '🏓 Pinging…' });
            const latency = Date.now() - start;
            try {
                await sock.sendMessage(from, { edit: sent.key, text: `🏓 *Pong!*\n⚡ Latency: *${latency}ms*` });
            } catch {
                await msgMgr.send(sock, from, { text: `🏓 *Pong!* ${latency}ms` });
            }
            await sendReact(sock, from, msg, '✅');
            return;
        }

        // alive / system / status
        await sendReact(sock, from, msg, '⚙️');
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);

        const totalMem = (os.totalmem() / 1073741824).toFixed(2);
        const usedMem  = ((os.totalmem() - os.freemem()) / 1073741824).toFixed(2);
        const procMem  = (process.memoryUsage().rss / 1048576).toFixed(1);

        const reply =
            `⚡ *${BOT_NAME} — System Status*\n` +
            `${'━'.repeat(28)}\n` +
            `⏱️ *Uptime:* ${h}h ${m}m ${s}s\n` +
            `💾 *RAM:* ${usedMem}GB / ${totalMem}GB\n` +
            `🔧 *Process:* ${procMem}MB RSS\n` +
            `🖥️ *OS:* ${os.type()} ${os.arch()}\n` +
            `🤖 *Prefix:* [ ${PREFIX} ]\n` +
            `${'━'.repeat(28)}\n` +
            `_All systems operational_ ✅`;

        await msgMgr.send(sock, from, { text: reply });
        await sendReact(sock, from, msg, '✅');
    },
};
