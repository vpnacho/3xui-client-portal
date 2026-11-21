'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { IpRateLimiter, createLimiter } = require('../rateLimit');

test('allows 12 requests per minute per IP, then throttles', () => {
  const limiter = new IpRateLimiter({ windowMs: 60_000, maxRequests: 12 });

  for (let i = 0; i < 12; i += 1) {
    assert.equal(limiter.check('1.2.3.4').allowed, true, `request ${i + 1}`);
  }

  const blocked = limiter.check('1.2.3.4');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
  assert.equal(limiter.check('5.6.7.8').allowed, true, 'other IPs are independent');
});

test('the window slides: hits expire after windowMs', () => {
  const limiter = new IpRateLimiter({ windowMs: 50, maxRequests: 2 });
  assert.equal(limiter.check('9.9.9.9').allowed, true);
  assert.equal(limiter.check('9.9.9.9').allowed, true);
  assert.equal(limiter.check('9.9.9.9').allowed, false);

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(limiter.check('9.9.9.9').allowed, true);
      resolve();
    }, 80);
  });
});

test('more than 5 consecutive failures block the IP for 15 minutes', () => {
  const limiter = new IpRateLimiter({ maxRequests: 1000, failureThreshold: 5, blockMs: 60_000 });

  for (let i = 0; i < 5; i += 1) {
    limiter.check('7.7.7.7');
    limiter.record('7.7.7.7', 404);
  }
  assert.equal(limiter.check('7.7.7.7').allowed, true, 'five failures do not block yet');

  limiter.record('7.7.7.7', 404);
  assert.equal(limiter.check('7.7.7.7').allowed, false, 'sixth consecutive failure blocks');
  assert.ok(limiter.check('7.7.7.7').retryAfter > 0);
});

test('a successful response resets the failure streak', () => {
  const limiter = new IpRateLimiter({ maxRequests: 1000, failureThreshold: 5, blockMs: 60_000 });

  for (let i = 0; i < 5; i += 1) {
    limiter.check('4.4.4.4');
    limiter.record('4.4.4.4', 404);
  }
  limiter.record('4.4.4.4', 200);

  for (let i = 0; i < 5; i += 1) {
    limiter.check('4.4.4.4');
    limiter.record('4.4.4.4', 404);
  }
  assert.equal(limiter.check('4.4.4.4').allowed, true);
});

test('a 429 response is not counted as a failed token guess', () => {
  const limiter = new IpRateLimiter({ maxRequests: 1000, failureThreshold: 5, blockMs: 60_000 });

  for (let i = 0; i < 20; i += 1) {
    limiter.check('6.6.6.6');
    limiter.record('6.6.6.6', 429);
  }
  assert.equal(limiter.check('6.6.6.6').allowed, true);
});

test('the default block duration is 15 minutes', () => {
  const limiter = new IpRateLimiter();
  limiter.check('3.3.3.3');
  for (let i = 0; i < 6; i += 1) limiter.record('3.3.3.3', 404);
  const verdict = limiter.check('3.3.3.3');
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.retryAfter >= 895 && verdict.retryAfter <= 900, String(verdict.retryAfter));
});

test('the entry map is capped so spoofed IPs cannot exhaust memory', () => {
  const limiter = new IpRateLimiter({ maxEntries: 100, maxRequests: 1000 });
  for (let i = 0; i < 500; i += 1) limiter.check(`10.0.${Math.floor(i / 255)}.${i % 255}`);
  assert.ok(limiter.entries.size <= 100, `size ${limiter.entries.size}`);
});

test('a block outlives the request window', () => {
  // maxRequests is high so only the failure breaker can trigger.
  const limiter = new IpRateLimiter({ maxRequests: 1000, failureThreshold: 5, blockMs: 60_000 });
  for (let i = 0; i < 6; i += 1) {
    limiter.check('2.2.2.2');
    limiter.record('2.2.2.2', 404);
  }

  // Even after the sliding window would have drained, the block stands.
  const verdict = limiter.check('2.2.2.2');
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.retryAfter >= 55, `retryAfter ${verdict.retryAfter}`);
});

/* -------------------------------------------------------------------------- */
/* Proxy-awareness tests (new)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build a minimal fake Express `req` object for testing the middleware directly.
 * `ip` is what Express would set after applying `trust proxy`.
 */
function fakeReq({ ip, path = '/api/client/tok', headers = {} } = {}) {
  return {
    ip,
    path,
    headers,
    socket: { remoteAddress: ip },
  };
}

/**
 * Build a minimal fake Express `res` object that captures status, headers, and
 * body so we can inspect the 429 response without a real HTTP server.
 */
function fakeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
    _listeners: {},
    set(key, value) { this._headers[key.toLowerCase()] = value; return this; },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    type() { return this; },
    send(body) { this._body = body; return this; },
    on(event, cb) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(cb);
      return this;
    },
    emit(event) {
      (this._listeners[event] || []).forEach((cb) => cb());
    },
  };
  return res;
}

test('behind a trusted proxy two different client IPs are tracked independently', () => {
  // `maxRequests: 2` so blocking happens quickly in the test.
  const mw = createLimiter({ windowMs: 60_000, maxRequests: 2, failureThreshold: 100 });

  const ipA = '203.0.113.10';
  const ipB = '203.0.113.20';

  // Exhaust ipA's quota.
  for (let i = 0; i < 2; i += 1) {
    const res = fakeRes();
    mw(fakeReq({ ip: ipA }), res, () => {});
  }

  const resA = fakeRes();
  mw(fakeReq({ ip: ipA }), resA, () => {});
  assert.equal(resA._status, 429, 'ipA should be rate-limited after 2 requests');

  // ipB is independent and still has budget.
  const resB = fakeRes();
  let bPassed = false;
  mw(fakeReq({ ip: ipB }), resB, () => { bPassed = true; });
  assert.equal(bPassed, true, 'ipB must pass through unaffected');
  assert.equal(resB._status, null, 'ipB must not receive 429');
});

test('spoofed X-Forwarded-For on an untrusted direct connection is ignored', () => {
  /**
   * When trust proxy is NOT set (or is 0), `req.ip` will be the raw socket
   * address — the middleware must NOT look at `X-Forwarded-For` headers for
   * rate-limiting keying. The IpRateLimiter always receives `req.ip`, which
   * Express already resolved to the real source when `trust proxy` is 0.
   *
   * We simulate this by passing `req.ip` as the direct-connection socket IP
   * and including a spoofed `X-Forwarded-For` header; the middleware must
   * key on `req.ip` only, not on the header value.
   */
  const mw = createLimiter({ windowMs: 60_000, maxRequests: 2, failureThreshold: 100 });

  const realIp = '198.51.100.5';          // attacker's real IP
  const spoofedIp = '127.0.0.1';          // attacker tries to look like localhost

  // The two requests that exhaust realIp's budget.
  for (let i = 0; i < 2; i += 1) {
    mw(
      fakeReq({ ip: realIp, headers: { 'x-forwarded-for': spoofedIp } }),
      fakeRes(),
      () => {},
    );
  }

  // The third request from realIp is blocked despite the spoofed header.
  const res = fakeRes();
  mw(
    fakeReq({ ip: realIp, headers: { 'x-forwarded-for': spoofedIp } }),
    res,
    () => {},
  );
  assert.equal(res._status, 429, 'real IP must be blocked regardless of spoofed header');

  // The spoofed IP itself should not be blocked.
  const resSpoofed = fakeRes();
  let spoofedPassed = false;
  mw(fakeReq({ ip: spoofedIp }), resSpoofed, () => { spoofedPassed = true; });
  assert.equal(spoofedPassed, true, 'spoofed IP address must not inherit the block');
});

test('429 response always includes Retry-After header and JSON retryAfter field', (_, done) => {
  /**
   * Spin up a real Express app wired with the limiter so we can assert over a
   * real HTTP response (headers + body), which is the scenario npmplus sees.
   */
  const express = require('express');
  const appTest = express();
  appTest.set('trust proxy', 1);

  const mw = createLimiter({ windowMs: 60_000, maxRequests: 1, failureThreshold: 100 });
  appTest.get('/api/test', mw, (req, res) => res.json({ ok: true }));

  const srv = appTest.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();

    function req() {
      return new Promise((resolve, reject) => {
        const r = http.request(
          { host: '127.0.0.1', port, path: '/api/test', method: 'GET' },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              }),
            );
          },
        );
        r.on('error', reject);
        r.end();
      });
    }

    // First request is allowed.
    req()
      .then((r1) => {
        assert.equal(r1.status, 200, 'first request must be allowed');
        // Second request must be throttled with proper headers.
        return req();
      })
      .then((r2) => {
        assert.equal(r2.status, 429, '429 expected');
        assert.ok(
          r2.headers['retry-after'] !== undefined,
          'Retry-After header must be present',
        );
        const retryAfterSec = Number(r2.headers['retry-after']);
        assert.ok(
          Number.isFinite(retryAfterSec) && retryAfterSec > 0,
          `Retry-After must be a positive number, got ${r2.headers['retry-after']}`,
        );
        assert.ok(
          typeof r2.body.retryAfter === 'number' && r2.body.retryAfter > 0,
          'JSON body must include a positive retryAfter field',
        );
        srv.close(done);
      })
      .catch((err) => {
        srv.close(() => done(err));
      });
  });
});

