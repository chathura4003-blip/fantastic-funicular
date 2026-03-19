'use strict';

/**
 * Sliding-window rate limiter.
 * Tracks request timestamps per (jid, action) pair.
 */
class RateLimiter {
    constructor() {
        this.limits = new Map();
        this._cleanup = setInterval(() => this._sweep(), 120000);
        this._cleanup.unref();
    }

    /**
     * @param {string} jid
     * @param {string} action
     * @param {number} maxPerMinute
     * @returns {{ allowed: boolean, resetIn: number }}
     */
    check(jid, action, maxPerMinute = 3) {
        if (!jid || !action) return { allowed: false, resetIn: 0 };

        const key = `${jid}:${action}`;
        const now = Date.now();
        const windowStart = now - 60000;

        if (!this.limits.has(key)) {
            this.limits.set(key, []);
        }

        const timestamps = this.limits.get(key).filter(t => t > windowStart);
        this.limits.set(key, timestamps);

        if (timestamps.length >= maxPerMinute) {
            const resetIn = Math.ceil((timestamps[0] + 60000 - now) / 1000);
            return { allowed: false, resetIn };
        }

        timestamps.push(now);
        return { allowed: true, resetIn: 0 };
    }

    _sweep() {
        const cutoff = Date.now() - 120000;
        for (const [key, ts] of this.limits.entries()) {
            if (!ts.length || ts[ts.length - 1] < cutoff) {
                this.limits.delete(key);
            }
        }
    }

    destroy() {
        clearInterval(this._cleanup);
        this.limits.clear();
    }
}

module.exports = new RateLimiter();
