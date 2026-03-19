'use strict';

const MAX_LOGS = 300;

const state = {
    socket: null,
    status: 'Disconnected',
    connectedNumber: null,
    connectedAt: null,
    logs: [],
};

const _kv = {};

module.exports = {
    // Generic KV for bot.js
    get: (key) => _kv[key],
    set: (key, val) => { _kv[key] = val; },

    // Named accessors (backwards compat)
    getSocket:      () => state.socket,
    setSocket:      (s) => { state.socket = s; },
    getStatus:      () => state.status,
    setStatus:      (s) => { state.status = s; },
    getNumber:      () => state.connectedNumber,
    setNumber:      (n) => { state.connectedNumber = n; },
    getConnectedAt: () => state.connectedAt,
    setConnectedAt: (t) => { state.connectedAt = t; },
    getLogs:        () => state.logs,
    addLog:         (entry) => {
        state.logs.push(entry);
        if (state.logs.length > MAX_LOGS) state.logs.shift();
    },
};
