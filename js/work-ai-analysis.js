(function (root) {
  'use strict';

  const scopes = {
    market: 'Summarize market conditions and major risks.',
    symbol: 'Summarize the supplied symbol metrics and conditional scenarios.',
    portfolio: 'Summarize aggregate allocation and concentration risks.'
  };
  const metrics = new Set(['price', 'changePct', 'volumeRatio', 'turnoverRatio', 'atr', 'support', 'resistance',
    'returnPct', 'allocationPct', 'concentrationPct', 'vix', 'fxRate']);
  const sources = new Set(['N', 'Y', 'D', 'H', 'derived', 'synthetic']);
  const currency = /^[A-Z]{3}$/;
  const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const codes = ['INVALID_REQUEST', 'BUDGET_EXCEEDED', 'PROVIDER_ERROR', 'INVALID_RESPONSE', 'USAGE_UNCONFIRMED'];
  const failure = code => ({ ok: false, code });
  const number = value => Number.isFinite(value) && value >= 0;

  function build({ scope, evidence, asOf, provenance, maxInputTokens, maxOutputTokens, maxCost, pricing } = {}) {
    if (!Object.hasOwn(scopes, scope) || !timestamp(asOf) || !['live', 'synthetic'].includes(provenance) ||
        !Array.isArray(evidence) || !evidence.length || evidence.length > 40 ||
        !count(maxInputTokens) || maxInputTokens === 0 || !count(maxOutputTokens) || maxOutputTokens === 0 ||
        !number(maxCost) || !number(pricing?.inputPerMillion) || !number(pricing?.outputPerMillion) ||
        typeof pricing?.currency !== 'string' || !currency.test(pricing.currency)) return failure(codes[0]);
    const facts = [];
    for (const fact of evidence) {
      if (!metrics.has(fact?.metric) || !Number.isFinite(fact.value) ||
          !timestamp(fact.observedAt) || fact.observedAt > asOf || !sources.has(fact.source) ||
          fact.provenance !== provenance || (provenance === 'live' && fact.source === 'synthetic')) return failure(codes[0]);
      facts.push({ id: 'e' + (facts.length + 1), metric: fact.metric, value: fact.value,
        observedAt: fact.observedAt, source: fact.source });
    }
    const instruction = scopes[scope] + ' Use only the supplied numeric evidence. ' +
      'Return JSON with summary and findings. Each finding needs text, evidenceIds and risk (low, medium or high). ' +
      'Express uncertainty. Do not issue orders or add unsupported facts.';
    return { ok: true, request: { scope, asOf, provenance, facts, instruction,
      budget: { maxInputTokens, maxOutputTokens, maxCost,
        pricing: { inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion, currency: pricing.currency } } } };
  }

  function measure(inputTokens, outputTokens, budget) {
    return inputTokens / 1e6 * budget.pricing.inputPerMillion +
      outputTokens / 1e6 * budget.pricing.outputPerMillion;
  }

  function normalize(response, request) {
    const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
    const payload = response?.analysis;
    const known = new Map(request.facts.map(fact => [fact.id, fact]));
    if (!text(payload?.summary, 2000) || !Array.isArray(payload.findings) ||
        !payload.findings.length || payload.findings.length > 12) return failure(codes[3]);
    const findings = [];
    for (const finding of payload.findings) {
      if (!text(finding?.text, 1000) || !['low', 'medium', 'high'].includes(finding.risk) ||
          !Array.isArray(finding.evidenceIds) || !finding.evidenceIds.length ||
          finding.evidenceIds.length > known.size || !finding.evidenceIds.every(id => known.has(id))) return failure(codes[3]);
      findings.push({ text: finding.text, risk: finding.risk,
        evidence: [...new Set(finding.evidenceIds)].map(id => known.get(id)) });
    }
    const input = response.usage?.inputTokens;
    const output = response.usage?.outputTokens;
    if (!count(input) || !count(output)) return failure(codes[4]);
    const cost = measure(input, output, request.budget);
    const usage = { inputTokens: input, outputTokens: output, cost, currency: request.budget.pricing.currency };
    if (input > request.budget.maxInputTokens || output > request.budget.maxOutputTokens ||
        !Number.isFinite(cost) || cost > request.budget.maxCost) return { ...failure(codes[1]), usage };
    return { ok: true, scope: request.scope, asOf: request.asOf, provenance: request.provenance,
      summary: payload.summary, findings, usage };
  }

  async function analyze(input, { provider, estimateInputTokens } = {}) {
    const built = build(input);
    if (!built.ok) return built;
    if (typeof provider !== 'function' || typeof estimateInputTokens !== 'function') return failure(codes[0]);
    const { request } = built;
    const { budget } = request;
    const messages = [{ role: 'system', content: request.instruction },
      { role: 'user', content: JSON.stringify({ asOf: request.asOf, evidence: request.facts }) }];
    try {
      const estimated = estimateInputTokens(messages);
      if (!count(estimated) || estimated === 0) return failure(codes[4]);
      if (estimated > budget.maxInputTokens || measure(estimated, budget.maxOutputTokens, budget) > budget.maxCost) {
        return failure(codes[1]);
      }
      const response = await provider({ messages, maxOutputTokens: budget.maxOutputTokens });
      return normalize(response, request);
    } catch { return failure(codes[2]); }
  }

  const api = Object.freeze({ build, analyze });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkAIAnalysis = api;
})(globalThis);
