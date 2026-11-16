'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeIp, uniqueIps, summarizeCountries } = require('../geo');

test('normalizeIp strips ports, brackets and IPv6 zones', () => {
  assert.equal(normalizeIp('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeIp('8.8.8.8:443'), '8.8.8.8');
  assert.equal(normalizeIp('[2001:4860:4860::8888]:443'), '2001:4860:4860::8888');
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
  assert.equal(normalizeIp('::1'), '127.0.0.1');
  assert.equal(normalizeIp('not-an-ip'), '');
  assert.equal(normalizeIp(''), '');
});

test('uniqueIps accepts lists, object maps and record objects', () => {
  assert.deepEqual(uniqueIps(['8.8.8.8', '8.8.8.8', '1.1.1.1']).sort(), ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(uniqueIps({ '8.8.8.8': 3, '1.1.1.1': 1 }).sort(), ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(uniqueIps([{ ip: '8.8.8.8' }, { ip: '1.1.1.1' }]).sort(), [
    '1.1.1.1',
    '8.8.8.8',
  ]);
  assert.deepEqual(uniqueIps('8.8.8.8, 1.1.1.1').sort(), ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(uniqueIps('["8.8.8.8"]'), ['8.8.8.8']);
  assert.deepEqual(uniqueIps(null), []);
});

test('summarizeCountries returns counts only, never addresses', () => {
  const summary = summarizeCountries(['8.8.8.8', '1.1.1.1', '8.8.8.8', '1.2.3.4:443']);
  assert.equal(summary.connections, 3);
  assert.equal(
    summary.countries.reduce((total, country) => total + country.count, 0),
    summary.connections,
  );
  assert.ok(summary.countries.every((c) => typeof c.code === 'string' && c.code.length === 2));
  assert.ok(summary.countries.every((c) => typeof c.name === 'string' && c.name.length > 0));
  assert.ok(
    summary.countries.every((c) => !/\d{1,3}\.\d{1,3}\.\d{1,3}/.test(c.name)),
    'no IP-shaped names',
  );
  assert.deepEqual(
    Object.keys(summary).sort(),
    ['connections', 'countries'],
    'no raw IP field',
  );
});

test('private and unknown addresses fall into a single unknown bucket', () => {
  const summary = summarizeCountries(['10.0.0.1', '192.168.1.1', '2001:db8::1']);
  assert.equal(summary.connections, 3);
  assert.equal(summary.countries.length, 1);
  assert.equal(summary.countries[0].code, 'XX');
});
