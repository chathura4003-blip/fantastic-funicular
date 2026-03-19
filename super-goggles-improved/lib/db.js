'use strict';

/**
 * Lightweight JSON file database with in-memory write buffering.
 * Writes are coalesced and flushed asynchronously to minimize I/O.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db.json');
const FLUSH_DELAY_MS = 500;

let cache = null;
let dirty = false;
let flushTimer = null;

function _load() {
    if (cache) return cache;
    if (!fs.existsSync(DB_PATH)) {
        cache = { users: {}, groups: {}, settings: {} };
        return cache;
    }
    try {
        cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        if (typeof cache !== 'object' || !cache) throw new Error('Bad format');
    } catch {
        cache = { users: {}, groups: {}, settings: {} };
    }
    return cache;
}

function _flush() {
    if (!dirty) return;
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
        dirty = false;
    } catch {}
}

function _scheduledFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        _flush();
    }, FLUSH_DELAY_MS);
}

const db = {
    get: (key, id) => {
        const d = _load();
        return d[key]?.[id] ?? null;
    },
    set: (key, id, data) => {
        const d = _load();
        d[key] = d[key] || {};
        d[key][id] = data;
        _scheduledFlush();
    },
    update: (key, id, data) => {
        const d = _load();
        d[key] = d[key] || {};
        d[key][id] = { ...(d[key][id] || {}), ...data };
        _scheduledFlush();
    },
    delete: (key, id) => {
        const d = _load();
        if (d[key]) {
            delete d[key][id];
            _scheduledFlush();
        }
    },
    getAll: (key) => {
        const d = _load();
        return d[key] ? { ...d[key] } : {};
    },
    getSetting: (key) => _load().settings[key] ?? null,
    setSetting: (key, val) => {
        _load().settings[key] = val;
        _scheduledFlush();
    },
    flush: _flush,
};

module.exports = db;
