const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/work-ai-analysis.js');


const input = { scope: 'symbol', asOf: 2000, provenance: 'synthetic',
  evidence: [{ metric: 'price', value: 100, source: 'synthetic', observedAt: 1000, provenance: 'synthetic' }],
  maxInputTokens: 200, maxOutputTokens: 100, maxCost: 1,
  pricing: { currency: 'USD', inputPerMillion: 2, outputPerMillion: 8 } };
const fake = { analysis: { summary: 'Synthetic analysis', findings: [{ text: 'Price', risk: 'low', evidenceIds: ['e1'] }] },
  usage: { inputTokens: 160, outputTokens: 80 } };
const estimateInputTokens = () => 150;
test('structures evidence and usage and drops extra input fields', async () => {
  const args = { ...input, evidence: [{ ...input.evidence[0], extra: 'ignore this' }] };
  const out = await api.analyze(args, { estimateInputTokens, provider: async request => {
    assert.equal(request.maxOutputTokens, 100);
    assert.ok(!request.messages[1].content.includes('ignore this'));
    return fake;
  } });
  assert.equal(out.ok, true);
  assert.equal(out.findings[0].evidence[0].observedAt, 1000);
  assert.equal(out.usage.outputTokens, 80);
});
test('blocks overbudget estimate before provider and rejects future or mixed evidence', async () => {
  let calls = 0;
  const out = await api.analyze({ ...input, maxCost: 0 }, { estimateInputTokens, provider: async () => { calls++; } });
  assert.equal(out.code, 'BUDGET_EXCEEDED');
  assert.equal(calls, 0);
  assert.equal(api.build({ ...input, asOf: 500 }).ok, false);
  assert.equal(api.build({ ...input, provenance: 'live' }).ok, false);
});
test('handles provider errors, unsupported citations, and absent usage', async () => {
  const run = provider => api.analyze(input, { provider, estimateInputTokens });
  assert.equal((await run(async () => { throw new Error('sensitive'); })).code, 'PROVIDER_ERROR');
  assert.equal((await run(async () => ({ ...fake, usage: null }))).code, 'USAGE_UNCONFIRMED');
  const bad = { ...fake.analysis.findings[0], evidenceIds: ['e2'] };
  assert.equal((await run(async () => ({ ...fake, analysis: { ...fake.analysis, findings: [bad] } }))).code, 'INVALID_RESPONSE');
  assert.equal((await run(async () => ({ ...fake, usage: { inputTokens: 201, outputTokens: 80 } }))).code, 'BUDGET_EXCEEDED');
});
