(function (root) {
  'use strict';

  const currencyCode = /^[A-Z]{3}$/;
  const units = ['price', 'indexPoints', 'percent', 'fxRate'];
  const validTime = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;

  function inspect(quote, policy = {}) {
    const {
      now = Date.now(), staleAfterMs = 300000, maxAbsChangePct = 50,
      expectedCurrency, expectedUnit, requirePositive = true, expectedSource
    } = policy;
    if (!validTime(now) || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0 ||
        !Number.isFinite(maxAbsChangePct) || maxAbsChangePct <= 0) throw new RangeError('INVALID_QUALITY_POLICY');

    const issues = [];
    const source = typeof quote?.source === 'string' && /^[\w.-]{1,32}$/.test(quote.source) ? quote.source : null;
    const currency = typeof quote?.currency === 'string' && currencyCode.test(quote.currency) ? quote.currency : null;
    const unit = units.includes(quote?.unit) ? quote.unit : null;
    const observedAt = validTime(quote?.observedAt) ? quote.observedAt : null;
    const receivedAt = validTime(quote?.receivedAt) ? quote.receivedAt : null;
    const ageMs = observedAt !== null && observedAt <= now ? now - observedAt : null;

    if (quote?.apiError) issues.push('API_ERROR');
    if (!source) issues.push('SOURCE_UNKNOWN');
    if (expectedSource && source !== expectedSource) issues.push('SOURCE_MISMATCH');
    if (!unit) issues.push('UNIT_UNKNOWN');
    if (expectedUnit && unit !== expectedUnit) issues.push('UNIT_MISMATCH');
    if ((expectedCurrency && currency !== expectedCurrency) || (unit === 'price' && !currency)) issues.push('CURRENCY_MISMATCH');
    if (observedAt === null) issues.push('TIMESTAMP_UNKNOWN');
    if (observedAt > now || receivedAt > now) issues.push('FUTURE_TIMESTAMP');
    if (receivedAt !== null && observedAt !== null && observedAt > receivedAt) issues.push('TIMESTAMP_ORDER');

    const validPrice = value => Number.isFinite(value) && (!requirePositive || value > 0);
    const p = validPrice(quote?.p) ? quote.p : null;
    const prev = validPrice(quote?.prev) ? quote.prev : null;
    if (p === null) issues.push(quote?.p == null ? 'PRICE_MISSING' : 'PRICE_INVALID');
    if (prev === null) issues.push(quote?.prev == null ? 'PREVIOUS_MISSING' : 'PREVIOUS_INVALID');
    const derived = p !== null && prev !== null && prev !== 0 ? (p - prev) / Math.abs(prev) * 100 : null;
    const changePct = Number.isFinite(derived) ? derived : null;
    if (derived !== null && (!Number.isFinite(derived) || Math.abs(derived) > maxAbsChangePct)) issues.push('CHANGE_OUTLIER');
    if (quote?.changePct != null && (!Number.isFinite(quote.changePct) || Math.abs(quote.changePct) > maxAbsChangePct)) {
      issues.push('REPORTED_CHANGE_INVALID');
    } else if (changePct !== null && Number.isFinite(quote?.changePct) && Math.abs(changePct - quote.changePct) > 0.15) {
      issues.push('CHANGE_MISMATCH');
    }
    const metadataOnly = ['TIMESTAMP_UNKNOWN', 'PREVIOUS_MISSING'];
    const confirmed = issues.every(code => metadataOnly.includes(code));
    const status = !confirmed || ageMs === null ? 'unconfirmed' : ageMs >= staleAfterMs ? 'stale' :
      quote.delivery === 'realtime' ? 'realtime' : quote.delivery === 'delayed' ? 'delayed' : 'unconfirmed';
    return { p, prev, changePct, status, issues, source, currency, unit, observedAt, receivedAt, ageMs,
      usable: status === 'realtime' || status === 'delayed' };
  }

  const api = Object.freeze({ inspect });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkDataQuality = api;
})(globalThis);
