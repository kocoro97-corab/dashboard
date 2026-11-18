# KOSDAQ150 futures display — 2026-11-18 KST

Overall PARTIAL: actual isolated NH quote is owner-verified, development Worker capabilities are remotely verified, and UI transport/rendering is synthetic-tested. Authenticated actual browser-to-Worker-to-NH rendering remains user verification, not PASS.

## Actual evidence

Owner results: `WORKER_PREPARED_NO_GAS_CHANGE` PASS, followed by `ISOLATED_FUTURES_CONNECTION_READY` PASS without recovery. No new project/auth scopes, NH/account/order/store calls in activation.

Owner inquiry: one real A06 quote, contract `A066C000`, expiry `20261210`, price 1089.9, change +2.4920067707353777%, source NH N2 PLUG. Observed 2026-11-18 14:50:44 KST, received 14:50:46.606429 KST. Logout PASS; account/order/store calls 0. Market state and delay remain UNVERIFIED, hence provider result PARTIAL. These are public market observations supplied by the owner, not synthetic test values or embedded application defaults.

Direct read-only Worker appVersion verification: success=true; developmentPublicMarket=true, developmentPublicFutures=true, developmentIndustryMarket=true, developmentFuturesReadVersion=2. Required existing Origin/client headers retained. No login or NH calls made in this check. An earlier probe without the required client header was rejected 403; it is not a Worker outage or DNS failure.

## Narrow changes

- `js/page-market.js`: show KST date/time in 24-hour format regardless of browser timezone. Refresh the open detail's contract and quote summary together with the card; a failed dated quote clears the stale summary. Include percentage change and explicit market-state/delay/OHLCV limitations on initial opening.
- `tests/browser_futures_display.py`, `tests/worker_browser_bridge.mjs`: optional synthetic futures fixture drives the existing actual Worker handler. No live owner credentials, account queries, writes or orders. Covers default collection, targeted button refresh, invalid observation, route/modal cleanup and late reply after logout.
- `tests/browser_market_sector_recheck.py`: independently expected KST strings match the required fixed timezone.
- `tests/browser_commit_review.py`: cleanup test uses exact AAPL/MSFT tickers. Prior invented `LATE` input matched multiple company names, so it did not issue the expected chart request. No production symbol validation was relaxed.
- Existing CI adds the focused futures display test; no deployment workflow or authentication change.

## Verification

- `node --check js/page-market.js` and bridge syntax: PASS.
- `node --test tests/kosdaq150-market-v2.test.cjs tests/market-transport.test.cjs tests/worker-relay.test.cjs`: 3 files PASS.
- `tests/browser_futures_display.py`: 3 PASS at 1440/690/344 (six assertions groups per width; synthetic authentication/quotes, actual Worker code). UTC browser proves KST rendering. Synthetic prices differ from the actual owner quote.
- `tests/browser_market_sector_recheck.py --area market`: 18 PASS, synthetic services.
- `tests/browser_commit_review.py --extended`: 96 PASS / 3 cleanup FAIL before fixture correction. `--extended --only ROUTE` after correction: 3 PASS. Original failures retained in local logs; full CI status remains separately reported.
- Physical Fold6, native browser zoom and live authenticated page quote: NOT_RUN in the assistant environment; do not substitute viewport emulation or public metadata for those checks.

## Remaining / next assignee

Codex: confirm authenticated actual development page card/detail rendering with the owner's existing session; investigate OHLCV read support using the existing approved provider if needed. No speculative futures substitute, no live-state/delay claim, no production GAS modification. The user can already click Global Market > KOSDAQ150 futures > 코스닥150 선물 조회 without a DevTools snippet or shell command.

## Concurrent source integration

Preserved 13 remote commits through `f69edd2` (approved provider adapter order and NYSE TICK source-symbol validation). These are registration adapters, not newly connected paid/broker feeds. No IBKR/dxFeed/KIS/Koscom credentials or live adapters were registered by this work. The new TICK card attempted an external bootstrap script blocked by existing Pages CSP; replaced only its loader with the already allowed s.tradingview.com iframe, without loosening CSP or extracting iframe data. Unknown numerical feed remains unknown. Late fallback responses are discarded when the session changes. Merged futures UI browser regression: 3 widths PASS; provider/transport/session tests PASS.
