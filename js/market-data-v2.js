/* Public market reads through the existing getTxt transport. */
(function (root) {
  'use strict';

  const domestic = new Map([['^KS11', 'KOSPI'], ['^KQ11', 'KOSDAQ']]);
  const global = new Map([
    ['^GSPC', '.INX'], ['^IXIC', '.IXIC'], ['^DJI', '.DJI'],
    ['^SOX', '.SOX'], ['^VIX', '.VIX']
  ]);
  const newsQueries = new Map([
    ['market', '코스피 OR 증시 OR 나스닥 when:2d'],
    ['holdings', '(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d']
  ]);

  function numeric(value) {
    if (typeof value === 'string' && /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) {
      value = Number(value.replace(/,/g, ''));
    }
    return Number.isFinite(value) ? value : null;
  }

  function naverQuote(row) {
    const p = numeric(row?.closePrice ?? row?.calcPrice);
    if (p === null) return null;
    let change = numeric(row.compareToPreviousClosePrice ?? row.fluctuations);
    const direction = row.compareToPreviousPrice ?? row.fluctuationsType;
    const code = String(direction?.code ?? '');
    const label = String(direction?.name ?? '') + String(direction?.text ?? '');
    if (change !== null) {
      if (/^[45]$/.test(code) || /FALL|하락|하한/.test(label)) change = -Math.abs(change);
      else if (/^[12]$/.test(code) || /RIS|상승|상한/.test(label)) change = Math.abs(change);
    }
    return { p, prev: change === null ? null : numeric(p - change) };
  }

  function create({ readText, parseXml = text => new DOMParser().parseFromString(text, 'text/xml') }) {
    if (typeof readText !== 'function') throw new TypeError('readText is required');

    async function read(url, parse) {
      try {
        const text = await readText(url);
        return typeof text === 'string' && text.trim() ? parse(text) : null;
      } catch {
        return null;
      }
    }

    async function fromNaver(url, identity, code, allowUnidentified = false) {
      const body = await read(url, JSON.parse);
      if (body?.success === false || body?.error) return null;
      const payload = body?.datas ?? body?.result ?? body?.data ?? body?.items ?? body;
      const rows = Array.isArray(payload) ? payload : [payload];
      const single = allowUnidentified && rows.length === 1 && identity(rows[0]) == null;
      const row = rows.find(item => identity(item) === code) ?? (single ? rows[0] : null);
      return naverQuote(row);
    }

    async function fromYahoo(symbol) {
      const body = await read('https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(symbol) + '?interval=1d&range=1d', JSON.parse);
      const meta = body?.chart?.result?.[0]?.meta;
      if (body?.chart?.error || meta?.symbol !== symbol) return null;
      const p = numeric(meta.regularMarketPrice);
      return p === null ? null : { p, prev: numeric(meta.chartPreviousClose ?? meta.previousClose) };
    }

    async function index(symbol) {
      if (typeof symbol !== 'string' || !/^\^[A-Z0-9]{1,15}$/.test(symbol)) return null;
      let quote;
      if (domestic.has(symbol)) {
        const code = domestic.get(symbol);
        quote = await fromNaver('https://polling.finance.naver.com/api/realtime/domestic/index/' + code,
          row => row?.itemCode ?? row?.symbolCode, code, true);
      } else if (global.has(symbol)) {
        const code = global.get(symbol);
        quote = await fromNaver('https://stock.naver.com/api/polling/worldstock/index?reutersCodes=' + code,
          row => row?.reutersCode ?? row?.symbolCode, code);
      }
      return quote ? { ...quote, source: 'N' } : yahooQuote(symbol);
    }

    async function yahooQuote(symbol) {
      const quote = await fromYahoo(symbol);
      return quote ? { ...quote, source: 'Y' } : null;
    }

    async function quote(symbol) {
      if (typeof symbol !== 'string' || !/^[A-Z0-9][A-Z0-9=.-]{0,31}$/.test(symbol)) return null;
      if (!/^\d{6}$/.test(symbol)) return yahooQuote(symbol);
      const result = await fromNaver('https://polling.finance.naver.com/api/realtime/domestic/stock/' + symbol,
        row => row?.itemCode ?? row?.stockCode ?? row?.symbolCode, symbol);
      return result ? { ...result, source: 'N' } : null;
    }

    async function news(topic) {
      if (!newsQueries.has(topic)) return null;
      const doc = await read('https://news.google.com/rss/search?q=' +
        encodeURIComponent(newsQueries.get(topic)) + '&hl=ko&gl=KR&ceid=KR:ko', parseXml);
      if (!doc || doc.documentElement?.localName !== 'rss' || doc.querySelector('parsererror')) return null;
      const channel = doc.querySelector('rss > channel');
      if (!channel) return null;
      const articles = [];
      const seen = new Set();
      for (const item of channel.querySelectorAll('item')) {
        const field = name => item.querySelector(name)?.textContent?.trim() ?? '';
        const t = field('title');
        const l = field('link');
        const d = new Date(field('pubDate'));
        if (!t || !Number.isFinite(d.getTime()) || seen.has(l)) continue;
        try {
          const url = new URL(l);
          if (!/^https:\/\//i.test(l) || url.username || url.password || /[\s\\]/.test(l)) continue;
        } catch {
          continue;
        }
        seen.add(l);
        articles.push({ t, l, s: field('source'), d });
      }
      return articles.sort((a, b) => b.d - a.d);
    }

    return Object.freeze({ index, quote, news });
  }

  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketDataV2 = api;
})(globalThis);
