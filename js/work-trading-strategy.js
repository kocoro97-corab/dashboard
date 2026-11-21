(function (root) {
  'use strict';

  const profiles = {
    day: { fast: 5, slow: 20, levels: 10, stopAtr: 1, minimumRewardRisk: 1.5 },
    swing: { fast: 10, slow: 30, levels: 20, stopAtr: 1.5, minimumRewardRisk: 2 }
  };
  const positive = value => Number.isFinite(value) && value > 0;
  const mean = values => values.reduce((sum, value) => sum + value / values.length, 0);

  function analyze({ mode, bars, capital, riskPct = 1, maxAllocationPct = 25, lotSize = 1, interval } = {}) {
    const profile = Object.hasOwn(profiles, mode) ? profiles[mode] : null;
    if (!profile || !Array.isArray(bars) || bars.length > 2000 || !positive(capital) ||
        !positive(riskPct) || riskPct > 100 || !positive(maxAllocationPct) || maxAllocationPct > 100 ||
        !Number.isSafeInteger(lotSize) || lotSize < 1 ||
        !(mode === 'day' ? ['1m', '5m', '15m', '30m', '1h'].includes(interval) : interval === '1d')) {
      return { status: 'invalid', reason: 'INVALID_INPUT' };
    }
    if (bars.length < profile.slow + 1) return { status: 'insufficient', reason: 'INSUFFICIENT_BARS' };
    const rows = bars.slice(-(profile.slow + 1));
    if (rows.some((bar, i) => !bar || !Number.isSafeInteger(bar.t) || bar.t <= 0 ||
        (i > 0 && bar.t <= rows[i - 1].t) || ![bar.o, bar.h, bar.l, bar.c].every(positive) ||
        bar.l > Math.min(bar.o, bar.c) || bar.h < Math.max(bar.o, bar.c) ||
        [bar.volume, bar.turnover].some(value => value != null && (!Number.isFinite(value) || value < 0)))) {
      return { status: 'invalid', reason: 'INVALID_BAR' };
    }
    const last = rows.at(-1);
    const prior = rows.slice(0, -1);
    const sma = n => mean(rows.slice(-n).map(bar => bar.c));
    const fast = sma(profile.fast);
    const slow = sma(profile.slow);
    const trend = fast > slow && last.c > fast ? 'up' : fast < slow && last.c < fast ? 'down' : 'mixed';
    const momentumPct = (last.c / rows.at(-6).c - 1) * 100;
    const atr = mean(rows.slice(-14).map((bar, i) => {
      const previous = rows[rows.length - 15 + i].c;
      return Math.max(bar.h - bar.l, Math.abs(bar.h - previous), Math.abs(bar.l - previous));
    }));
    const levels = prior.slice(-profile.levels);
    const support = Math.min(...levels.map(bar => bar.l));
    const resistance = Math.max(...levels.map(bar => bar.h));
    const relative = field => {
      const base = prior.slice(-20).map(bar => bar[field]);
      if (last[field] == null || base.some(value => value == null)) return null;
      const average = mean(base);
      return average > 0 ? last[field] / average : null;
    };
    const volumeRatio = relative('volume');
    const turnoverRatio = relative('turnover');
    const risks = [];
    if (volumeRatio === null) risks.push('VOLUME_UNAVAILABLE');
    if (turnoverRatio === null) risks.push('TURNOVER_UNAVAILABLE');
    if (trend !== 'up') risks.push('TREND_NOT_UP');
    if (last.c <= resistance) risks.push('BELOW_BREAKOUT');
    if (volumeRatio !== null && volumeRatio < 1.5) risks.push('LOW_RELATIVE_VOLUME');
    if (atr / last.c > 0.08) risks.push('HIGH_VOLATILITY');

    const entry = Math.max(last.c, resistance);
    const stop = Math.max(support, entry - atr * profile.stopAtr);
    const riskPerUnit = entry - stop;
    const target = entry + riskPerUnit * profile.minimumRewardRisk;
    const rewardRisk = (target - entry) / riskPerUnit;
    const limit = Math.min(capital * (riskPct / 100) / riskPerUnit, capital * (maxAllocationPct / 100) / entry);
    const quantity = Math.floor(limit / lotSize) * lotSize;
    if (![fast, slow, momentumPct, atr, volumeRatio ?? 0, turnoverRatio ?? 0].every(Number.isFinite)) {
      return { status: 'invalid', reason: 'NUMERIC_OVERFLOW' };
    }
    const plan = riskPerUnit > 0 && Number.isFinite(target) && Number.isFinite(rewardRisk) && Number.isSafeInteger(quantity)
      ? { entry, stop, target, rewardRisk, quantity, estimatedRisk: quantity * riskPerUnit, allocatedCapital: quantity * entry }
      : null;
    if (!plan || plan.quantity === 0) risks.push('POSITION_UNAVAILABLE');
    const evidence = [];
    if (trend === 'up') evidence.push('PRICE_ABOVE_FAST_ABOVE_SLOW');
    if (last.c > resistance) evidence.push('PRIOR_RANGE_BREAKOUT');
    if (volumeRatio >= 1.5) evidence.push('VOLUME_EXPANSION');
    if (momentumPct > 0) evidence.push('POSITIVE_MOMENTUM');
    return { status: 'ok', mode, asOf: last.t, trend, fast, slow, momentumPct, atr, support, resistance,
      volumeRatio, turnoverRatio, signal: risks.length === 0 && momentumPct > 0 ? 'breakout_candidate' : 'watch',
      evidence, risks, plan };
  }

  const api = Object.freeze({ analyze });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkTradingStrategy = api;
})(globalThis);
