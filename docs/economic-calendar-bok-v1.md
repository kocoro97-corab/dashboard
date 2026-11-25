# MY INVEST V2 — Korean economic calendar / BOK v1

## Verified official sources

- Monetary Policy Committee (MPC) policy decision meeting dates in **2026**: https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A&syear=2026
  - 2026-01-15, 02-26, 04-10, 05-28, 07-16, 08-27, 10-22, 11-26.
  - Publication **hour is unconfirmed**. These are date-only events; do not invent a KST release time.
  - No 2027 dates are populated by the module until the actual 2027 schedule is verified.
- BOK official monthly statistics public release schedule: https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775&year=2026
  - The time in this table is the public media release time in **Asia/Seoul**. It may differ from the time the statistic appears in ECOS.
  - Source may be revised by BOK; refresh and validate before relying on it for trading.
  - Covered types: real GDP, Balance of Payments, PPI, Consumer Sentiment, Business/ESI, Import/Export Price, National Income.

## Development flow

`js/economic-bok-policy.js` provides the year-specific 2026 MPC date-only entries independent of third-party APIs.

`scripts/collect-bok-calendar.cjs` fetches the public BOK HTML page in a trusted Node/CI environment. `js/economic-bok-stats-parser.js` recognizes only valid publication TABLE rows with official date, clock time and known subject category. KST time is converted to UTC once for consistent international strategy comparison. The collector refuses to replace data if the source is inaccessible, malformed, empty or contains too few recognized rows (20 minimum). No guessed dates.

On successful validation, the collector atomically writes `data/bok-stats-events.json`; `js/economic-bok-stats-calendar.js` reads this **same-origin public snapshot** only. It checks source, time consistency, duplicate IDs and age (<=72 hours). Without a fresh published snapshot, the UI reports **한국은행 통계 미연결**.

`js/page-news.js` merges BLS, BEA, Fed FOMC, BOK MPC and BOK statistical announcements, with their time basis and source labels. `js/page-strategy.js` presents a read-only 14-day event-risk summary. There are no orders, consensus forecasts, actual indicator values or directional predictions.

GitHub CI: `.github/workflows/economic-bok.yml` runs tests and attempts a BOK source refresh on relevant development changes or manual dispatch, with write permissions limited to the development branch. **No scheduled daily execution is enabled**: GitHub scheduled workflows run from the default branch, and production remains untouched.

## Limitations and release gates

- The Korean Statistics Office (Statistics Korea) CPI and jobs schedule is NOT included in this BOK-specific stage. These indicators need their own official release schedule source.
- BOK HTML parser is intentionally fail-closed and sensitive to official website table changes. A source change requires parser update and validation, not silent scraping of unverified values.
- Official BOK page access, publishing to the development site, PC/Fold6 visual regressions and actual 2026 year-end date coverage require separate confirmation from real CI/job output.
- No personal Google calendar events, financial accounts, tokens or NH account data are collected by these public feeds.
- Do not modify production `main`, `release/pages`, GAS, Sheets or Properties without explicit approval.

Tests:
```sh
node tests/economic-bok-parser.test.js
node tests/economic-bok-calendar.test.js
node tests/economic-bok-collector.test.cjs
```
