# Integration review of 958dadee — 2026-11-17

Overall: PARTIAL until owner-authenticated production-shaped development relay receives data in the published page. No production, GAS, authentication, NH storage or order code was changed. Existing PR #7 and branches retained.

## Findings and minimal runtime changes

- Sector historical requests used `range=6mo`, rejected by the persistent relay allowlist. Reused its existing `range=1y` route; no Worker permission change.
- Validate symbol, currency, registered Korean exchange, strictly ordered/nonfuture timestamps; exclude the current unfinished session from close-based returns. Relative-strength windows require matching first/last observation dates. Share pending requests, stop stale queued work, and disclose rejected/missing series separately.
- Reuse the KRX listing master to select `.KS`/`.KQ`; never probe guessed exchanges. Keep domestic results explicitly equal-weight constituent samples and US results ETF proxies.
- Existing persistent public reads were fully serialized. Use three bounded lanes, preserving one of four server slots for authentication; temporary relay remains one lane. Session/endpoint cancellation retained.
- Chart width and visual viewport scale now adjust visible bars from the current manual setting. Resize observers/listeners/animation frames are cleaned on close/navigation. Existing controls, pinch and MA calculations retained.
- Reuse existing `qAgg` for annual aggregation of monthly `max` history. Previous year selection displayed monthly bars. Missing volume/MA samples are disclosed.
- Align the region timer with minute boundaries. Preserve manual selection for the current visit and independent KR/US priorities. Missing price/change stays unavailable, never synthetic zero.

## Results

| Scope | Result | Evidence |
|---|---|---|
| KST 06:59→07:00 / 20:59→21:00, manual override, reentry, priorities | PASS | 12 synthetic Chromium cases across 1440/690/344 |
| Buttons/slider/full/Ctrl-wheel/pinch/viewport resize/page scale, periods, MA5/MA20, cleanup, insufficient bars | PASS | 18 synthetic Chromium cases |
| KR day/swing, US 1/5/20/60 returns and SPY RS, stale selection, partial failure | PASS | 15 synthetic Chromium cases |
| Related Node regressions | PASS | 72 cases |
| Related Python regressions | PASS | 13 cases |
| JavaScript syntax / whitespace | PASS | 39 JS modules / git diff --check |
| Direct free public provider HTTP | PASS | 83/83 HTTP 200: Naver themes/members, 65 Yahoo annual series, S&P chart periods |
| Captured provider payload replay, 1440/344 | PASS | 12 chart cases and 6 sector cases; synthetic authentication, not live relay authentication |
| Existing market regression after time-default change | PASS | 6 cases at 1440; previous sector regression 8 passed |
| Real owner login → persistent relay → data in published page | NOT_RUN | No owner session available to this runner |
| Physical Fold6 and native desktop browser Ctrl+/- | NOT_RUN | Responsive Chromium, CDP pinch/page scale and CSS viewport tests only |

The initial real-payload US oracle failure counted the active unfinished daily bar; independently filtering to closed sessions resolves it. The initial provenance regression searched US symbols after the new KST default restored Korea; the test now inspects KOSPI. Neither was hidden as a product PASS without reproducing and correcting the test.

## Reproducible scoped commands

```sh
node tests/sector-series-runtime.test.cjs
node tests/dev-market.test.cjs
node tests/market-transport.test.cjs
node tests/market-context.test.cjs
node tests/transport.test.cjs
node tests/worker-relay.test.cjs
node tests/themes-runtime.test.cjs
node tests/market-data-v2.test.cjs
node tests/market-scenario.test.cjs
python -m unittest tests.test_worker_policy tests.test_market_relay
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_integration_958.py --output /workspace/output/integration-958-final
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_market_sector_recheck.py --area market --widths 1440
```

Public replay additionally uses `--public-feeds /tmp/myinvest-integration-958/public-feeds.json`. Payloads contain public prices only and remain outside git. Browser evidence is under `/workspace/output/integration-958-*`. CI includes the new synthetic integration script; it needs no provider or user secrets.

## Timing (measurement scope matters)

Synthetic first frame: market 320–331 ms, sectors 312–361 ms. Initial data ready: market 393–406 ms, sectors 341–390 ms. Two-frame render settling: 26–33 ms. Public captured-payload replay: market first frame 424–527 ms / initial data 473–641 ms; sectors 348–359 ms / initial data 460–491 ms; render settling 15–32 ms. These are local replay timings, not actual authenticated network end-to-end latency. Direct provider request median 153 ms, maximum 1591 ms (83 requests). Full performance optimization deferred.

## Remaining work / next assignee

Codex with owner browser authentication: confirm published KR day and 5/20/60 swing samples; US 11 ETF + SPY at 1/5/20/60; chart provenance and controls through the persistent relay. Capture only public counts/errors and elapsed times, no credentials or account responses. Physical Fold6/native zoom also needs owner-device confirmation. Existing futures/$TICK OHLCV and market-regime inference remain unconnected/unimplemented where disclosed; no substitute data was introduced. Orders: zero.
