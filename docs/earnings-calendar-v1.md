# MY INVEST V2 — Company earnings event calendar, v1

**Status:** Development branch implementation. No issuer-reviewed production snapshot has been collected or published. The dashboard intentionally displays **공식 일정 데이터 미연결** rather than inventing upcoming earnings days.

## Sources and meaning

- **US:** SEC EDGAR official filings, https://www.sec.gov/search-filings/edgar-application-programming-interfaces . SEC submissions and XBRL record historic disclosures; they do **not** by themselves confirm a future earnings date. A date can be marked `confirmed` only when an issuer announcement identifies the release date and is independently reviewed.
- **KR:** Financial Supervisory Service OpenDART search and KRX disclosures, https://opendart.fss.or.kr/guide/main.do?apiGrpCd=DS001 . General corporate filings and generic IR events do **not** prove an earnings announcement; Korean IR rows require `earningsRelated:true` after actual content verification.
- **Estimated dates:** structurally separate `dateStatus:'estimated'`, `evidence:'vendor_estimate'`, displayed visibly as **예상·미확정**. Vendor redistribution requires explicit license approval in the trusted publisher input. This branch does not include a configured licensed vendor; therefore estimates are not automatically generated.
- **Official source links:** confirmed public snapshot URLs are restricted to SEC, DART and KRX. Arbitrary external hosts cannot impersonate official earnings announcements. Additional issuer IR domains require explicit source verification/allowlist review, not generic user-controlled URLs.

## Data flow

1. Trusted reviewer or approved source adapter obtains issuer's explicit future announcement with company symbol, quarter, disclosure URL and date/time. No source means no event. No private account information is sent upstream.
2. `scripts/build-earnings-snapshot.cjs /private/verified-earnings.json` validates every row, evidence freshness (48h), duplicate IDs, status and source. It rejects the **entire** batch if one row is invalid, and uses an atomic write only after full validation.
3. Output `data/earnings-events.json` is **public**, includes issuer facts only, and is never populated with portfolio, watchlists, account IDs, shares or investment returns. The data file is **not** present until validated input is available.
4. Browser module `js/earnings-calendar.js` reads only this same-origin public snapshot, validates source/status/date/freshness and caches successful reads for 15 minutes; older snapshots (>48h) fail closed.
5. `js/page-news.js` merges dated events with the existing market holiday / BLS / BEA / BOK / FOMC calendar. It differentiates 확정 vs 예상, highlights verified held or watched symbols **locally**, and adds clickable source links.
6. `js/page-strategy.js` shows the next 21 days for the selected stock, verified holdings and watch list. No private holdings are uploaded, persisted by earnings module, or used to trigger external search. Missing schedule never means zero earnings risk.

### Date & time basis

For explicit ISO UTC publication times, the browser validates the correct KST date. Date-only US issuer announcements preserve the US calendar date and label the timezone `America/New_York`; **no fabricated KST clock time**. For date-only Korean filings, use `Asia/Seoul`.

### Schema (illustration, NOT a real announcement)

```json
{
  "schemaVersion": 1,
  "source": "VERIFIED_EARNINGS",
  "retrievedAt": "2026-11-23T06:00:00.000Z",
  "events": [{
    "eventId": "EXAMPLE-REVIEW-1",
    "market": "US",
    "symbol": "ABCD",
    "name": "Example Issuer",
    "period": "2026 Q4",
    "eventType": "earnings",
    "date": "2026-11-25",
    "dateStatus": "confirmed",
    "evidence": "issuer_announcement",
    "sourceUrl": "https://www.sec.gov/Archives/edgar/data/123/example.html"
  }]
}
```

Do **not** publish the sample; the source and date are fictional. The private publisher input additionally requires `verifiedAt` for every row; the publisher removes it from the public JSON. For vendor estimates, publisher input also requires `licenseApproved:true` and a real approved vendor-origin URL. Because no such provider is configured, all estimated events are currently rejected.

## Tests

```sh
node tests/earnings-calendar.test.js
node tests/earnings-publisher.test.cjs
```

GitHub workflow `.github/workflows/earnings-calendar.yml` runs Node 22 source checks and unit tests on the development branch. It does **not** create any earnings data and does not change the production deployment. Run real publisher, browser and PC/Fold6 tests before any production merge.

## Remaining implementation gates (within approved plan)

- Connect an authorized official IR disclosure ingestion provider and verify real future earnings announcement documents for US/KR. SEC/OpenDART filing list by itself does not constitute a confirmed earnings date.
- For user-preferred estimates, evaluate license/terms of a reliable estimated-calendar provider and implement server-side adapter only after the relevant licensing/access configuration.
- Verify account-watch matching on actual read-only account snapshots without leaking private data.
- Run full Node tests, CI and PC/Fold6 browser regression. Confirm public snapshot is present on development site.
- No changes to `main`, `release/pages`, operating GAS, Sheets, Properties, OAuth or order permissions without separate approval.

## Security and trading-risk hardening

- The trusted publisher **selects only an explicit allowlist** of issuer fields. Arbitrary input fields such as `accountNumber`, `shares`, `apiToken`, `reviewerMemo` and verification credentials can never reach the public snapshot.
- Vendor estimates are currently **disabled**: no licensed/verified vendor provider or host is configured. The publisher enforces a license flag AND the browser rejects all estimated-source hosts until a real approved provider is implemented and reviewed. Official SEC/DART hosts are NOT accepted as the provenance for mere vendor estimates.
- A generic corporate IR notice is excluded unless the reviewer confirms it is about actual earnings (`earningsRelated:true`). Official filing *receipt* dates do not become earnings announcement dates.
- `MYInvestEarningsCalendar.assessRisk` is a display-only rule: 0–2 US/KR local days before a confirmed announcement for a day-trading check, or 0–14 days for a swing-trading check. Estimated dates remain unconfirmed regardless of proximity. The rule is not a probability, signal, or position-size recommendation.
- The News page’s calendar button and shell button both use the same cached snapshot refresh path; no extra source call is made merely by rendering the same calendar data in other menus.
- The source record must supply an explicit timestamp before the calendar uses a KST clock time. US date-only records remain US-local with an explicit label.

## Actual issuer evidence collected — 2026-11-23

`scripts/collect-earnings-official.cjs` retrieves two fixed public issuer releases:
NVIDIA fiscal 2027 Q3 (2026-11-17, US local date) and Samsung Electronics 2026 Q3 (2026-10-29, Korean date). The title, issuer's explicit “today reported” statement and published date are checked together. These are **historical reported releases**, not inferred future earnings dates or filing receipt dates. No release clock time is invented.

The allowlist is issuer-and-symbol bound: `nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-…` for NVDA and `news.samsung.com/global/samsung-electronics-announces-…-results` for 005930 only. SEC/DART/KRX support remains; estimates remain disabled. The publisher strips reviewer metadata and accepts no holdings input. Future-date company coverage and a wider issuer universe remain incomplete.
