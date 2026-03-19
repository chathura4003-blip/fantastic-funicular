'use strict';

/**
 * yt-dlp binary manager.
 * Locates or auto-downloads the yt-dlp binary on startup.
 * Exposes a single shared YTDlpWrap instance.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegStatic = require('ffmpeg-static');
const fluentFfmpeg = require('fluent-ffmpeg');
const { logger } = require('../logger');

const isWin = process.platform === 'win32';
const BIN_NAME = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(__dirname, '..', BIN_NAME);

// Detect and configure ffmpeg path
let FFMPEG_PATH = null;
(function detectFfmpeg() {
    try {
        const found = execSync(isWin ? 'where ffmpeg' : 'which ffmpeg', { stdio: 'pipe', timeout: 3000 })
            .toString().trim().split('\n')[0].trim();
        if (found && fs.existsSync(found)) {
            FFMPEG_PATH = found;
            return;
        }
    } catch {}

    const candidates = isWin ? [] : [
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/nix/store/6h39ipxhzp4r5in5g4rhdjz7p7fkicd0-replit-runtime-path/bin/ffmpeg',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) { FFMPEG_PATH = c; return; }
    }

    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        FFMPEG_PATH = ffmpegStatic;
    }
})();

if (FFMPEG_PATH) {
    fluentFfmpeg.setFfmpegPath(FFMPEG_PATH);
    logger(`[ffmpeg] Using: ${FFMPEG_PATH}`);
} else {
    logger('[ffmpeg] WARNING: ffmpeg not found — video compression disabled');
}

// Download yt-dlp binary if missing
async function ensureYtdlp() {
    if (fs.existsSync(BIN_PATH)) {
        logger('[yt-dlp] Binary ready');
        return true;
    }
    logger('[yt-dlp] Binary missing — downloading...');
    try {
        const url = isWin
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
        execSync(
            isWin
                ? `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${BIN_PATH}'"`
                : `curl -fsSL "${url}" -o "${BIN_PATH}" && chmod a+rx "${BIN_PATH}"`,
            { stdio: 'pipe', timeout: 120000 }
        );
        logger('[yt-dlp] Downloaded successfully');
        return true;
    } catch (err) {
        logger(`[yt-dlp] Download failed: ${err.message}`);
        return false;
    }
}

// Shared YTDlpWrap instance (created after binary check)
let _ytdlp = null;
function getYtdlp() {
    if (!_ytdlp) _ytdlp = new YTDlpWrap(BIN_PATH);
    return _ytdlp;
}

module.exports = { ensureYtdlp, getYtdlp, FFMPEG_PATH, fluentFfmpeg, BIN_PATH };
