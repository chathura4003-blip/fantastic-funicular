'use strict';

/**
 * Download Manager
 * - Uses shared yt-dlp instance from ytdlp-manager
 * - In-memory download cache with auto-cleanup
 * - Streaming file send (no full-file buffering)
 * - Auto-delete temp files after sending
 * - Fallback quality chain: HD → SD → Low → Audio
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const { logger } = require('../logger');
const { DOWNLOAD_DIR, DOWNLOAD_CACHE_TTL } = require('../config');
const { retryWithBackoff, handleAPIError } = require('./error-handler');
const { getYtdlp, FFMPEG_PATH, fluentFfmpeg, getBinPath } = require('./ytdlp-manager');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ── Download cache ────────────────────────────────────────────────────────

const _cache = new Map(); // key → { filePath, timer }

function _cacheKey(url, quality, audio) {
    return crypto.createHash('md5').update(`${url}|${quality}|${audio}`).digest('hex');
}

function _getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (!fs.existsSync(entry.filePath)) {
        _cache.delete(key);
        return null;
    }
    return entry;
}

function _putCache(key, filePath) {
    const existing = _cache.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
        _safeDelete(filePath);
        _cache.delete(key);
    }, DOWNLOAD_CACHE_TTL);
    timer.unref();

    _cache.set(key, { filePath, timer });
}

function _safeDelete(filePath) {
    if (filePath) try { fs.unlinkSync(filePath); } catch {}
}

// ── Startup cleanup ───────────────────────────────────────────────────────

function cleanOldDownloads() {
    try {
        if (!fs.existsSync(DOWNLOAD_DIR)) return;
        const cutoff = Date.now() - DOWNLOAD_CACHE_TTL;
        const cachedPaths = new Set([..._cache.values()].map(e => e.filePath));
        for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
            const fp = path.join(DOWNLOAD_DIR, f);
            try {
                if (!cachedPaths.has(fp) && fs.statSync(fp).mtimeMs < cutoff) {
                    fs.unlinkSync(fp);
                }
            } catch {}
        }
    } catch {}
}
cleanOldDownloads();
setInterval(cleanOldDownloads, 15 * 60 * 1000).unref();

// ── Metadata ──────────────────────────────────────────────────────────────

/**
 * Fetch video metadata without downloading.
 * @returns {{ title, duration, thumbnail, url, filesize, source } | null}
 */
async function getMetadata(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') return null;
    try {
        const info = await getYtdlp().getVideoInfo(videoUrl);
        const mins = Math.floor((info.duration || 0) / 60);
        const secs = String((info.duration || 0) % 60).padStart(2, '0');
        return {
            title: (info.title || 'Unknown').slice(0, 100),
            duration: info.duration_string || `${mins}:${secs}`,
            thumbnail: info.thumbnail || info.thumbnails?.slice(-1)[0]?.url || '',
            url: info.webpage_url || videoUrl,
            filesize: info.filesize || info.filesize_approx || 0,
            source: info.extractor_key || info.extractor || 'Media',
        };
    } catch (err) {
        logger(`[Metadata] ${err.message}`);
        return null;
    }
}

// ── Format selection ──────────────────────────────────────────────────────

function buildFormatArgs(quality, audioOnly) {
    if (audioOnly) {
        return FFMPEG_PATH
            ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
            : ['-f', 'bestaudio[ext=m4a]/bestaudio'];
    }
    switch (quality) {
        case 'hd':
            return FFMPEG_PATH
                ? ['-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]', '--merge-output-format', 'mp4']
                : ['-f', 'best[height<=1080][ext=mp4]/best[height<=1080]'];
        case 'low':
            return ['-f', 'worst[ext=mp4]/worstvideo+worstaudio/worst'];
        default: // sd
            return FFMPEG_PATH
                ? ['-f', 'best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best', '--merge-output-format', 'mp4']
                : ['-f', 'best[height<=720][ext=mp4]/best[height<=720]'];
    }
}

// ── Core download ─────────────────────────────────────────────────────────

/**
 * Download and send media with a quality fallback chain.
 * Shows live progress via message edits.
 * @param {object} sock       - Baileys socket
 * @param {string} from       - Recipient JID
 * @param {string} url        - Media URL
 * @param {string} siteName   - Display name (YouTube, TikTok, …)
 * @param {string} quality    - 'hd' | 'sd' | 'low'
 * @param {boolean} audioOnly - Audio-only mode
 */
