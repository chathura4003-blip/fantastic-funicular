'use strict';

const axios = require('axios');
const { sendReact } = require('../utils');
const msgMgr = require('../message-manager');
const { handleAPIError } = require('../error-handler');

const JOKE_API = 'https://v2.jokeapi.dev/joke/Any?safe-mode';
const FACT_API = 'https://uselessfacts.jsph.pl/random.json?language=en';
const MEME_API = 'https://meme-api.com/gimme';
const INSPIRE_API = 'https://zenquotes.io/api/random';

module.exports = {
    name: 'joke',
    aliases: ['meme', 'fact', 'inspire', 'quote', 'roll', 'flip'],
    description: 'Fun commands',

    async execute(sock, msg, from, args) {
        const cmdText = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        const cmd = cmdText.trim().toLowerCase().split(/\s+/)[0].slice(1);

        await sendReact(sock, from, msg, '🎲');

        try {
            switch (cmd) {
                case 'joke': {
                    const { data } = await axios.get(JOKE_API, { timeout: 8000 });
                    const text = data.type === 'twopart'
                        ? `😂 *Joke*\n\n*Q:* ${data.setup}\n\n*A:* ${data.delivery}`
                        : `😂 *Joke*\n\n${data.joke}`;
                    await msgMgr.send(sock, from, { text });
                    break;
                }

                case 'meme': {
                    const { data } = await axios.get(MEME_API, { timeout: 10000 });
                    if (!data?.url) throw new Error('No meme URL');
                    await sock.sendMessage(from, {
                        image: { url: data.url },
                        caption: `😂 *${data.title || 'Meme'}*\n👍 ${data.ups || 0} | 💬 ${data.num_comments || 0}`,
                    });
                    break;
                }

                case 'fact': {
                    const { data } = await axios.get(FACT_API, { timeout: 8000 });
                    await msgMgr.send(sock, from, { text: `🧠 *Random Fact*\n\n${data.text}` });
                    break;
                }

                case 'inspire':
                case 'quote': {
                    const { data } = await axios.get(INSPIRE_API, { timeout: 8000 });
                    const q = Array.isArray(data) ? data[0] : data;
                    await msgMgr.send(sock, from, {
                        text: `✨ *Quote of the Day*\n\n_"${q.q}"_\n— *${q.a}*`
                    });
                    break;
                }

                case 'roll': {
                    const max = parseInt(args[0]) || 6;
                    const roll = Math.floor(Math.random() * max) + 1;
                    await msgMgr.send(sock, from, { text: `🎲 *Dice Roll (1–${max})*\nResult: *${roll}*` });
                    break;
                }

                case 'flip': {
                    const r = Math.random() > 0.5 ? '🟡 Heads' : '⚪ Tails';
                    await msgMgr.send(sock, from, { text: `🪙 *Coin Flip*\nResult: *${r}*` });
                    break;
                }

                default:
                    await msgMgr.sendTemp(sock, from, '❓ Unknown fun command.', 4000);
            }

            await sendReact(sock, from, msg, '✅');
        } catch (err) {
            const fe = handleAPIError(err, 'Fun');
            await msgMgr.sendTemp(sock, from, `❌ ${fe.message}`, 5000);
            await sendReact(sock, from, msg, '❌');
        }
    },
};
