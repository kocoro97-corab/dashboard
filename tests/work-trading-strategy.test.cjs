const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-trading-strategy.js');


function bars(size) {
  return Array.from({ length: size }, (_, i) => {
    const c = 100 + i * 2;
    return { t: 1700000000000 + i * 60000, o: c - 1, h: c + 1, l: c - 2, c,
      volume: i === size - 1 ? 200 : 100, turnover: i === size - 1 ? 2000 : 1000 };
  });
}
test('computes momentum, levels and risk bounded sizing', () => {
  const out = api.analyze({ mode: 'day', interval: '1m', bars: bars(21), capital: 10000, lotSize: 5 });
  assert.equal(out.signal, 'breakout_candidate');
  assert.equal(out.volumeRatio, 2);
  assert.equal(out.turnoverRatio, 2);
  assert.ok(out.plan.stop < out.plan.entry && out.plan.entry < out.plan.target);
  assert.ok(out.plan.estimatedRisk <= 100 && out.plan.allocatedCapital <= 2500);
  assert.equal(out.plan.quantity % 5, 0);
});
test('uses longer swing lookback and flags unavailable liquidity', () => {
  const input = { mode: 'swing', interval: '1d', capital: 10000 };
  assert.equal(api.analyze({ ...input, bars: bars(30) }).status, 'insufficient');
  const daily = bars(31).map((row, i) => ({ ...row, t: 1700000000000 + i * 86400000 }));
  const out = api.analyze({ ...input, bars: daily.map(row => ({ ...row, volume: null })) });
  assert.equal(out.signal, 'watch');
  assert.ok(out.risks.includes('VOLUME_UNAVAILABLE'));
  assert.ok(Math.abs(out.plan.rewardRisk - 2) < 1e-10);
});
test('rejects wrong interval and inconsistent bars', () => {
  const rows = bars(21);
  const input = { mode: 'day', interval: '1m', capital: 10000, bars: rows };
  assert.equal(api.analyze({ ...input, interval: '1d' }).reason, 'INVALID_INPUT');
  rows[20].l = rows[20].h + 1;
  assert.equal(api.analyze(input).reason, 'INVALID_BAR');
});
