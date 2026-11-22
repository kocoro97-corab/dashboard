# Public intraday capability review — 2026-11-22 KST

Overall **PARTIAL**: source data exists for the tested symbols; live intraday integration is not activated. This task verifies capability, not signal accuracy or production readiness.

## Actual public-source results

Direct anonymous Yahoo chart GETs reused the existing public provider. Four fixed requests tested `005930.KS` and `AAPL`, `interval=1m/5m&range=1d`; one additional KR `5m/5d` request checked whether the final-window discrepancy persists across days. No redirects, retries, API keys, cookies, owner authentication, GAS/NH/account/order/AI calls or publication were used.

All four initial requests returned HTTP 200 with matching symbol, currency, exchange, timezone and `dataGranularity`. Snapshot observations are **2026-11-20**, fetched on **2026-11-22**; they are not Sunday live quotes.

| Symbol / source metadata | Interval | Raw points | Full bars after excluding final boundary point | Result |
| --- | --- | --- | --- | --- |
| Samsung `005930.KS`, KRW, KSC, Asia/Seoul | 1m | 361 | 360 | PARTIAL: source period/last point ends 15:00; separate quote time 15:30:05 |
| Samsung `005930.KS` | 5m | 73 | 72 | PARTIAL: same discrepancy, last usable bar starts 14:55 |
| Apple `AAPL`, USD, NMS, America/New_York | 1m | 391 | 390 | PASS for this source snapshot's schema and 09:30–16:00 provider period only |
| Apple `AAPL` | 5m | 79 | 78 | PASS for this source snapshot's schema and period only |

For KR, the provider's own regular-period metadata ends at 15:00, but `regularMarketTime` is 15:30:05. The 1d response's 15:00 endpoint has zero volume; it is a closing boundary point, not a complete new 15:00–15:05 bar. The 5d comparison shows 72 points ending 14:55 on November 16–19 and 73 points including the zero-volume 15:00 boundary on November 20. Thus a single delayed latest response does not explain the entire observed pattern. The dashboard's existing regular-session clock reference is 15:30. This mismatch must be resolved with an authoritative session/data source before claiming Korean full-session coverage. Do not fill the absent window, reinterpret it as confirmed delay, or substitute daily data.

For US, the 16:00 zero-volume boundary is likewise excluded; 390 one-minute or 78 five-minute bars remain. Source OHLC and bar volume were present for the sampled data. A source snapshot passing validation does **not** verify all tickers, shortened sessions, holidays, live-market latency, finalized bars, execution prices or trade-by-trade VWAP. `exchangeDataDelayedBy` was absent in the tested payloads. A two-second quote-to-boundary difference is not a certified two-second feed delay.

## Current relay boundary

- `relay/worker/worker.mjs` accepts daily/weekly/monthly Yahoo intervals only. `allowedMarketUrl()` returns false for all four tested intraday URLs.
- `relay/market_routes.py` has the same interval boundary; regression tests assert the intraday URLs remain rejected.
- No relay route, permission, feature flag, Worker code/deployment, GAS setting, secret or browser fallback was changed. Direct source diagnostics are **not** a replacement authenticated application path.
- Owner-authenticated Pages→relay→provider intraday retrieval: **NOT_RUN / NOT_CONNECTED**. The previous daily-data UI check does not certify intraday operation.
- Development site stays at `f717f1633a3b0fb596b07de039008866214a6ed1` (daily-link source `961aead93f13c6282cf19bc181c8e4e2da68c55f`). No new frontend publication is needed for this diagnostic-only task.

## Reproducible read-only diagnostic

Added `tools/probe_public_intraday_v1.py` and `tests/test_public_intraday_probe.py`. The CLI only supports the two exact symbols above, `1m/5m`, `range=1d`, two workers, 20s timeout and 2 MiB limit. Capture output requires a new directory. Replay inspects fixed local filenames; it does not activate application requests.

```sh
python3 tools/probe_public_intraday_v1.py --capture-dir /tmp/new-public-intraday-capture
python3 tools/probe_public_intraday_v1.py --inspect-dir /workspace/output/intraday-capability-20261122
python -m unittest discover -s tests -p test_public_intraday_probe.py
```

The existing capture was replayed rather than making more live calls. Validation covers identity/currency/timezone/granularity, strictly increasing nonfuture timestamps, OHLC arrays and prices, interval spacing/gaps, terminal points, missing vs zero volume and quote/session disagreement. Invalid prices/volume are never manufactured; source/session/realtime/VWAP certification flags remain false. No strategy, entry/stop/target or profitability formula is added.

Local tests: **11 new probe tests PASS; full Python suite 358 PASS**. Existing Node/runtime/browser source is unchanged; the normal secret-free push CI also runs the existing complete regression suite. No new PR is opened, and NH staging's push condition remains false.

Local evidence: `/workspace/output/intraday-capability-20261122/initial-results.json`, four raw public captures, `normalized.json`, `kr-5d-diagnostic.json`, `kr-5d-raw.json` and test logs. Raw market captures are not committed as fixtures or included in public briefing JSON.

## Concrete next connection boundary (not activated)

1. First limit a development candidate to **5m + range=1d**, exact existing Yahoo host/path, bounded stock identifiers, GET only and no extra/duplicate query fields. Do not grant arbitrary intervals/ranges/hosts, cookies, redirects or custom headers.
2. Reuse the existing authenticated public-market transport and session/origin/rate/size/concurrency controls. Never send a blocked request through a new browser/direct-server fallback. A current deployed Worker code change would require the existing owner deployment procedure; no new project/account/service or policy reset is needed.
3. Display historical/delayed/unverified status, symbol, exchange, currency, source, bar start/end and receipt time. Exclude terminal markers and incomplete bars. A reference chart can be separate from strategy signals; do not auto-generate day-trade signals merely because the API returns intraday data.
4. Keep Korean full-session/delay qualification PARTIAL until the 15:00/15:30 discrepancy is resolved. Treat AAPL as a tested sample, not evidence for every US ticker or all exchange calendars.
5. Bar OHLCV can support explicitly labelled bar-based estimates; it does not prove an actual trade VWAP, order book, executions, spread, liquidity or fillability. GPT should define any new signal/calculation contract after required input semantics are verified; Codex handles the adapter/transport/runtime verification.
6. Before changing the current relay allow-list, review the exact candidate scope and obtain the owner's authorization under the standing instruction against removing security blocks or expanding API permissions arbitrarily. Provider usage/redistribution conditions and documented limits still need review. No new paid API is authorized.

Next owner: **Codex** — investigate a complete Korean intraday source/session contract and prepare the narrow read-only five-minute integration candidate. Actual relay activation, intraday signals, account linkage and automatic 07:00 publication remain separate scope/approval items.

No PR created/merged; P4/source/news/runtime/auth/NH/account/order code untouched. Operating main/release/pages/GAS/Sheets/Properties and existing development publication unchanged. Actual NH/order calls: **0**.
