# MY INVEST V2 — P4 strategy evaluation (isolated proposal)

## Status / ownership boundary

- Independent branch: `feat/p4-strategy-evaluation-isolated` (later CI-check branch may use `fix/p4-strategy-evaluation-isolated`).
- New files only: `js/strategy-evaluation-v1.js`, `tests/strategy-evaluation-v1.test.cjs`, this document.
- **Do not modify** Codex's Worker/relay, `js/dev_market.js`, `js/transport.js`, `js/read-status.js`, `js/page-*`, GAS or deployment files.
- This is an offline, pure JavaScript model for **daily swing strategies only**. No external requests, secrets, browser storage, order execution, or use of portfolio/account balances.
- Not wired to production UI or dev Pages: review and independently validate before integration.

## Why this model exists

P3 calculates conditional 1R/2R watch scenarios, but does not show whether an entry rule would have worked **after** it triggered historically. P4 introduces a deliberately simple, fixed-parameter baseline for validating a trading hypothesis before suggesting parameter optimization. A backtest is not proof of investment performance.

## Algorithm and explicit no-lookahead boundary

For each completed daily OHLCV bar `i`:

1. Compare final close to the **preceding 20 bars'** highest high. Require the signal close above that level.
2. Require 5-day SMA > 20-day SMA, both calculated using bars through `i`.
3. Require volume on `i` >= 1.5 times the mean volume of **preceding 20 bars**, using no later bar.
4. Observe signal **only after daily bar `i` is complete**. Its timestamp may represent opening time; the caller must ensure it is final.
5. Schedule a single long entry for the **open of bar `i+1`**, not for the known close of `i`. Skip if the new open <= the predetermined stop (minimum low of the previous 20 bars).
6. Position sizing is capped by both a fixed 1% risk budget and 25% capital allocation, using prospective planned stop **inclusive of transaction costs**.
7. Set a 2R target using the actual next-bar fill and previous-bar-only stop. Apply configurable entry and exit slippage, entry/exit fees, and one-position-at-a-time logic.
8. Exit conservatively: if open gaps below stop, exit at **actual worse opening price**; if open gaps above target, cap fill at target; if high/low cross stop and target in the same bar, **stop first**. Otherwise stop or target, then maximum holding bars, then end-of-sample close.
9. Track realized-only equity, net profit/loss, risk multiples, fees, win rate and **realized-only** maximum drawdown. This excludes interim floating drawdown.

No optimization, machine learning, signal selection after looking at outcomes, intraday timing inference, or price data fabrication is performed.

## Input and example (synthetic only)

```js
const engine = require('./js/strategy-evaluation-v1.js');
const output = engine.simulate({
  interval: '1d',
  bars: [/* historical finalized OHLCV: {t,o,h,l,c,v}, t = Unix milliseconds */],
  initialCapital: 10_000_000,
  riskPct: 1,
  maxAllocationPct: 25,
  feeBps: 10,
  slippageBps: 10,
  targetR: 2,
  maxHoldingBars: 15,
  volumeMultiple: 1.5,
  // Optional: timestamp exactly equal to the first EVALUATION bar.
  // All preceding bars are for indicator warmup only; earlier fills are excluded.
  testStartAt: 1700000000000
});
```

Input should include a sufficiently long real historical data set with proven instrument identity, adjusted-price convention, currency, source, and last observation date. **This module does not verify external source authenticity**; it always emits `validation.inputProvenance = NOT_EXTERNALLY_VERIFIED`.

Setting `testStartAt` creates an explicit evaluation subperiod and excludes entry fills before that point. It does not turn a backtest into statistically out-of-sample research if the thresholds were chosen using the same data. Fix the rules before evaluating a future hold-out period.

## Result and validation

- `status: invalid | insufficient | ok`
- `validation`: time split, conservative stop-first assumption, provenance limits, no future bar in signal computation
- `signals`, `skipped`, `trades[]`: decision bar, next-bar actual opening fill, reason, fee, target/stop, result
- `statistics`: trade count, win rate, realized P&L and final equity, realized-only drawdown, mean net R
- `warnings`: missing market impact, taxes, FX, financing, survivorship/delisting bias, intrabar order uncertainty

## Tests required before integration

- Strict monotonic timestamps and OHLCV validity, bound configuration, daily-only behavior.
- A signal cannot fill at same-bar close; fill must occur on next bar.
- Changing subsequent candles cannot change previous signal evidence.
- Both stop and target in one bar uses stop first.
- Stop-gap fills at worse actual open; target-gap is capped at target.
- No trade before optional test-period start, but previous bars can warm indicators.
- Missing volume is not substituted with a fabricated number.
- Commission changes net results, and no account/transport/order dependencies exist.
- Synthetic tests are **not** real-market backtest accuracy proof.

## Next integration after Codex completes public data work

Only after relay/public feed stability is verified:

1. Have a separate adapter fetch and validate real daily bars, listing identities, and consistent corporate-action adjustment. Do not add live requests inside this engine.
2. Record source, symbol, timestamp range, survivorship status and currency outside the engine.
3. Run a fixed in-sample vs later untouched hold-out evaluation, compare to buy-and-hold and benchmark, show sample size and drawdown scope.
4. Add a read-only UI only after explicit product review and browser/accessibility tests. Keep strategy signals visually distinct from actual prices and trading advice.
5. Never infer intraday VWAP or short-term trading efficacy from daily bars.

**No deployment, trading or account interaction is authorized by this document.**

## Isolated CI branch

The `fix/p4-strategy-evaluation-isolated` branch is a separate, synthetic-only CI validation branch created from the feature implementation. This avoids changing Codex's branch or opening a PR that could trigger the separate live NH staging workflow.
