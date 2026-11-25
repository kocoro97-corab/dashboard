(function (root) {
  'use strict';

  const markets = ['KR', 'US'];
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
  });
  const zones = { KR: 'Asia/Seoul', US: 'America/New_York' };

  function item(value) {
    if (!value || typeof value.id !== 'string' || !/^[\w.-]{1,48}$/.test(value.id) ||
        typeof value.name !== 'string' || !value.name.trim()) return null;
    const result = { id: value.id, name: value.name.trim().slice(0, 80) };
    for (const field of ['y', 'tv', 't', 'fut', 'inv']) {
      if (typeof value[field] === 'string') result[field] = value[field].slice(0, 80);
    }
    for (const field of ['m', 'vis']) {
      if (typeof value[field] === 'boolean' || Number.isFinite(value[field])) result[field] = value[field];
    }
    return result;
  }

  function normalize(settings, defaults = {}) {
    return Object.fromEntries(markets.map(market => {
      const source = Array.isArray(settings?.[market]) ? settings[market] : defaults[market];
      const seen = new Set();
      const cards = (Array.isArray(source) ? source : []).map(item).filter(card => {
        if (!card || seen.has(card.id)) return false;
        seen.add(card.id);
        return true;
      });
      return [market, cards];
    }));
  }

  function edit(settings, market, action, defaults) {
    const next = normalize(settings, defaults);
    if (!markets.includes(market) || !action) return next;
    const cards = next[market];
    const index = cards.findIndex(card => card.id === action.id);
    if (action.type === 'add') {
      const card = item(action.card);
      if (card && !cards.some(current => current.id === card.id)) cards.push(card);
    } else if (action.type === 'remove' && index >= 0) {
      cards.splice(index, 1);
    } else if (action.type === 'move' && index >= 0 && Number.isInteger(action.to) && action.to >= 0 && action.to < cards.length) {
      cards.splice(action.to, 0, cards.splice(index, 1)[0]);
    }
    return next;
  }

  function layout(settings, { defaults, now = Date.now(), calendar } = {}) {
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('INVALID_TIME');
    const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
    const hour = Number(parts.hour);
    const primary = hour >= 7 && hour < 21 ? 'KR' : 'US';
    const order = primary === 'KR' ? markets.slice() : markets.slice().reverse();
    const cards = normalize(settings, defaults);
    const tradingDays = Object.fromEntries(order.map(market => {
      const date = new Intl.DateTimeFormat('en-US', { timeZone: zones[market], year: 'numeric', month: '2-digit',
        day: '2-digit', weekday: 'short' });
      const fields = Object.fromEntries(date.formatToParts(now).map(part => [part.type, part.value]));
      const localDate = fields.year + '-' + fields.month + '-' + fields.day;
      const override = calendar?.[market]?.[localDate];
      const status = ['open', 'closed'].includes(override) ? override :
        ['Sat', 'Sun'].includes(fields.weekday) ? 'closed' : 'unconfirmed';
      return [market, { localDate, status }];
    }));
    const visibleCards = Object.fromEntries(order.map(market => [market, cards[market].filter(card => card.vis !== 0 && card.vis !== false)]));
    return { primary, order, cards, visibleCards, tradingDays };
  }

  const api = Object.freeze({ normalize, edit, layout });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkMarketSettings = api;
})(globalThis);
