# MY INVEST V2 — BEA/FOMC economic calendar integration

## Public official sources

- **BEA**: `https://apps.bea.gov/API/signup/release_dates.json` (linked as Machine-Readable Format from `https://www.bea.gov/news/schedule/icalendar`). The feed supplies UTC-offset timestamps. It covers Gross Domestic Product (GDP), Personal Income and Outlays (including PCE measures), U.S. International Trade in Goods and Services, and Corporate Profits. No result, market consensus, or forecast is inferred from a scheduled time.
- **Federal Reserve FOMC**: `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` (2026/2027 meeting end dates), amended 2027 schedule `https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm`. FOMC dates are US-local **date-only**. The actual statement timestamp is NOT established by the meeting-day schedule and must NOT be fabricated.
- **2027 October 26–27 FOMC**: policy *strategy* discussion only, no usual interest-rate decision/statement anticipated. Mark as `FOMC_STRATEGY`, not `FOMC_DECISION`. The 2027 schedule is tentative and subject to official revision.

## Development modules

- `js/economic-bea-parser.js`: convert official BEA timestamped JSON into a bounded, KST-normalized event list. Deduplicate repeated release dates per indicator.
- `scripts/collect-bea-calendar.cjs`: trusted Node/CI fetcher; atomic dev snapshot write to `data/bea-events.json`; fail without replacing prior snapshot on upstream error. No secrets.
- `js/economic-bea-calendar.js`: same-origin snapshot reader; checks source, event identity, date consistency, source publisher and age (<72 hours). Stale or absent sources are reported unavailable.
- `js/economic-fomc-schedule.js`: manually verified 2026–2027 FOMC decision-date calendar, with 2027 October special-case. This is **not** a live Fed API and must be revalidated periodically.
- `js/page-news.js`: news calendar merges BLS, BEA, and FOMC events independently, without exposing private Google Calendar appointments to market strategy.
- `js/page-strategy.js`: next 14 calendar days of BLS/BEA scheduled announcements + date-only FOMC warnings; no fabricated timing or buy/sell orders.
- `.github/workflows/economic-bea.yml`: on relevant development-branch pushes or manual dispatch, run Node tests then collect a BEA snapshot. **No daily schedule is configured.** Does not modify production branch or operating GAS.

## Caveats and release gates

1. Real BEA endpoint fetch and resulting `data/bea-events.json` publication must be proven. If missing, the dashboard truthfully shows `BEA 미연결`.
2. Test real schedules through the development browser, including Fold6 and PC. Calendar event badge collisions and accessible labels require visual checks.
3. BEA `file_last_updated` is source publication metadata, not necessarily the collector fetch timestamp; downloaded snapshots have a separate `retrievedAt` used for freshness. A refreshed copy of an old source does not imply BEA has updated its schedule.
4. Verify no new Fed meeting date/revision before production release. The 2027 October meeting must never appear as a regular rate-decision event.
5. No automatic daily refresh is implied by branch-limited push / workflow_dispatch jobs. A permanently scheduled publisher would require a separately approved CI/runtime plan because GitHub scheduled workflows run from the default branch.
6. Existing NH and account APIs are unaffected; no production GAS/Sheets/Properties, `main` or `release/pages` changes permitted without approval.

## Tests

```sh
node tests/economic-bea-parser.test.js
node tests/economic-bea-calendar.test.js
node tests/economic-bea-collector.test.cjs
node tests/economic-fomc.test.js
```

Impact priority is editorial risk ranking (critical/high), **not** historical impact modeling, nor investment advice based on actual reported numbers.
