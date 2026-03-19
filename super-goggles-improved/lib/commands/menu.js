'use strict';

const path = require('path');
const { BOT_NAME, PREFIX, OWNER_NUMBER } = require('../../config');
const { sendReact } = require('../utils');
const msgMgr = require('../message-manager');

const LOGO = path.join(__dirname, '../../supreme_bot_logo.png');

module.exports = {
    name: 'menu',
    aliases: ['help', 'allmenu', 'commands', 'list', 'start'],
    description: 'Bot command menu',

    async execute(sock, msg, from) {
        await sendReact(sock, from, msg, '📜');

        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);

        const fullMenu =
            `╔══════════════════════╗\n` +
            `   ✨ ${BOT_NAME} v3.0 ✨\n` +
            `   PREFIX: [ ${PREFIX} ]  |  UPTIME: ${h}h ${m}m\n` +
            `╚══════════════════════╝\n\n` +

            `📥 *DOWNLOADERS*\n` +
            `${PREFIX}yt  <link/keyword> — YouTube (video)\n` +
            `${PREFIX}yta <link/keyword> — YouTube (MP3)\n` +
            `${PREFIX}tt  <link>         — TikTok\n` +
            `${PREFIX}ig  <link>         — Instagram\n` +
            `${PREFIX}fb  <link>         — Facebook\n` +
            `_Quality flags: hd · sd · low_\n\n` +

            `🔞 *ADULT DOWNLOADERS*\n` +
            `${PREFIX}ph · ${PREFIX}xnxx · ${PREFIX}xv · ${PREFIX}xh · ${PREFIX}yp · ${PREFIX}sb · ${PREFIX}rt\n` +
            `_Usage: .ph <link or keyword>_\n\n` +

            `🔍 *SEARCH*\n` +
            `${PREFIX}yts   <keyword> — YouTube search\n` +
            `${PREFIX}g     <query>   — DuckDuckGo\n` +
            `${PREFIX}wiki  <topic>   — Wikipedia\n` +
            `${PREFIX}reddit <sub>    — Reddit hot posts\n\n` +

            `🤖 *AI TOOLS*\n` +
            `${PREFIX}ai  <text> — AI chat assistant\n` +
            `${PREFIX}img <prompt> — AI image\n` +
            `${PREFIX}tts <text>   — Text to speech\n` +
            `${PREFIX}trt <text>   — Translate (EN ↔ SI)\n\n` +

            `👑 *GROUP CONTROL* _(Admin)_\n` +
            `${PREFIX}kick · ${PREFIX}add · ${PREFIX}promote · ${PREFIX}demote\n` +
            `${PREFIX}lock · ${PREFIX}unlock · ${PREFIX}antilink\n\n` +

            `💰 *ECONOMY*\n` +
            `${PREFIX}balance · ${PREFIX}daily · ${PREFIX}shop · ${PREFIX}buy\n\n` +

            `📊 *SYSTEM*\n` +
            `${PREFIX}ping  — Latency check\n` +
            `${PREFIX}alive — System status\n` +
            `${PREFIX}menu  — This menu\n\n` +

            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `_${BOT_NAME} | Owner: +${OWNER_NUMBER}_`;

        try {
            const { default: fs } = await Promise.resolve().then(() => require('fs'));
            if (fs.existsSync(LOGO)) {
                await sock.sendMessage(from, { image: { url: LOGO }, caption: fullMenu });
            } else {
                await msgMgr.send(sock, from, { text: fullMenu });
            }
        } catch {
            await msgMgr.send(sock, from, { text: fullMenu });
        }

        await sendReact(sock, from, msg, '✅');
    },
};
