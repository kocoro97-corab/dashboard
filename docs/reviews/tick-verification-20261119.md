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

## Reference-only mode confirmed by owner

The owner confirms there is no existing numerical provider and that the current connection is TradingView. Keep the current free reference arrangement; do not create a broker/data account, subscription or credentials.

Further inspection found the legacy `updateTickGauge` still multiplied NASDAQ/S&P500 percentage changes to infer a TICK gauge. Those values were labeled estimates but are not NYSE TICK observations. Removed this inference. The legacy gauge now accepts only a bounded, timestamped current `Q.TICK` from the existing IBKR/dxFeed adapter codes; otherwise it shows unavailable and hides its pointer rather than implying zero. Explicit manual entries remain labeled manual and are never copied into the numerical provider model. Widget bootstrap/load status is labeled reference/frame receipt, not realtime data success. The existing chart dialog explains that reference widget values are not ingested into automated analysis. The compact 3x3 cards remain unchanged.

Verification: related transport/provider Node suites PASS, including new regression cases for strong index moves without TICK, valid negative/zero TICK, stale/unapproved-source rejection, and manual entry separation. PC 1440 / Fold-sized 690 / 344 synthetic browser checks PASS; market source/unit/region/cleanup browser regression 18 PASS. No live NH/account/order/storage calls or paid service activation. The earlier guessed public NH US-stock specification URL returned 404; that is not evidence of either NH TICK support or non-support, and no authenticated NH probe was attempted.

This completes the reference-only TICK consistency work. Numerical automated TICK remains intentionally unconnected while there is no authorized provider. Next Codex task: integrate and verify the latest industry/theme controls and actual public-series behavior; do not repeatedly request nonexistent TICK credentials.
