'use strict';

/**
 * Web dashboard — Express server with admin panel.
 * Authentication via basic credentials (env vars: ADMIN_USER, ADMIN_PASS).
 * Routes:
 *  GET /        → admin panel HTML
 *  GET /api/status → bot status JSON
 *  GET /api/qr  → current QR code data
 *  GET /api/logs → recent log lines
 *  POST /api/restart → restart bot connection
 *  POST /api/logout  → clear session and reconnect
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const state = require('./state');
const { clearSession } = require('./session-manager');
const { logger, getLogs } = require('./logger');
const { ADMIN_USER, ADMIN_PASS, DASHBOARD_PORT } = require('./config');

function createDashboard(getSock) {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // ── Basic auth middleware ──────────────────────────────────────────────
    function requireAuth(req, res, next) {
        const authHeader = req.headers.authorization || '';
        const b64 = authHeader.startsWith('Basic ') ? authHeader.slice(6) : '';
        if (!b64) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Bot Admin"');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
        if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        next();
    }

    // ── Status ────────────────────────────────────────────────────────────
    app.get('/api/status', requireAuth, (req, res) => {
        const sock = getSock?.();
        res.json({
            connected: state.get('connected') ?? false,
            uptime: Math.floor(process.uptime()),
            user: sock?.user?.id || null,
            memory: `${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`,
        });
    });

    // ── QR ────────────────────────────────────────────────────────────────
    app.get('/api/qr', requireAuth, (req, res) => {
        const qr = state.get('qr');
        res.json({ qr: qr || null, connected: state.get('connected') ?? false });
    });

    // ── Logs ──────────────────────────────────────────────────────────────
    app.get('/api/logs', requireAuth, (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        res.json({ logs: (getLogs?.() || []).slice(-limit) });
    });

    // ── Restart ───────────────────────────────────────────────────────────
    app.post('/api/restart', requireAuth, (req, res) => {
        res.json({ ok: true, message: 'Restarting…' });
        logger('[Dashboard] Restart requested via web panel.');
        setTimeout(() => process.exit(0), 1500);
    });

    // ── Logout ────────────────────────────────────────────────────────────
    app.post('/api/logout', requireAuth, (req, res) => {
        clearSession();
        res.json({ ok: true, message: 'Session cleared. Reconnecting…' });
        logger('[Dashboard] Logout requested via web panel.');
        setTimeout(() => process.exit(0), 1500);
    });

    // ── HTML panel ────────────────────────────────────────────────────────
    app.get('/', (req, res) => {
        const htmlPath = path.join(__dirname, 'public', 'admin.html');
        if (fs.existsSync(htmlPath)) {
            res.sendFile(htmlPath);
        } else {
            res.send('<h1>Bot Admin Panel</h1><p>public/admin.html not found.</p>');
        }
    });

    return app;
}

function startDashboard(getSock) {
    const app = createDashboard(getSock);
    const port = DASHBOARD_PORT;
    app.listen(port, () => {
        logger(`[Dashboard] Running on http://0.0.0.0:${port}`);
    });
    return app;
}

module.exports = { startDashboard };
