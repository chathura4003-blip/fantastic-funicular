'use strict';

const { sendReact, isOwner, truncate } = require('../utils');
const msgMgr = require('../message-manager');
const { loadCommands } = require('../handler');
const { logger } = require('../../logger');
const db = require('../db');

module.exports = {
    name: 'reload',
    aliases: ['broadcast', 'ban', 'unban', 'block', 'unblock', 'listban'],
    description: 'Owner-only commands',

    async execute(sock, msg, from, args) {
        const sender = msg.key.participant || msg.key.remoteJid;
        if (!isOwner(sender)) {
            return msgMgr.sendTemp(sock, from, '❌ Owner only.', 4000);
        }

        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const cmd = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1);

        switch (cmd) {
            case 'reload': {
                try {
                    loadCommands();
                    await msgMgr.send(sock, from, { text: '♻️ Commands reloaded successfully.' });
                    await sendReact(sock, from, msg, '✅');
                } catch (err) {
                    await msgMgr.sendTemp(sock, from, `❌ Reload failed: ${err.message.slice(0, 80)}`, 7000);
                    await sendReact(sock, from, msg, '❌');
                }
                break;
            }

            case 'broadcast': {
                const text = args.join(' ').trim();
                if (!text) return msgMgr.sendTemp(sock, from, '⚠️ Provide a message to broadcast.', 5000);
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    const jids = Object.keys(groups || {});
                    for (const jid of jids) {
                        await msgMgr.send(sock, jid, {
                            text: `📢 *Broadcast Message*\n${'─'.repeat(24)}\n${truncate(text, 1000)}`
                        });
                        await new Promise(r => setTimeout(r, 1500));
                    }
                    await msgMgr.send(sock, from, { text: `✅ Broadcast sent to ${jids.length} groups.` });
                    await sendReact(sock, from, msg, '✅');
                } catch (err) {
                    await msgMgr.sendTemp(sock, from, `❌ Broadcast failed: ${err.message.slice(0, 60)}`, 7000);
                }
                break;
            }

            case 'ban': {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const target = mentioned[0] || (args[0] ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);
                if (!target) return msgMgr.sendTemp(sock, from, '⚠️ Mention a user to ban.', 5000);
                db.update('bans', target, { banned: true, at: Date.now() });
                await msgMgr.send(sock, from, { text: `🚫 Banned: @${target.split('@')[0]}` });
                await sendReact(sock, from, msg, '✅');
                break;
            }

            case 'unban': {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const target = mentioned[0] || (args[0] ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);
                if (!target) return msgMgr.sendTemp(sock, from, '⚠️ Mention a user to unban.', 5000);
                db.delete('bans', target);
                await msgMgr.send(sock, from, { text: `✅ Unbanned: @${target.split('@')[0]}` });
                await sendReact(sock, from, msg, '✅');
                break;
            }

            case 'listban': {
                const bans = db.getAll('bans') || {};
                const banned = Object.keys(bans).filter(k => bans[k]?.banned);
                if (!banned.length) return msgMgr.send(sock, from, { text: '✅ No banned users.' });
                let reply = `🚫 *Banned Users (${banned.length})*\n${'─'.repeat(24)}\n`;
                banned.forEach((jid, i) => { reply += `${i + 1}. @${jid.split('@')[0]}\n`; });
                await msgMgr.send(sock, from, { text: reply });
                break;
            }

            default:
                await msgMgr.sendTemp(sock, from, '❓ Unknown owner command.', 4000);
        }
    },
};
