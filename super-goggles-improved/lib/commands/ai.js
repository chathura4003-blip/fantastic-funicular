'use strict';

const axios = require('axios');
const googleTTS = require('google-tts-api');
const translate = require('translate-google-api');
const { sendReact, presenceUpdate, truncate } = require('../utils');
const msgMgr = require('../message-manager');
const { handleAPIError, retryWithBackoff, safeExecute } = require('../error-handler');
const { isValidSearchQuery } = require('../validator');
const { logger } = require('../../logger');

module.exports = {
    name: 'ai',
    aliases: ['chat', 'tts', 'trt', 'translate', 'img'],
    description: 'AI chat, TTS, translation, and image generation',

    async execute(sock, msg, from, args) {
        try {
            const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
            const command = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1) || 'ai';
            const q = args?.join(' ').trim() || '';

            if (!q || !isValidSearchQuery(q, 500)) {
                return msgMgr.sendTemp(sock, from, '⚠️ Please provide some input.', 5000);
            }

            await sendReact(sock, from, msg, '🤖');
            await presenceUpdate(sock, from, command === 'tts' ? 'recording' : 'composing');

            // ── AI Chat ─────────────────────────────────────────────
            if (['ai', 'chat'].includes(command)) {
                const result = await safeExecute(async () => {
                    const data = await retryWithBackoff(
                        async () => {
                            const { data } = await axios.get(
                                `https://aivolve-api.vercel.app/api/chat?prompt=${encodeURIComponent(q)}`,
                                { timeout: 12000 }
                            );
                            if (!data?.response) throw new Error('Empty response');
                            return data;
                        },
                        { maxAttempts: 2, delayMs: 1500, context: 'AIChat', throwOnFail: true }
                    );
                    return data.response;
                }, 'AIChat');

                if (!result) {
                    await msgMgr.sendTemp(sock, from, '❌ AI service unavailable. Try again.', 6000);
                    await sendReact(sock, from, msg, '❌');
                    return;
                }

                await msgMgr.send(sock, from, { text: truncate(result, 4000) });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Text to Speech ───────────────────────────────────────
            if (command === 'tts') {
                let audioUrl;
                try {
                    audioUrl = googleTTS.getAudioUrl(q, {
                        lang: 'en', slow: false, host: 'https://translate.google.com',
                    });
                    if (!audioUrl) throw new Error('No audio URL');
                } catch {
                    logger('[AI] Google TTS unavailable, skipping');
                }

                if (!audioUrl) {
                    await msgMgr.sendTemp(sock, from, '❌ Text-to-speech service is unavailable.', 6000);
                    await sendReact(sock, from, msg, '❌');
                    return;
                }

                await sock.sendMessage(from, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mpeg',
                    ptt: true,
                });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Translation ──────────────────────────────────────────
            if (['trt', 'translate'].includes(command)) {
                const translated = await safeExecute(async () => {
                    return retryWithBackoff(
                        async () => {
                            try {
                                const r = await translate(q, { to: 'si' });
                                return Array.isArray(r) ? r[0] : r;
                            } catch {
                                const r = await translate(q, { to: 'en' });
                                return Array.isArray(r) ? r[0] : r;
                            }
                        },
                        { maxAttempts: 2, delayMs: 1000, context: 'Translation', throwOnFail: true }
                    );
                }, 'Translation');

                if (!translated) {
                    await msgMgr.sendTemp(sock, from, '❌ Translation failed.', 6000);
                    await sendReact(sock, from, msg, '❌');
                    return;
                }

                await msgMgr.send(sock, from, {
                    text: `🌐 *Translation*\n${'─'.repeat(24)}\n${truncate(translated, 2000)}`,
                });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── AI Image ─────────────────────────────────────────────
            if (command === 'img') {
                const imgUrl = `https://aivolve-api.vercel.app/api/image?prompt=${encodeURIComponent(q)}`;
                const ok = await safeExecute(async () => {
                    const res = await axios.head(imgUrl, { timeout: 8000 });
                    return res.status === 200;
                }, 'AIImage');

                if (!ok) {
                    await msgMgr.sendTemp(sock, from, '❌ Image generation service unavailable.', 6000);
                    await sendReact(sock, from, msg, '❌');
                    return;
                }

                await sock.sendMessage(from, {
                    image: { url: imgUrl },
                    caption: `🎨 *AI Image:* "${truncate(q, 50)}"`,
                });
                await sendReact(sock, from, msg, '✅');
                return;
            }

            await sendReact(sock, from, msg, '❓');
            await msgMgr.sendTemp(sock, from, '❓ Unknown AI command.', 5000);

        } catch (err) {
            await sendReact(sock, from, msg, '❌');
            const fe = handleAPIError(err, 'AI');
            await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 7000);
        }
    },
};
