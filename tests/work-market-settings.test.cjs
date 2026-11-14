const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-market-settings.js');


const settings = { KR: [{ id: 'k1', name: '코스피', vis: 1, tv: 'KRX:KOSPI' },
  { id: 'k2', name: '수급', vis: 0, inv: 'foreign' }], US: [] };
test('normalizes legacy fields and preserves an explicitly empty market', () => {
  assert.deepEqual(api.normalize(settings, { US: [{ id: 'u1', name: 'Test' }] }), settings);
  assert.equal(api.layout(settings).visibleCards.KR.length, 1);
});
test('switches at 07:00 and 21:00 Seoul time and uses New York local date', () => {
  assert.equal(api.layout(settings, { now: Date.parse('2026-11-13T21:59:00Z') }).primary, 'US');
  assert.equal(api.layout(settings, { now: Date.parse('2026-11-13T22:00:00Z') }).primary, 'KR');
  const view = api.layout(settings, { now: Date.parse('2026-11-14T12:00:00Z'),
    calendar: { KR: { '2026-11-14': 'open' } } });
  assert.deepEqual(view.order, ['US', 'KR']);
  assert.equal(view.tradingDays.KR.status, 'open');
  assert.equal(view.tradingDays.US.status, 'closed');
  assert.equal(api.layout(settings, { now: Date.parse('2026-11-14T01:00:00Z') }).tradingDays.US.localDate, '2026-11-13');
});
test('adds, sorts and deletes without mutating input', () => {
  const added = api.edit(settings, 'US', { type: 'add', card: { id: 'u1', name: 'Test' } });
  const moved = api.edit(added, 'KR', { type: 'move', id: 'k2', to: 0 });
  assert.equal(moved.KR[0].id, 'k2');
  assert.deepEqual(api.edit(moved, 'US', { type: 'remove', id: 'u1' }).US, []);
  assert.equal(settings.KR[0].id, 'k1');
});
