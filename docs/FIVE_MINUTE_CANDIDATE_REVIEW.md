# Five-minute read candidate and Korean source comparison — 2026-11-22 KST

Historical status (before user activation approval; superseded by [approved integration](FIVE_MINUTE_REFERENCE_ACTIVATION.md)): **candidate implemented and disabled; Korean source qualification PARTIAL**. No active relay permission, application page, Worker configuration or development publication changes.

## Korean late-session comparison

The KRX regular-session reference remains 09:00–15:30; the official guide also distinguishes the 16:00–20:00 after-market. The official page was discoverable through its indexed content, but direct fetch returned 403, so this is not certification of exceptional trading schedules on November 20.

Primary references:

- [KRX trading-hour rules](https://regulation.krx.co.kr/contents/RGL/03/03010100/RGL03010100T1.jsp)
- [KRX trading hours / holidays](https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T1.jsp)
- [Naver Samsung chart](https://m.stock.naver.com/fchart/domestic/stock/005930)

The existing Naver public stock page linked that chart, whose published client asset was `https://financial-vn.pstatic.net/client-chart/mobile/live/4.3.41/js/chartiq.js`. Inspection, without executing it, established the actual domestic five-minute request shape. One anonymous GET to:

```text
https://api.stock.naver.com/chart/domestic/item/005930/minute5?startDateTime=202611200000&endDateTime=202611202359&wrapper=true
```

returned HTTP 200. No login, consent bypass, cookie or token was used; there were no retries or guessed endpoint scans. The proprietary chart asset was inspected locally, not copied into the repository or reused as application code.

Observed November 20 facts:

| Item | Observation |
| --- | --- |
| Naver venue | Wrapper explicitly says `stockExchangeType: KRX` |
| Naver wrapper period | 09:00–20:00; therefore not a regular-session-only feed |
| Naver points | 129, first 09:00, last 19:55; 77 clock-reference rows through 15:30 and 48 at/after 16:00 |
| Late regular clock references | 15:00, 15:05, 15:10, 15:15 and 15:30 present; 15:20/15:25 absent, not zero-filled or interpreted as ordinary missing five-minute candles |
| Yahoo sampled endpoint | Declared period / terminal point ends 15:00, zero-volume terminal C value 183100 |
| Naver 15:00 / 15:30 price values | 182600 / 183100 respectively |
| Closing comparison | Yahoo quote and terminal C equal Naver's 15:30 value, despite Yahoo terminal timestamp 15:00. This is an observed equality, not proof of the provider's internal timestamping cause. Do not shift the whole series by 30 minutes. |
| Same-timestamp, nonzero Yahoo-volume pairs | 71 pairs; 68 matching C values, only 11 matching volume values |

This establishes a separate late-session source, not permission to stitch it into Yahoo data. Bar timestamp convention, venue coverage, auction/after-market events and aggregation semantics still need an explicit contract. In particular, a 15:30 closing event must not automatically become a full 15:30–15:35 regular-session candle. Naver's field is named `accumulatedTradingVolume`, but observed values are not monotone; do not treat it as a day-cumulative counter or assume equivalence to Yahoo bar volume without further validation.

All 129 sampled Naver rows had positive internally consistent OHLC and nonnegative numeric volume; no SDK-style repair of zero prices was applied. The wrapper does **not** echo stock code or currency. A future adapter must bind the exact request URL, verified listing, exchange and currency; an isolated body is not proof of instrument identity. Access to the endpoint does not establish redistribution or scheduled-use rights.

Evidence: `/workspace/output/intraday-candidate-20261122/` contains the public page/script captures, raw Naver response, `kr-source-comparison.json` and `kr-closing-point-comparison.json`. Prior Yahoo captures remain under `/workspace/output/intraday-capability-20261122/`. No real market snapshots or third-party library source are committed as fixtures or deployed.

## Narrow, disabled read candidate

`js/five-minute-read-candidate-v1.js` implements a reusable candidate without importing it into the page, build or relay:

- Only the exact AAPL `interval=5m&range=1d` URI is proposed. No other symbol, interval, host, query, alias or redirect target is granted. Korean requests return `KR_SESSION_WINDOW_UNRESOLVED`; other US symbols are outside this pilot, not declared unsupported by their provider.
- Default capability is false; no transport call can occur without an explicitly supplied existing authenticated transport and a strict true capability callback. This callback is an activation contract, **not** a substitute for server authorization. Existing relay URL/session/origin/rate/size checks remain authoritative and unchanged.
- No direct `fetch`, browser fallback, credentials, storage, account context, order, polling or retry is implemented. Concurrent reads coalesce. Invalidation, destruction, and capability revocation discard late responses without leaking raw errors.
- Parser validates AAPL/USD/NMS/New York/EQUITY/5m, source period, ascending nonfuture timestamps, session-anchored five-minute grid, full OHLCV arrays and numeric values. It excludes zero-volume terminal markers and unclosed bars; invalid/missing data is rejected rather than manufactured.
- Output uses a separate `data.kind`, `instrument` and `candles` contract, deliberately lacking the daily-analysis `symbol` / `bars` top-level shape. It must not be put in the daily `InvestWorkflow` cache.
- Receipt time means adapter receipt, including a possible transport cache. Provider fetch time is unknown, not fabricated. Full provider-window observation is separate from official calendar, real-time, finalization and trade-VWAP verification; all such verification/signal/order flags stay false.
- The existing AAPL capture replay yields 78 usable candles with one terminal point excluded. This is a local captured-response replay, not owner-authenticated live relay verification.

`tests/five-minute-read-candidate-v1.test.cjs` covers these boundaries with synthetic data (including capability revocation and no-fallback errors). The development export regression explicitly excludes this candidate file, so normal website users cannot accidentally activate it through the current build. Existing `allowedMarketUrl` and `allowed_market_url` still deny the proposed intraday URI.

## Review-only activation patch (not applied)

`proposals/aapl-five-minute-reference.patch` is the concrete proposed change, separate from active code. It adds only the exact canonical AAPL/5m/1d URI to the Worker and matching legacy Python helper; query reordering/encoding, other symbols, 1m, longer ranges, extra fields, fragments and other hosts remain outside the pilot. The Worker proposal advertises `developmentFiveMinuteReferenceVersion: 1` only when its existing public-market profile is enabled; otherwise 0. No environment setting, secret, upstream GAS binding, authentication condition, rate/concurrency limit or order permission changes.

`git apply --check proposals/aapl-five-minute-reference.patch` passed. `tests/test_five_minute_candidate_patch.py` applies it **only in a temporary copied tree**, runs the existing Worker security suite there and checks the proposed scope, absent bearer refusal, normal authenticated access, public-market-off refusal, source-session revocation and no token forwarding. It separately proves the actual Python helper still rejects the URI. These are mock/local tests, not a live relay activation or owner-session result.

Local validation: **10 new reader tests; full Node 643 PASS; full Python 361 PASS**. The reader and patch are not in the development artifact. Actual owner intraday access remains NOT_RUN.

The first push CI run (44971211247) exposed an existing asynchronous JSON-import test race at 344px: `set_input_files()` returned before the panel's awaited `File.text()` completed. `browser_news_briefing_panel_v1.py` now waits for the success/rejection UI before checking content or preserved storage, and deliberately delays file reads to exercise this ordering. The corrected test passes at 1440/690/344px; no news runtime code was changed.

Commands:

```sh
node tests/five-minute-read-candidate-v1.test.cjs
git apply --check proposals/aapl-five-minute-reference.patch
python -m unittest discover -s tests -p test_five_minute_candidate_patch.py
python -m unittest discover -s tests -p test_strategy_comparison_dev_bundle.py
python -m unittest discover -s tests -p 'test_*.py'
```

## Activation boundary / next work

This branch contains an inspectable reference reader, not an activated feature. Before actual integration:

1. Review the exact AAPL / five-minute / one-day request, provider-use conditions and unchanged auth/security controls. A live relay allow-list or Worker change still requires authorization under the standing instruction against arbitrarily removing security blocks or expanding API permissions.
2. Wire only an explicit server-approved capability into the existing authenticated public transport, then run owner-session tests before exposing a development reference chart. No direct-source fallback or automatic day-trade signal is permitted.
3. Keep Korean data separate until venue, request/listing identity, regular/closing/after-market segmentation, time convention and volume semantics are verified. Do not use NAVER to silently fill Yahoo's absent period.
4. Only then can GPT define a new intraday analysis/signal contract for Codex to integrate. No new strategy formula was invented in this task.

The daily-link development site remains commit `f717f1633a3b0fb596b07de039008866214a6ed1`, source `961aead93f13c6282cf19bc181c8e4e2da68c55f`. Actual owner intraday session/device verification: NOT_RUN. Main/release/pages, operating GAS/Sheets/Properties, authentication/account/order logic, Worker/live allow-list and 07:00 publication unchanged. Actual NH/order calls: **0**. No new PR opened or existing PR merged.

Next owner: **Codex** — finalize the source/approval contract for the bounded five-minute reference integration and the separate Korean session-aware adapter.
