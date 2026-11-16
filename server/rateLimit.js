'use strict';

/**
 * In-memory anti-brute-force guard for the public subscription routes.
 *
 * Two independent limits per client IP:
 *   1. a sliding window cap (12 requests per minute by default) so tokens
 *      cannot be enumerated quickly;
 *   2. a consecutive-failure circuit breaker: more than 5 failed (404/4xx)
 *      responses in a row block the IP for 15 minutes.
 *
 * State lives in this process only. Behind multiple replicas each replica keeps
 * its own counters, which still makes enumeration impractical.
 */

const DEFAULTS = {
  windowMs: 60_000,
  maxRequests: 12,
  failureThreshold: 5,
  blockMs: 15 * 60_000,
  maxEntries: 20_000,
};

class IpRateLimiter {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.entries = new Map();
    this.sweeper = setInterval(() => this.sweep(), Math.max(60_000, this.options.windowMs));
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
  }

  #entry(ip) {
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= this.options.maxEntries) this.evict();
      entry = { hits: [], failures: 0, blockedUntil: 0, touched: Date.now() };
      this.entries.set(ip, entry);
    }
    entry.touched = Date.now();
    return entry;
  }

  /**
   * Hard cap: a spoofed `X-Forwarded-For` can mint an IP per request, so the
   * map is trimmed to 75% of `maxEntries` instead of growing without bound.
   */
  evict() {
    this.sweep(true);
    if (this.entries.size < this.options.maxEntries) return;

    const target = Math.floor(this.options.maxEntries * 0.75);
    const sorted = [...this.entries.entries()].sort(
      (a, b) => (a[1].touched || 0) - (b[1].touched || 0),
    );
    for (const [ip] of sorted) {
      if (this.entries.size <= target) break;
      this.entries.delete(ip);
    }
  }

  /** @returns {{ allowed: boolean, retryAfter: number }} */
  check(ip) {
    const now = Date.now();
    const entry = this.#entry(ip);

    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (entry.blockedUntil) {
      // A finished block starts from a clean slate.
      entry.blockedUntil = 0;
      entry.failures = 0;
      entry.hits = [];
    }

    entry.hits = entry.hits.filter((stamp) => now - stamp < this.options.windowMs);
    if (entry.hits.length >= this.options.maxRequests) {
      const oldest = entry.hits[0] ?? now;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((oldest + this.options.windowMs - now) / 1000)),
      };
    }

    entry.hits.push(now);
    return { allowed: true, retryAfter: 0 };
  }

  /** Feed the upstream response status back into the failure counter. */
  record(ip, statusCode) {
    const entry = this.entries.get(ip);
    if (!entry) return;

    // 429 means "the limiter spoke", not "the caller guessed a token wrong".
    if (statusCode === 429) return;
    if (statusCode < 400) {
      entry.failures = 0;
      return;
    }

    entry.failures += 1;
    if (entry.failures > this.options.failureThreshold) {
      entry.blockedUntil = Date.now() + this.options.blockMs;
      entry.failures = 0;
      entry.hits = [];
    }
  }

  sweep(force = false) {
    const now = Date.now();
    const idleLimit = Math.max(this.options.blockMs, this.options.windowMs) * 2;
    for (const [ip, entry] of this.entries) {
      const idle = now - (entry.touched || 0) > idleLimit;
      const drained = entry.blockedUntil === 0 && entry.hits.length === 0;
      if (idle && (drained || force)) this.entries.delete(ip);
    }
  }

  reset() {
    this.entries.clear();
  }
}

/**
 * Express middleware factory. Client IPs come from `req.ip`, so configure
 * `app.set('trust proxy', ...)` before mounting this.
 */
function createLimiter(options = {}) {
  const { skip, ...limiterOptions } = options;
  const limiter = new IpRateLimiter(limiterOptions);

  const middleware = (req, res, next) => {
    // `skip` marks requests that never touch the panel (serving the SPA). They
    // consume no budget and are not blocked, so a throttled user still sees the
    // page and a readable error instead of a bare 429.
    if (typeof skip === 'function' && skip(req)) return next();

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const verdict = limiter.check(ip);

    if (!verdict.allowed) {
      res.set('Retry-After', String(verdict.retryAfter));
      res.set('Cache-Control', 'no-store');
      if (req.path.startsWith('/api/')) {
        return res
          .status(429)
          .json({ error: 'Too many requests', retryAfter: verdict.retryAfter });
      }
      return res.status(429).type('text/plain; charset=utf-8').send('Too many requests');
    }

    res.on('finish', () => limiter.record(ip, res.statusCode));
    return next();
  };

  middleware.limiter = limiter;
  return middleware;
}

module.exports = { IpRateLimiter, createLimiter };
