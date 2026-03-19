'use strict';

const { logger } = require('../logger');

/**
 * Manages message sending with auto-delete for temporary messages.
 * Keeps conversations clean by removing status/error messages after a delay.
 */
class MessageManager {
    constructor() {
        this.pending = new Map(); // jid → { key, timer }
    }

    /**
     * Send a message that auto-deletes after `ms` milliseconds.
     */
    async sendTemp(sock, jid, text, ms = 6000) {
        if (!sock || !jid || !text) return null;
        try {
            const sent = await sock.sendMessage(jid, { text });
            if (!sent?.key) return sent;

            // Cancel any previous pending delete for this chat
            this._cancelPending(jid);

            const timer = setTimeout(async () => {
                this.pending.delete(jid);
                try { await sock.sendMessage(jid, { delete: sent.key }); } catch {}
            }, ms);
            timer.unref();

            this.pending.set(jid, { key: sent.key, timer });
            return sent;
        } catch (err) {
            logger(`[MsgMgr] sendTemp: ${err.message}`);
            return null;
        }
    }

    /**
     * Send a permanent message (no auto-delete).
     */
    async send(sock, jid, content) {
        if (!sock || !jid || !content) return null;
        try {
            return await sock.sendMessage(jid, content);
        } catch (err) {
            // 403 = permission denied (group admin-only, or bot removed) — suppress noise
            if (!err.message?.includes('403')) {
                logger(`[MsgMgr] send: ${err.message}`);
            }
            return null;
        }
    }

    /**
     * React to a message with an emoji.
     */
    async react(sock, jid, msgKey, emoji) {
        if (!sock || !jid || !msgKey || !emoji) return;
        try {
            await sock.sendMessage(jid, { react: { text: emoji, key: msgKey } });
        } catch {}
    }

    /**
     * Delete a message by key.
     */
    async delete(sock, jid, msgKey) {
        if (!sock || !jid || !msgKey) return false;
        try {
            await sock.sendMessage(jid, { delete: msgKey });
            return true;
        } catch { return false; }
    }

    _cancelPending(jid) {
        const rec = this.pending.get(jid);
        if (rec?.timer) clearTimeout(rec.timer);
        this.pending.delete(jid);
    }

    cleanup() {
        for (const { timer } of this.pending.values()) {
            if (timer) clearTimeout(timer);
        }
        this.pending.clear();
    }
}

module.exports = new MessageManager();
