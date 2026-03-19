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

// Global binary path variable
let BIN_PATH = null;

async function ensureYtdlp() {
    // 1. Check if we already have it in the bot's root directory
    const localDir = path.join(__dirname, '..');
    const localPath = path.join(localDir, BIN_NAME);
    
    if (fs.existsSync(localPath)) {
        BIN_PATH = localPath;
        if (!isWin) {
            try { 
                fs.chmodSync(BIN_PATH, 0o755); 
                logger(`[yt-dlp] Permissions set for ${BIN_PATH}`);
            } catch (e) {
                logger(`[yt-dlp] Error setting permissions: ${e.message}`);
            }
        }
        logger(`[yt-dlp] Using local bundled binary: ${BIN_PATH}`);
        return true;
    }

    // 2. Check if already in system PATH
    try {
        const sysPath = execSync(isWin ? 'where yt-dlp' : 'which yt-dlp', { stdio: 'pipe' }).toString().trim().split('\n')[0].trim();
        if (sysPath && fs.existsSync(sysPath)) {
            BIN_PATH = sysPath;
            logger(`[yt-dlp] Using system binary: ${BIN_PATH}`);
            return true;
        }
    } catch {}

    // 3. Check /tmp (common fallback for ephemeral environments)
    if (!isWin) {
        const tmpPath = path.join('/tmp', BIN_NAME);
        if (fs.existsSync(tmpPath)) {
            BIN_PATH = tmpPath;
            try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
            logger(`[yt-dlp] Using existing /tmp binary: ${BIN_PATH}`);
            return true;
        }
        // Fallback to /tmp if it will be downloading
        BIN_PATH = tmpPath;
    } else {
        // For windows if local missing, still use local path for download
        BIN_PATH = localPath;
    }

    // 4. Download if still missing
    logger('[yt-dlp] Binary missing — downloading...');
    try {
        const url = isWin
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
        
        execSync(
            isWin
                ? `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${BIN_PATH}'"`
                : `curl -fsSL "${url}" -o "${BIN_PATH}" && chmod a+rx "${BIN_PATH}"`,
            { stdio: 'pipe', timeout: 300000 } // Increased timeout to 5 mins
        );
        
        if (fs.existsSync(BIN_PATH)) {
            logger(`[yt-dlp] Downloaded successfully to ${BIN_PATH}`);
            return true;
        } else {
            throw new Error('File not found after download');
        }
    } catch (err) {
        logger(`[yt-dlp] Download failed: ${err.message}`);
        return false;
    }
}

// Shared YTDlpWrap instance (created after binary check)
let _ytdlp = null;
function getYtdlp() {
    if (!_ytdlp) {
        if (!BIN_PATH) {
            // Default placeholder if not initialized
            const isWin = process.platform === 'win32';
            BIN_PATH = isWin ? path.join(__dirname, '..', 'yt-dlp.exe') : path.join('/tmp', 'yt-dlp');
        }
        logger(`[yt-dlp] Initializing YTDlpWrap with path: ${BIN_PATH}`);
        _ytdlp = new YTDlpWrap(BIN_PATH);
    }
    return _ytdlp;
}

module.exports = { ensureYtdlp, getYtdlp, FFMPEG_PATH, fluentFfmpeg, getBinPath: () => BIN_PATH };

