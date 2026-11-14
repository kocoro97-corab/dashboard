(function (root) {
  'use strict';

  const defaultThemes = [
    { market: 'KR', id: 'semiconductors', terms: ['반도체', 'HBM', '파운드리'] },
    { market: 'KR', id: 'batteries', terms: ['이차전지', '2차전지', '배터리'] },
    { market: 'KR', id: 'shipbuilding', terms: ['조선업', '조선주', '선박'] },
    { market: 'US', id: 'semiconductors', terms: ['semiconductor', 'semiconductors', 'chipmakers', 'HBM'] },
    { market: 'US', id: 'ai-cloud', terms: ['AI', 'cloud computing', 'data centers'] },
    { market: 'US', id: 'energy', terms: ['nuclear', 'crude oil', 'natural gas'] }
  ];

  function clean(value, size) {
    return typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, size) : '';
  }

  function subjects(holdings = [], watchlist = []) {
    const unique = new Map();
    for (const row of [...holdings, ...watchlist]) {
      const market = row?.market;
      const symbol = clean(row?.symbol, 32).toUpperCase();
      const name = clean(row?.name, 80);
      if (!['KR', 'US'].includes(market) || !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(symbol) || !name) continue;
      const key = market + ':' + symbol;
      if (!unique.has(key)) unique.set(key, { key, market, symbol, name });
    }
    return [...unique.values()];
  }

  function buildQueries(holdings, watchlist) {
    return subjects(holdings, watchlist).slice(0, 20).map(({ key, market, name, symbol }) => ({
      key, market, query: '"' + name.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim() + '" ' +
        (market === 'US' ? symbol + ' ' : '') + 'when:2d'
    }));
  }

  function safeLink(value) {
    try {
      if (typeof value !== 'string' || /[\s\\]/.test(value)) return null;
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }

  function contains(haystack, needle) {
    if (!needle) return false;
    if (!/^[a-z0-9 .-]+$/i.test(needle)) return haystack.includes(needle);
    const escaped = needle.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^a-z0-9])' + escaped + '(?:$|[^a-z0-9])', 'i').test(haystack);
  }

  function classify({ articles = [], holdings, watchlist, themes = defaultThemes } = {}) {
    const tracked = subjects(holdings, watchlist);
    const byLink = new Map();
    for (const article of articles) {
      const title = clean(article?.t, 400);
      const link = safeLink(article?.l);
      const time = article?.d instanceof Date ? article.d.getTime() : NaN;
      const provenance = article?.provenance;
      if (!title || !link || !Number.isFinite(time) || !['live', 'synthetic'].includes(provenance)) continue;
      const normalized = title.toLowerCase();
      const matches = tracked.flatMap(subject => {
        const nameHit = contains(normalized, subject.name.toLowerCase());
        const tickerHit = subject.symbol.length >= 2 && contains(title, subject.symbol) &&
          (subject.market === 'KR' || title.includes('$' + subject.symbol) ||
            title.includes('(' + subject.symbol + ')'));
        return nameHit || tickerHit ? [{ key: subject.key, score: nameHit && tickerHit ? 3 : nameHit ? 2 : 1 }] : [];
      });
      const themeIds = themes.filter(theme => theme && ['KR', 'US'].includes(theme.market) &&
        Array.isArray(theme.terms) && theme.terms.some(term => contains(normalized, clean(term, 80).toLowerCase())))
        .map(theme => theme.market + ':' + theme.id);
      const key = provenance + '|' + link;
      if (!byLink.has(key) || byLink.get(key).publishedAt < time) {
        byLink.set(key, { title, link, source: clean(article.s, 120), publishedAt: time, provenance, matches, themeIds });
      }
    }
    const seen = new Set();
    const news = [...byLink.values()].sort((a, b) => b.publishedAt - a.publishedAt).filter(article => {
      const key = JSON.stringify([article.provenance, article.source.toLowerCase(), article.title.toLowerCase()]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const themeGroups = new Map();
    for (const article of news) for (const theme of article.themeIds) {
      const key = article.provenance + '|' + theme;
      if (!themeGroups.has(key)) themeGroups.set(key, { theme, provenance: article.provenance, count: 0, symbols: new Set() });
      const group = themeGroups.get(key);
      group.count++;
      for (const match of article.matches) if (match.key.slice(0, 2) === theme.slice(0, 2)) group.symbols.add(match.key);
    }
    return { news, themes: [...themeGroups.values()].map(group => ({ ...group, symbols: [...group.symbols] })) };
  }

  async function readExisting(marketData, { topic = 'market', provenance } = {}) {
    if (!['live', 'synthetic'].includes(provenance) || typeof marketData?.news !== 'function') return null;
    try {
      const rows = await marketData.news(topic);
      return Array.isArray(rows) ? rows.map(row => ({ ...row, provenance })) : null;
    } catch {
      return null;
    }
  }

  const api = Object.freeze({ buildQueries, classify, readExisting });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkPersonalNews = api;
})(globalThis);
