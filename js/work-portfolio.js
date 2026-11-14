(function (root) {
  'use strict';

  const isCurrency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const valueOrNull = value => Number.isFinite(value) ? value : null;
  const code = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,48}$/.test(value);

  function analyze({ holdings, fxToKrw = {}, partial = false, concentrationThreshold = 0.25 } = {}) {
    if (!Array.isArray(holdings) || holdings.length > 10000 ||
        !Number.isFinite(concentrationThreshold) || concentrationThreshold <= 0 || concentrationThreshold > 1) {
      return { status: 'invalid', reason: 'INVALID_INPUT' };
    }

    const rows = holdings.map(row => {
      const issues = [];
      const currency = isCurrency(row?.currency) ? row.currency : null;
      const rate = currency === 'KRW' ? 1 : currency && fxToKrw && Object.hasOwn(fxToKrw, currency) ? fxToKrw[currency] : null;
      const fx = Number.isFinite(rate) && rate > 0 ? rate : null;
      const accountKey = code(row?.accountKey) ? row.accountKey : null;
      const market = row?.market === 'domestic' || row?.market === 'overseas' ? row.market : null;
      const symbol = code(row?.code) ? row.code : null;
      const identity = code(row?.instrumentId) ? row.instrumentId : market === 'domestic' && symbol ? 'KR:' + symbol : null;
      if (!accountKey || !identity) issues.push('IDENTITY_UNKNOWN');
      if (!currency) issues.push('CURRENCY_UNKNOWN');
      if (market === 'domestic' && currency !== 'KRW') issues.push('CURRENCY_MISMATCH');

      // NH evalAmount/profit are already KRW for both domestic and overseas.
      const quantity = nonnegative(row?.quantity) ? row.quantity : null;
      const reportedValue = nonnegative(row?.evalAmount) ? row.evalAmount : null;
      const reportedProfit = valueOrNull(row?.profit);
      const computedValue = quantity === 0 ? 0 :
        quantity !== null && Number.isFinite(row?.currentPrice) && row.currentPrice > 0 && fx !== null
        ? valueOrNull(quantity * row.currentPrice * fx) : null;
      const computedCost = quantity !== null && nonnegative(row?.avgPrice) && fx !== null
        ? valueOrNull(quantity * row.avgPrice * fx) : null;
      const valueKrw = issues.includes('CURRENCY_MISMATCH') ? null : reportedValue ?? computedValue;
      // Current FX cannot reconstruct historical KRW acquisition cost or broker P/L.
      const reportedCost = reportedValue !== null && reportedProfit !== null
        ? valueOrNull(reportedValue - reportedProfit) : null;
      const costKrw = valueKrw === null ? null : nonnegative(reportedCost) ? reportedCost :
        currency === 'KRW' && (reportedProfit === null || reportedValue === null) ? computedCost : null;
      const profitKrw = costKrw === null ? null : valueOrNull(valueKrw - costKrw);
      const returnPct = costKrw > 0 && profitKrw !== null ? valueOrNull(profitKrw / costKrw * 100) : null;
      if (valueKrw === null) issues.push(fx === null ? 'VALUATION_OR_FX_MISSING' : 'VALUATION_MISSING');
      if (costKrw === null) issues.push('COST_BASIS_MISSING');
      return { accountKey, identity, currency, country: market === 'domestic' ? 'KR' : code(row?.country) ? row.country : null,
        assetClass: code(row?.assetClass) ? row.assetClass : null, valueKrw, costKrw, profitKrw, returnPct, issues };
    });

    function totals(list) {
      const total = field => list.some(row => row[field] === null) ? null :
        valueOrNull(list.reduce((sum, row) => sum + row[field], 0));
      const valueKrw = total('valueKrw');
      const costKrw = total('costKrw');
      const profitKrw = total('profitKrw');
      return { valueKrw, costKrw, profitKrw,
        returnPct: costKrw > 0 && profitKrw !== null ? valueOrNull(profitKrw / costKrw * 100) : null };
    }

    const summary = totals(rows);
    function groups(field) {
      const grouped = new Map();
      for (const row of rows) {
        const key = row[field] ?? null;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      }
      return [...grouped].map(([key, list]) => {
        const group = totals(list);
        const weight = !partial && summary.valueKrw > 0 && group.valueKrw !== null
          ? group.valueKrw / summary.valueKrw : null;
        return { key, ...group, weight };
      });
    }

    const exposures = groups('identity');
    const unknownExposure = exposures.some(row => row.key === null && row.valueKrw !== 0);
    const concentrated = exposures.filter(row => row.key !== null && row.weight >= concentrationThreshold);
    return { status: partial || rows.some(row => row.issues.length) ? 'partial' : rows.length ? 'ok' : 'empty',
      partial, rows, summary, accounts: groups('accountKey'), byAssetClass: groups('assetClass'),
      byCountry: groups('country'), byCurrency: groups('currency'), exposures,
      risk: { concentrated, unknownExposure, incomplete: partial || summary.valueKrw === null || unknownExposure } };
  }

  const api = Object.freeze({ analyze });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkPortfolio = api;
})(globalThis);
