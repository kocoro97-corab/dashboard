const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../js/market-data-v2.js');

test('reads KOSPI from the existing Naver route and applies signed changes', async () => {
  const market = create({ readText: async url => {
    assert.equal(url, 'https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI');
    return JSON.stringify({ datas: [{ closePrice: '1,234.50', fluctuations: '3.50', fluctuationsType: { code: '5' } }] });
  } });
  assert.deepEqual(await market.index('^KS11'), { p: 1234.5, prev: 1238, source: 'N' });
});

test('falls back to Yahoo after Naver returns an unrelated index', async () => {
  const urls = [];
  const market = create({ readText: async url => {
    urls.push(url);
    return JSON.stringify(url.includes('naver') ? { datas: [{ reutersCode: '.DJI', closePrice: '999' }] } :
      { chart: { result: [{ meta: { symbol: '^GSPC', regularMarketPrice: 100, chartPreviousClose: 99 } }] } });
  } });
  assert.deepEqual(await market.index('^GSPC'), { p: 100, prev: 99, source: 'Y' });
  assert.deepEqual(urls, [
    'https://stock.naver.com/api/polling/worldstock/index?reutersCodes=.INX',
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d'
  ]);
});

test('checks domestic stock identity and preserves missing previous closes', async () => {
  const market = create({ readText: async () => JSON.stringify({ datas: [
    { itemCode: '000660', closePrice: '999' }, { itemCode: '005930', closePrice: '10,000' }
  ] }) });
  assert.deepEqual(await market.quote('005930'), { p: 10000, prev: null, source: 'N' });
  assert.equal(await market.quote('123456'), null);
});

test('rejects invalid requests without transport calls', async () => {
  let calls = 0;
  const market = create({ readText: async () => { calls++; } });
  assert.equal(await market.index('^GSPC?token=secret'), null);
  assert.equal(await market.quote('https://example.org/'), null);
  assert.equal(await market.news('custom query'), null);
  assert.equal(calls, 0);
});

test('reports malformed, mismatched or failed provider responses as unavailable', async () => {
  const responses = [
    '<html>', '{"success":false,"closePrice":100}',
    '{"chart":{"result":[{"meta":{"symbol":"MSFT","regularMarketPrice":5}}]}}',
    '{"chart":{"result":[{"meta":{"symbol":"AAPL","regularMarketPrice":"12 USD"}}]}}'
  ];
  const market = create({ readText: async () => {
    if (!responses.length) throw new Error('transport failure');
    return responses.shift();
  } });
  assert.equal(await market.index('^KQ11'), null);
  assert.equal(await market.quote('AAPL'), null);
  assert.equal(await market.quote('AAPL'), null);
  assert.equal(await market.quote('AAPL'), null);
});

function rss(entries) {
  return {
    documentElement: { localName: 'rss' },
    querySelector: name => name === 'rss > channel' ? {
      querySelectorAll: () => entries.map(entry => ({ querySelector: field => ({ textContent: entry[field] }) }))
    } : null
  };
}

test('reads fixed news feeds and filters unsafe links, invalid dates and duplicates', async () => {
  const older = { title: 'Older', link: 'https://news.google.com/rss/articles/1', pubDate: '2025-11-12', source: 'Source' };
  const newer = { ...older, title: 'Newer', link: 'https://news.google.com/rss/articles/2', pubDate: '2025-11-13' };
  let observedUrl;
  const market = create({ readText: async url => { observedUrl = url; return '<rss/>'; },
    parseXml: () => rss([older, newer, newer, { ...newer, link: 'javascript:alert(1)' },
      { ...newer, link: 'https://user:pw@news.google.com/' },
      { ...newer, link: 'https://example.org/', pubDate: 'invalid' }]) });
  assert.deepEqual(await market.news('market'), [newer, older].map(a => ({ t: a.title, l: a.link, s: a.source, d: new Date(a.pubDate) })));
  const url = new URL(observedUrl);
  assert.equal(url.origin + url.pathname, 'https://news.google.com/rss/search');
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: '코스피 OR 증시 OR 나스닥 when:2d', hl: 'ko', gl: 'KR', ceid: 'KR:ko' });
});

test('distinguishes empty RSS from parser failure', async () => {
  const readText = async () => '<rss/>';
  const empty = create({ readText, parseXml: () => rss([]) });
  const invalid = create({ readText, parseXml: () => ({ ...rss([]), querySelector: () => ({}) }) });
  assert.deepEqual(await empty.news('holdings'), []);
  assert.equal(await invalid.news('holdings'), null);
});
