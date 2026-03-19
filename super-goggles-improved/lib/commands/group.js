'use strict';

const { sendReact, isGroupAdmin, isOwner } = require('../utils');
const msgMgr = require('../message-manager');
const db = require('../db');

module.exports = {
    name: 'kick',
    aliases: ['add', 'promote', 'demote', 'lock', 'unlock', 'antilink'],
    description: 'Group management tools (admin only)',

    async execute(sock, msg, from, args) {
        if (!from.endsWith('@g.us')) {
            return msgMgr.sendTemp(sock, from, '⚠️ This command is for groups only.', 5000);
        }

        const sender = msg.key.participant || msg.key.remoteJid;
        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const cmd = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1);

        const adminOk = await isGroupAdmin(sock, from, sender);
        if (!adminOk && !isOwner(sender)) {
            return msgMgr.sendTemp(sock, from, '❌ Admins only.', 4000);
        }

        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const target = mentioned[0];

        try {
            switch (cmd) {
                case 'kick':
                    if (!target) return msgMgr.sendTemp(sock, from, '⚠️ Mention a user to kick.', 5000);
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await sendReact(sock, from, msg, '✅');
                    break;

                case 'add': {
                    const num = args[0]?.replace(/\D/g, '');
                    if (!num) return msgMgr.sendTemp(sock, from, '⚠️ Provide a phone number.', 5000);
                    await sock.groupParticipantsUpdate(from, [`${num}@s.whatsapp.net`], 'add');
                    await sendReact(sock, from, msg, '✅');
                    break;
                }

                case 'promote':
                    if (!target) return msgMgr.sendTemp(sock, from, '⚠️ Mention a user.', 5000);
                    await sock.groupParticipantsUpdate(from, [target], 'promote');
                    await sendReact(sock, from, msg, '✅');
                    break;

                case 'demote':
                    if (!target) return msgMgr.sendTemp(sock, from, '⚠️ Mention a user.', 5000);
                    await sock.groupParticipantsUpdate(from, [target], 'demote');
                    await sendReact(sock, from, msg, '✅');
                    break;

                case 'lock':
                    await sock.groupSettingUpdate(from, 'announcement');
                    await msgMgr.send(sock, from, { text: '🔒 Group locked — only admins can send messages.' });
                    await sendReact(sock, from, msg, '✅');
                    break;

                case 'unlock':
                    await sock.groupSettingUpdate(from, 'not_announcement');
                    await msgMgr.send(sock, from, { text: '🔓 Group unlocked — everyone can send messages.' });
                    await sendReact(sock, from, msg, '✅');
                    break;

                case 'antilink': {
                    const val = args[0]?.toLowerCase();
                    if (val !== 'on' && val !== 'off') {
                        return msgMgr.sendTemp(sock, from, '⚠️ Use: .antilink on/off', 5000);
                    }
                    db.update('groups', from, { antilink: val === 'on' });
                    await msgMgr.send(sock, from, { text: `🛡️ Anti-link ${val === 'on' ? 'enabled' : 'disabled'}.` });
                    await sendReact(sock, from, msg, '✅');
                    break;
                }

                default:
                    await msgMgr.sendTemp(sock, from, '❓ Unknown group command.', 5000);
            }
        } catch (err) {
            await msgMgr.sendTemp(sock, from, `❌ Failed: ${err.message?.slice(0, 60)}`, 5000);
            await sendReact(sock, from, msg, '❌');
        }
    },
};
