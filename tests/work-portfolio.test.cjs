const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-portfolio.js');


const domestic = { market: 'domestic', code: '123456', accountKey: 'synthetic-a', currency: 'KRW',
  quantity: 2, currentPrice: 110, avgPrice: 100, assetClass: 'equity' };
const overseas = { market: 'overseas', code: 'TEST', instrumentId: 'US:XNAS:TEST', accountKey: 'synthetic-b',
  country: 'US', currency: 'USD', quantity: 1, currentPrice: 5, avgPrice: 4, evalAmount: 6000, profit: -1000,
  assetClass: 'equity' };
test('combines NH KRW values without converting overseas P/L twice', () => {
  const out = api.analyze({ holdings: [domestic, overseas], fxToKrw: { USD: 1300 } });
  assert.equal(out.summary.valueKrw, 6220);
  assert.equal(out.summary.profitKrw, -980);
  assert.equal(out.accounts[0].returnPct, 10);
  assert.equal(out.byCurrency.length, 2);
  assert.equal(out.risk.concentrated[0].key, overseas.instrumentId);
});
test('handles unknown FX and does not reconstruct overseas cost with current FX', () => {
  const row = { ...overseas, evalAmount: null, profit: null };
  const out = api.analyze({ holdings: [row], fxToKrw: { USD: 1300 } });
  assert.equal(out.summary.valueKrw, 6500);
  assert.equal(out.summary.profitKrw, null);
  assert.equal(api.analyze({ holdings: [row] }).summary.valueKrw, null);
  assert.equal(api.analyze({ holdings: [{ ...domestic, currentPrice: 0 }] }).summary.valueKrw, null);
});
test('suppresses portfolio weights on partial fetch and flags unknown identity', () => {
  const out = api.analyze({ holdings: [{ ...overseas, instrumentId: null }], partial: true });
  assert.equal(out.status, 'partial');
  assert.equal(out.byCountry[0].weight, null);
  assert.equal(out.risk.unknownExposure, true);
});
