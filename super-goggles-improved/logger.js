'use strict';

const state = require('./state');

let _io = null;

function setIO(io) { _io = io; }

function logger(msg) {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const entry = `[${time}] ${msg}`;
    console.log(entry);
    state.addLog(entry);
    if (_io) {
        try { _io.emit('log', entry); } catch {}
    }
}

function getLogs() {
    return state.getLogs();
}

module.exports = { logger, setIO, getLogs };
