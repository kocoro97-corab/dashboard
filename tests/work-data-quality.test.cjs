const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-data-quality.js');


const base = { p: 102, prev: 100, source: 'N', currency: 'KRW', unit: 'price', delivery: 'realtime',
  observedAt: 1000, receivedAt: 1100 };
const policy = { now: 1200, staleAfterMs: 500, expectedCurrency: 'KRW', expectedUnit: 'price' };
test('reports live, delayed, stale and unknown timestamps', () => {
  assert.equal(api.inspect(base, policy).status, 'realtime');
  assert.equal(api.inspect({ ...base, delivery: 'delayed' }, policy).status, 'delayed');
  assert.equal(api.inspect(base, { ...policy, now: 1500 }).status, 'stale');
  assert.equal(api.inspect({ ...base, observedAt: null }, policy).status, 'unconfirmed');
});
test('detects provider failure, currency or unit mismatch, and price anomalies', () => {
  const out = api.inspect({ ...base, p: 1000, currency: 'USD', unit: 'percent', apiError: true }, policy);
  assert.equal(out.usable, false);
  for (const code of ['API_ERROR', 'CURRENCY_MISMATCH', 'UNIT_MISMATCH', 'CHANGE_OUTLIER']) assert.ok(out.issues.includes(code));
});
test('keeps missing values null and detects timestamp ordering and inconsistent percent', () => {
  assert.equal(api.inspect({ ...base, p: null }, policy).changePct, null);
  const out = api.inspect({ ...base, changePct: 3, observedAt: 1150 }, policy);
  assert.ok(out.issues.includes('CHANGE_MISMATCH'));
  assert.ok(out.issues.includes('TIMESTAMP_ORDER'));
});
