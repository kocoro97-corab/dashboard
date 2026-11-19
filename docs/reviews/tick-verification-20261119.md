# NYSE TICK verification — 2026-11-19 KST

Overall **PARTIAL**. The TradingView reference is available; the dashboard's numerical-provider feed is not connected.

## Live public reference vs numerical API

- Actual published dashboard assets used in a browser with synthetic login and other market feeds. TradingView frames and their vendor resources were loaded from the actual public service.
- Official symbol URL `https://www.tradingview.com/symbols/USI-TICK.NY/` returned HTTP 200; title identifies `NYSE TICK INDICATOR Today — USI:TICK.NY Index Chart — TradingView`.
- Actual reference chart rendered `NYSE TICK INDICATOR`, candles and a `Closed` label. This confirms a reference chart, not a live/current trading-session guarantee. The iframe observation time/delay cannot be independently established by the parent page.
- Card widget visually rendered a value, but no value was copied into the dashboard model or used for automated judgment. Its price and timestamp are not reported as independently verified API observations.
- Runtime `Q.TICK` was absent. Provider attempts: IBKR NOT_CONFIGURED, DXFEED NOT_CONFIGURED. Repository inspection found no production registrations for either numerical adapter. Adapter definitions and symbol tests do not constitute provider authentication, entitlement or market data reception.
- No live NH/account calls, order calls, store writes, paid model calls, new accounts or paid data subscriptions were made.

## Reproduced and fixed

1. `Number(null)`, `Number('')`, `Number(false)` and `Number([])` became zero and were accepted as a balanced TICK. Numeric input validation now rejects missing/blank/non-numeric types while preserving actual numeric zero and signed numeric strings.
2. A primary TICK quote older than the existing 120-second freshness threshold stopped the chain before a fresh secondary provider was checked. The resolver now skips stale TICK quotes and continues the same configured-provider order. Futures behavior is unchanged.

Files: `js/market-source-priority.js`, `tests/market-source-priority.test.cjs`.

## Synthetic verification

- `node --test tests/market-source-priority.test.cjs tests/market-transport.test.cjs`: PASS. Added meaningful regressions for null/empty/bool/container rejection, real zero, signed values and stale-primary/fresh-secondary selection.
- Browser 1440/690/344: PASS. Unconfigured feed never supplies a numeric value; stale IBKR sample falls through to fresh dxFeed sample; source and negative value render; null/empty responses clear previous values instead of showing zero; modal route change and logout clean up.
- Browser samples are synthetic; no licensed provider authentication or actual numerical feed PASS is implied.
- Existing 3-column layout retained. Actual Fold6 hardware is not asserted by viewport tests.

Screenshots/evidence: `/workspace/output/tick-check-20261119/` (actual public widget/chart with synthetic dashboard background; no actual account data).

## Next assignee

Codex: establish whether an existing approved TICK provider and entitlement are available, then connect the authenticated read path if authorized. Do not activate a new paid subscription/service or scrape the reference iframe into the application. Until then, retain reference-only display and unavailable automated judgment. No ChatGPT UI handoff is required for this connection task.
