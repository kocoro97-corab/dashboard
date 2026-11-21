# News / morning briefing integration review — 2026-11-21 KST

Overall: **PARTIAL**. Existing news, events, local archives and transfer modules are reused. Public-data capture, local composition/storage and PC/mobile rendering work. No automatic 07:00 delivery or publication has been enabled.

## Branch and CI baseline

- Existing branch: `fix/news-briefing-panel-v1-ci`; Draft PR [#8](https://github.com/kocoro97-corab/dashboard/pull/8), base `feat/nh-integration-v2`.
- Starting head: `cfe60e8e2b68e538c2bb43866b23f67bb4afbfdb`.
- Baseline CI runs [44909700441](https://github.com/kocoro97-corab/dashboard/actions/runs/44909700441) and [44909696603](https://github.com/kocoro97-corab/dashboard/actions/runs/44909696603): SUCCESS. Earlier failure 44909527712 was the Work browser fixture blocking the newly introduced same-origin static JSON GET.
- Fixture allowance now matches **only** GET `https://kocoro97-corab.github.io/dashboard-v2-dev/data/myinvest-public-briefings-v1.json`; other requests remain blocked. NH staging stays excluded for this branch.
- The first integration commit also exposed an old `browser_final_integration.py` assumption: the manual briefing must sit beside live news in two columns. New requirements instead put the shared report above news and manual history in a collapsed section. Reproduced failure at all three widths; updated only those layout assertions and explicitly opened history. Existing timestamp, saved-text scrolling, calendar focus, news-to-stock navigation and unrelated industry/home checks are retained. Evidence: `final-integration-before.log` / `final-integration-after.log`.

## Implemented changes

| Files | Purpose |
| --- | --- |
| `js/page-news.js` | Order: today's briefing → live news → holdings/watch news → collapsed history/import/backup → existing events. Preserve calendar links and existing news providers. |
| `js/news-briefing-public-feed-v1.js` | Shared report first, local fallback clearly identified; keep last good shared report on refresh error; explicit dates, missing observation times, stale reports and rule-only generation; timeout and lifecycle cleanup. |
| `js/news-briefing-panel-v1.js` | User confirmation before replacing an existing same-day record; cancel asynchronous imports after route exit/logout. |
| `js/news-briefing-archive-v1.js` | Reject source URLs with credential/account query parameters, including percent-encoded names. |
| `js/news-briefing-market-composer-v1.js` | Same-session US closes, separate price/market phases, daily-date-only Treasury data, weekend/unknown calendar state, cited industry samples; never invent $TICK or official events. |
| `tools/collect_public_briefing_v1.py` | On-demand fixed public endpoints, two concurrent requests, timeout, no retries/redirects/authentication. Cross-check four US closes against independently retrieved daily bars. |
| `tools/update_public_briefing_feed_v1.cjs` | Explicit local public-only update with lock, validation, atomic replacement, same-day idempotency and preservation of existing reports on failure. Never performs git/network/publication. |
| `.github/workflows/morning-briefing-preview.yml` | Manual-only collection/composition artifact preview, read-only repository permissions. No cron, repository write, Pages publish or deployment. Not dispatched. |
| `tests/*news*`, `tests/browser_public_briefing.py`, `tests/browser_app_shell.py`, `tests/browser_work_handoff.py`, `tests/public-briefing-store-v1.test.cjs`, `tests/test_public_briefing_collector.py`, `.github/workflows/pr-tests.yml` | New/updated regressions; final integrated news browser test included in CI. |

The old localStorage keys `myinvest_public_briefing_archive_v1` and `myinvest_public_ai_briefings_v1` remain. Reading shared reports never migrates, deletes or overwrites local history. Manual import and legacy migration remain explicit user actions. News body, company links and calendar behavior are reused, not rewritten.

## Actual public capture (not published)

Local evidence: `/workspace/output/news-briefing-20261121/final-live-snapshot.json`, `final-live-feed.json`, `final-live-collection.log`.

| Data | Actual result | Qualification |
| --- | --- | --- |
| S&P500, NASDAQ, Dow, SOX | PASS: four provider-labelled closes; Naver prices/changes checked against Yahoo daily bars and identical New York session date | Provider CLOSE is retained; independent exchange/delay certification is not asserted. |
| KOSPI, KOSDAQ, VIX | PASS: provider quotes and actual observation timestamps | Stale/missing times are rejected. Each market state is shown separately. |
| ES=F, NQ=F, YM=F | PASS: indicative futures prices and actual timestamps | Not regular-session index closes. Contract expiry, continuous-contract behavior and delay classification remain unverified. |
| USD/KRW | PASS: actual indicative quote and timestamp | Not certified real time; distinct from index close. |
| US Treasury 2y / 10y | PASS: FRED DGS2/DGS10 dated 2026-11-19 | Daily date only; exact observation time is **unknown**. Neither a midnight timestamp nor a real-time claim is fabricated. |
| Korean industry samples | PASS: six returned sample groups with changes and internally consistent breadth where available | Provider observation timestamp absent, explicitly unknown. Sample ≠ complete industry ranking. |
| US sector strength | NOT_CONNECTED in this briefing collector | Existing sector page remains available; ETF/group data is not invented here. |
| Official economic events / special holidays / early closes | NOT_CONNECTED / UNVERIFIED | Existing event calendar retained; no invented events or unverified holiday calendar. |
| NYSE $TICK | NOT_CONNECTED | No verified source; no value generated. |

Public routes: Naver stock polling and industry API; Yahoo Finance chart endpoint; `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2,DGS10`. No API key or paid service is used. These are publicly reachable endpoints, **not a finding that redistribution or scheduled use is licensed**. No provider SLA, guaranteed quota, delay classification or redistribution permission was verified. Requests can be rate-limited or endpoints changed. Automated/public redistribution requires terms review before activation.

Collector fails closed if a required US source, close identity, price, percent change, session date or timestamp is invalid. Optional missing quotes remain missing; they are never zero-filled. The age cutoff is 96 hours for timestamped quotes and four New York calendar days for daily rates; official exceptional closures still need a separate verified calendar. UI additionally warns on old observations. Weekends are calculated, special holidays are unknown rather than assumed open.

## 07:00 paths

**A — existing ChatGPT task:** read-only inspection confirmed the enabled daily 07:00 Asia/Seoul investment briefing task and a completed latest run. No schedule, prompt or result was changed. No supported automatic external result-delivery contract was verified. Existing manual input/JSON transfer can reuse reviewed text; private task output was not copied to a public file.

**B — independent dashboard draft:** fixed public capture → strict snapshot validation → existing rule composer → locked local public-only archive → same-origin news reader is implemented and exercised locally. The manual workflow only produces an artifact. It has no schedule or publication permissions. No actual AI model is invoked, and the UI says so.

Local review commands (new output file for capture):

```sh
python3 tools/collect_public_briefing_v1.py --output /tmp/reviewed-public-snapshot.json
node tools/update_public_briefing_feed_v1.cjs --source /tmp/reviewed-public-snapshot.json --store /tmp/myinvest-public-briefings-v1.json --ack-public
```

Running the second command again for the same date/origin returns `SKIPPED_DAILY_DUPLICATE` without replacing bytes. Invalid input, a busy lock, a changed store or an invalid/private store preserve the existing file. At 90 records the tool requires archive review; it does not silently delete history. Existing valid older reports survive collector/composer failures. A missing/current-date report is explicitly identified in the UI.

## Verification

All browser logins/providers below are synthetic; no real NH request is involved. The additional public-report replay uses a **real public capture** with synthetic authentication.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Node regressions | `for file in tests/*.test.cjs; do node "$file" || exit 1; done` (`node-final.log`) | 534 tests in 58 files PASS, 0 failures |
| JS/GAS syntax | `node` / `vm.Script` over `js/*.{js}` and `gas/*.{gs,js}` | PASS |
| Python regressions | `python -m unittest discover -s tests -p 'test_*.py'` (`python-final.log`) | 341 PASS |
| Collector regressions | `python -m unittest discover -s tests -p test_public_briefing_collector.py` | Included above: 9 PASS; synthetic providers |
| Local public store | `node tests/public-briefing-store-v1.test.cjs` | Included above: 6 PASS |
| Existing archive/feed/legacy UI | `tests/browser_news_briefing_panel_v1.py`, `browser_news_public_feed_v1.py`, `browser_public_briefing.py` | PASS at 1440 / 690 / 344px |
| Existing app shell/handoff | `tests/browser_app_shell.py`, `browser_work_handoff.py` | PASS at 1440 / 690 / 344px; no broad external allow-list added |
| Integrated UI | `tests/browser_news_final_v1.py --output /workspace/output/news-briefing-20261121/final-browser` | 3 widths PASS: ordering, no horizontal overflow, cancel same-day replacement, JSON download, private fields rejected, late import cancelled, route/logout cleanup |
| Existing final integration | `tests/browser_final_integration.py --output /workspace/output/news-briefing-20261121/final-integration-after` | Updated layout expectation only; see final log for nine industry/news/home scenarios |
| Actual capture replay | Above test with `--feed /workspace/output/news-briefing-20261121/final-live-feed.json` | 3 widths PASS; identical public report, explicit daily-rate time uncertainty |
| Independent public capture | `collect_public_briefing_v1.py` | 13 quotes, core cross-check PASS, no optional failures in this run; six industry samples |
| Local actual feed rerun | `update_public_briefing_feed_v1.cjs` | First local update PASS, duplicate SKIPPED; never published |

Screenshots: `final-browser/{1440,690,344}-news-final.png`, `actual-report-browser/{1440,690,344}-public-capture.png` under the evidence directory. These are Chromium viewport checks, not a physical Fold6 hardware certification. Public capture access does not prove a real owner-authenticated relay session. Browser fixtures for news/events/accounts are synthetic; production services were not contacted.

## Remaining work / next owner

1. **Codex:** review provider terms/quotas, add verified official calendar/event data and approved US-sector input; keep missing states explicit.
2. **Owner approval + Codex:** choose a public-only store and explicitly authorize daily publication, then implement schedule at 07:00 KST (22:00 UTC previous day), repository-limited writer permissions, last-good preservation and failure notifications. Do not activate simply by merging this PR.
3. **Codex + owner:** publish the reviewed frontend/report to the development site only, then verify owner login and the same report on PC and physical Fold6. Current on-site report availability is not claimed.
4. **ChatGPT:** later improve narrative/strategy quality using verified inputs. Rule-based sections are drafts, not actual model analysis.

This task changes no operating branch, GAS/Sheets/Properties, authentication logic, NH balance logic or order API. Actual NH authentication/account/order calls: **0**. Production changes: **0**. PR remains Draft/unmerged. No 07:00 scheduler or public report deployment has been activated.