async function downloadAndSend(sock, from, url, siteName = 'Media', quality = 'sd', audioOnly = false) {
    if (!url || !url.startsWith('http')) {
        await sock.sendMessage(from, { text: '⚠️ A valid URL is required.' });
        return;
    }

    const cacheKey = _cacheKey(url, quality, audioOnly);
    const cached = _getCached(cacheKey);
    if (cached) {
        logger(`[Download] Cache hit: ${path.basename(cached.filePath)}`);
        const ph = await sock.sendMessage(from, { text: '⚡ Sending from cache...' });
        try {
            await _sendFile(sock, from, cached.filePath, audioOnly, siteName);
            try { await sock.sendMessage(from, { delete: ph.key }); } catch {}
            return;
        } catch {
            _cache.delete(cacheKey);
        }
    }

    // Quality fallback chain
    const chain = audioOnly
        ? ['audio']
        : (quality === 'hd' ? ['hd', 'sd', 'low', 'audio'] : quality === 'low' ? ['low', 'audio'] : ['sd', 'low', 'audio']);

    let ph = await sock.sendMessage(from, { text: `⏳ Preparing ${audioOnly ? 'audio' : quality.toUpperCase()} download from *${siteName}*...` });

    for (let i = 0; i < chain.length; i++) {
        const q = chain[i];
        const isAudio = q === 'audio';
        const label = isAudio ? 'Audio' : q.toUpperCase();

        if (i > 0) {
            try { await sock.sendMessage(from, { edit: ph.key, text: `🔄 Trying fallback: ${label}...` }); } catch {}
        }

        let downloadedFile = null;
        try {
            downloadedFile = await _runDownload(sock, ph, url, isAudio ? 'sd' : q, isAudio);

            // Compress if video is too large
            if (!isAudio && FFMPEG_PATH) {
                const stat = fs.statSync(downloadedFile);
                const sizeMB = stat.size / (1024 * 1024);
                if (sizeMB > 50) {
                    try {
                        await sock.sendMessage(from, { edit: ph.key, text: `⚙️ Compressing ${sizeMB.toFixed(1)}MB for WhatsApp...` });
                    } catch {}
                    downloadedFile = await _compress(downloadedFile);
                }
            }

            const sizeMB = (fs.statSync(downloadedFile).size / (1024 * 1024)).toFixed(1);
            try { await sock.sendMessage(from, { edit: ph.key, text: `✅ Sending *${sizeMB}MB*...` }); } catch {}

            await _sendFile(sock, from, downloadedFile, isAudio, siteName);
            _putCache(cacheKey, downloadedFile);

            // Delete placeholder
            setTimeout(() => { try { sock.sendMessage(from, { delete: ph.key }); } catch {} }, 1500);
            return;

        } catch (err) {
            logger(`[Download] ${label} failed: ${err.message}`);
            _safeDelete(downloadedFile);
            if (i === chain.length - 1) {
                const friendlyErr = handleAPIError(err, 'Download');
                try {
                    await sock.sendMessage(from, {
                        edit: ph.key,
                        text: `❌ All download attempts failed.\n\n*Reason:* ${friendlyErr.message}`
                    });
                } catch {}
            }
        }
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function _runDownload(sock, ph, url, quality, audioOnly) {
    const uid = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const outputTemplate = path.join(DOWNLOAD_DIR, `${uid}.%(ext)s`);

    const formatArgs = buildFormatArgs(quality, audioOnly);
    const args = [
        url,
        ...(FFMPEG_PATH ? ['--ffmpeg-location', FFMPEG_PATH] : []),
        ...formatArgs,
        '--no-playlist', '--no-part', '--quiet', '--no-warnings',
        '--no-check-certificate', '--geo-bypass',
        '--socket-timeout', '60',
        '--newline',
        '-o', outputTemplate,
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        '-R', '2',
    ];

    let lastUpdate = 0;
    const child = spawn(getBinPath(), args, { windowsHide: true });
    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line) => {
        const m = line.match(/\[download\]\s+([\d.]+)%.*?at\s+([\w./]+).*?ETA\s+([\d:]+)/);
        if (m && Date.now() - lastUpdate > 4000) {
            lastUpdate = Date.now();
            sock.sendMessage(from, {
                edit: ph.key,
                text: `📥 *Downloading...*\n📊 ${m[1]}% | ⚡ ${m[2]} | ⏳ ETA ${m[3]}`
            }).catch(() => {});
        }
    });

    await new Promise((resolve, reject) => {
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`)));
        child.on('error', reject);
        setTimeout(() => { child.kill(); reject(new Error('Download timeout (10 min)')); }, 600000);
    });

    // Find the downloaded file
    const exts = ['mp4', 'mp3', 'm4a', 'webm', 'mkv', 'ogg', 'opus'];
    for (const ext of exts) {
        const fp = path.join(DOWNLOAD_DIR, `${uid}.${ext}`);
        if (fs.existsSync(fp)) return fp;
    }
    // Fallback scan
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const match = files.find(f => f.startsWith(uid) && !f.endsWith('.part'));
    if (match) return path.join(DOWNLOAD_DIR, match);
    throw new Error('Downloaded file not found after completion');
}

async function _compress(inputPath) {
    const outputPath = inputPath.replace(/\.\w+$/, '_c.mp4');
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Compression timeout')), 600000);
        fluentFfmpeg(inputPath)
            .videoCodec('libx264')
            .outputOptions(['-crf 28', '-preset veryfast', '-vf scale=-2:480', '-pix_fmt yuv420p'])
            .audioCodec('aac').audioBitrate('96k')
            .output(outputPath)
            .on('end', () => { clearTimeout(timeout); resolve(); })
            .on('error', (err) => { clearTimeout(timeout); reject(err); })
            .run();
    });
    _safeDelete(inputPath);
    return outputPath;
}

async function _sendFile(sock, from, filePath, audioOnly, siteName) {
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    const caption = `🎬 *${siteName}* | ${sizeMB}MB`;

    if (audioOnly || ext === '.mp3' || ext === '.m4a' || ext === '.ogg' || ext === '.opus') {
        const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/ogg; codecs=opus';
        await sock.sendMessage(from, {
            audio: { url: filePath },
            mimetype: mime,
            ptt: false,
        });
    } else if (parseFloat(sizeMB) > 64 || ext === '.webm' || ext === '.mkv') {
        // Send as document for large/unsupported video
        await sock.sendMessage(from, {
            document: { url: filePath },
            mimetype: 'video/mp4',
            fileName: `${siteName}_${Date.now()}${ext}`,
            caption,
        });
    } else {
        await sock.sendMessage(from, {
            video: { url: filePath },
            mimetype: 'video/mp4',
            caption,
        });
    }

    // Auto-delete after send
    setTimeout(() => _safeDelete(filePath), 3000);
}

module.exports = { getMetadata, downloadAndSend };
