# MY INVEST V2 — Economic calendar ingestion (BLS v1)

## Implemented (development branch only)

Source: official BLS release calendar, `https://www.bls.gov/schedule/news_release/bls.ics`. This feed is published by the U.S. Bureau of Labor Statistics; it is an economic announcement **schedule**, not the actual economic result.

Data flow:

1. `scripts/collect-economic-calendar.cjs`: trusted Node 22 publisher fetches only this URL; fails and leaves the previous snapshot unchanged if HTTP/ICS/validation fails.
2. `js/economic-bls-parser.js`: recognizes CPI, Employment Situation (NFP), PPI, JOLTS and Employment Cost Index. Preserves source title, official source URL, retrieval time and publication datetime. America/New_York time is converted to Asia/Seoul with DST ambiguity rejection. No future dates or values are fabricated.
3. `data/economic-events.json`: only generated after the publisher completes successfully. This path is not populated with fake or synthetic dates.
4. `js/economic-calendar.js`: reads only the same-origin JSON snapshot; rejects snapshots older than 48 hours and any event with an invalid ID/date/source; uses a 15-minute in-memory fetch cache.
5. News/events calendar: displays verified announcements as colored badges and displays explicit '자료 미연결' when no fresh snapshot is accessible.
6. Strategy: displays the next 14 days of announcements with release-risk reminders; does not infer actual CPI/NFP, consensus estimates, directional effects or any trading orders.

A dedicated GitHub Action (`.github/workflows/economic-calendar.yml`) executes tests and attempts to fetch/publish on the **development branch** following relevant code changes or a manual dispatch. GitHub scheduled workflows only execute from the repository default branch: a recurring publisher for the development site requires a separately approved runtime/deployment arrangement. Do not claim unattended daily updates are active from this workflow alone.

BLS source: https://www.bls.gov/schedule/news_release/bls.ics
BLS schedule documentation: https://www.bls.gov/schedule/news_release/empsit.htm
Other candidate official sources (NOT implemented in v1):
- Federal Reserve FOMC calendar: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- BEA schedule / machine-readable data: https://www.bea.gov/news/schedule/icalendar
- Bank of Korea (Korean policy meetings) requires a separate verified official source and timezone contract.

## Validation and release conditions

Unit tests:
```sh
node tests/economic-bls-parser.test.js
node tests/economic-calendar.test.js
node tests/economic-collector.test.cjs
```

Before release, check real BLS ICS parse count, BLS 8:30 Eastern -> KST day conversion, weekend/DST boundaries, source outages (fail closed), snapshot presence in the dev site, PC/Fold6 calendar layout, existing 1st-party and NH read-only API regressions. The built-in calendar holidays and Google private events must stay independent; private calendar data may not be sent into strategy generation. Do not deploy to `main`, `release/pages`, operating GAS, Sheets or Properties without separate authorization.

Importance levels are **editorial risk classifications** (CPI / NFP critical, PPI / JOLTS / ECI high), not empirically validated predictions. FOMC / PCE / Bank of Korea and company earnings remain separate connectors. This scope is the economic events workstream only.
