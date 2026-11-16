'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { IpRateLimiter } = require('../rateLimit');

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

