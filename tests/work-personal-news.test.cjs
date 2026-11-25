const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-personal-news.js');


const holdings = [{ market: 'KR', symbol: '123456', name: '가상전자' },
  { market: 'US', symbol: 'FAKE', name: 'Fiction Corp' }];

test('queries are bounded, deduplicated, and quote the tracked name', () => {
  assert.deepEqual(api.buildQueries(holdings, holdings).map(x => x.query),
    ['"가상전자" when:2d', '"Fiction Corp" FAKE when:2d']);
});

test('existing news input retains provenance and links related domestic or overseas themes', async () => {
  const d = new Date(1700000000000);
  const first = { t: '가상전자 반도체', l: 'https://example.com/a', s: 'Synthetic', d };
  const next = { t: 'Fiction Corp ($FAKE) software', l: 'https://example.com/b', s: 'Synthetic', d };
  const rows = await api.readExisting({ news: async () => [first, { ...first, l: first.l + '#dup' },
    next, { ...first, l: 'javascript:alert(1)' }] }, { provenance: 'synthetic' });
  const result = api.classify({ holdings, articles: [...rows, first, { ...first, provenance: 'live' }],
    themes: [{ market: 'KR', id: 'chip', terms: ['반도체'] }, { market: 'US', id: 'tech', terms: ['software'] }] });
  assert.equal(result.news.length, 3);
  assert.deepEqual(result.themes.map(x => x.symbols), [['KR:123456'], ['US:FAKE'], ['KR:123456']]);
  assert.equal(result.news[0].publishedAt, d.getTime());
  assert.equal(result.news[1].matches[0].score, 3);
});

test('preserves unavailable feeds', async () => {
  assert.equal(await api.readExisting({ news: async () => null }, { provenance: 'live' }), null);
  assert.equal(await api.readExisting({ news: async () => { throw new Error('unavailable'); } }, { provenance: 'live' }), null);
});
