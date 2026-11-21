# News / market / strategy isolated integration — 2026-11-21 KST

Integration validation: **PASS** for the synthetic tests below. Public 07:00 publication and actual owner/device verification remain **PARTIAL / NOT_RUN**. This is not a production release.

## Starting references and CI

| Reference | Latest checked HEAD | CI |
| --- | --- | --- |
| `feat/nh-integration-v2` / Draft PR #7 | `9f7efa1325387468312c6f99dc7b360ee2777091` | [44893655653](https://github.com/kocoro97-corab/dashboard/actions/runs/44893655653): PASS |
| `fix/news-briefing-panel-v1-ci` / Draft PR #8 | `56320d05d1f7efcdb585918e2c527102f3d71ba7` | [44913411233](https://github.com/kocoro97-corab/dashboard/actions/runs/44913411233): PASS |
| `feat/strategy-scenario-integration-isolated` | `ea38fa9ff63da70b6ec0be06f17be875059f9c8f` | [44912724652](https://github.com/kocoro97-corab/dashboard/actions/runs/44912724652): isolated route PASS; not a full integration-suite result |
| `feat/p4-strategy-evaluation-isolated` | `75db91f6b9e8a5052e39a8deb59fbf8eff8d6965` | No branch workflow run returned; NOT_RUN, not a failure |
| `dashboard-v2-dev/dev-pages` | `4c9f1f5d299b159c048f85db9173b3187c67952f` | Existing frontend from news source `56320d05`; not the integrated strategy candidate |

New isolated branch: **`integration/news-strategy-20261121`**, created directly from the latest PR #8 head. Existing worktrees and all original branches were preserved. PR #7 and PR #8 remain Draft/unmerged.

## Workflow safety before creating any PR

`pr-tests.yml` permits `nh-staging-live` on same-repository pull requests when `NH_STAGING_ENABLED == 'true'`, except named preparation branches. A new integration branch is not on that exception list. Therefore a new PR **could run actual staging calls/writes**, and **no new PR is opened**.

The integration branch is added as an exact **push** trigger for existing read-only regression CI. On a push event the NH job's mandatory `github.event_name == 'pull_request'` condition is false. No environment variable or secret is fetched to inspect the owner's setting. No bypass or permission enlargement is introduced. Production GAS workflows and the briefing preview remain manually triggered; none is dispatched.

## Dependency and conflict resolution

- Both candidates descend from `9f7efa13`. Their 34 news and 33 strategy changed paths have **no direct overlap** against that base. The important dependency integration point is `tools/build_dev_pages.py`: the news branch's builder matches the common development baseline, while the strategy candidate adds a small development-only script injection. Copying that addition must still preserve the news scripts discovered from the news branch's source index.
- The news branch's `index.html`, `js/page-news.js`, all five `news-briefing-*.js` modules and public collection/store tools remain byte-identical to PR #8. No whole-branch merge is used.
- The strategy candidate leaves source `index.html` unchanged. Its five optional scripts are inserted only into the generated development artifact, before `page-strategy.js`, in dependency order: evidence gate → session context → risk capacity → comparison model → comparison panel. Existing four news reader/archive scripts remain present exactly once before `page-news.js`.
- Original strategy calculations, shared stock selection, conditional analysis, holdings projection and market refresh are retained. The comparison is opt-in and manual; it receives neither app context nor holdings. It makes no API/storage call and is destroyed on collapse/route exit/logout.
- P4 diverges at `5e84f9f03a30e0ec65040fdb8e2b2f8c40c5e0d1`; comparison with news shows 37 news-only and 57 P4-only commits. P4 is reference-only. No P4 file/commit is imported or merged, and past-validation performance is not claimed.

### Selected files from the strategy candidate

24 files were selected; six standalone workflows and the unrelated market-quality diagnostic module/test/document were excluded.

| Files | Reason |
| --- | --- |
| `js/page-strategy.js` | Keep the existing page and add the supplied collapsed comparator/lifecycle wiring |
| `js/market-evidence-gate-v1.js`, `js/market-session-context-v1.js` | Pure validation and clock-context dependencies; do not certify exchange opening or quote truth |
| `js/strategy-risk-capacity-v1.js`, `js/strategy-scenario-compare-v1.js`, `js/strategy-scenario-compare-panel-v1.js` | Supplied pure/manual calculator and UI, preserved without calculation rewrites |
| `tools/build_dev_pages.py` | Development-only optional resource injection; production source index unchanged |
| `tools/inspect_market_session_context_v1.cjs`, `tools/inspect_strategy_risk_v1.cjs` | Offline CLI regressions, no provider/account access |
| `preview/strategy-scenario-compare-v1.html` | Existing standalone offline test page |
| `tests/market-evidence-gate-v1.test.cjs`, `tests/market-session-context-v1.test.cjs`, `tests/market-session-cli-v1.test.cjs`, `tests/strategy-risk-capacity-v1.test.cjs`, `tests/strategy-risk-cli-v1.test.cjs`, `tests/strategy-scenario-compare-v1.test.cjs` | Existing validation/calculation/CLI regressions |
| `tests/browser_strategy_scenario_compare_v1.py`, `tests/browser_strategy_compare_route_v1.py`, `tests/test_strategy_comparison_dev_bundle.py` | Existing offline preview, authenticated synthetic route and development-bundle tests |
| `docs/MARKET_EVIDENCE_GATE_V1.md`, `docs/MARKET_SESSION_CONTEXT_V1.md`, `docs/STRATEGY_RISK_CAPACITY_V1.md`, `docs/STRATEGY_SCENARIO_COMPARE_V1.md`, `docs/STRATEGY_SCENARIO_ROUTE_INTEGRATION_V1.md` | Original contracts and limitations |

Additional integration edits: `.github/workflows/pr-tests.yml` (exact push branch and synthetic browsers), `tests/browser_news_strategy_integration.py` (cross-page integration), extra news/order/preservation assertions in the imported dev-bundle test, and this report.

Source provenance check: 22 of the 24 selected files match the strategy candidate byte-for-byte. The two integration adjustments are the scoped style in `page-strategy.js` and added news-preservation assertions in `test_strategy_comparison_dev_bundle.py`. [Integration push CI runs](https://github.com/kocoro97-corab/dashboard/actions/workflows/pr-tests.yml?query=branch%3Aintegration%2Fnews-strategy-20261121) are separate from the baseline PR checks above; no new PR is involved.

### Reproduced integration defect and minimal fix

The app's existing `#appContainer header` grid rule also selected the embedded comparator's `<header>`. On 1440px the header was 1120px wide while its title was squeezed to 438.5px; the 344px screenshot showed nearly vertical text. The standalone preview did not expose this global-style collision.

`js/page-strategy.js` now adds only:

```css
#pageViewport .str4-compare-host .msc1 header { display: block; }
```

This stays inside the strategy integration host. The supplied comparison panel and all calculation modules are unchanged. A rendered-width regression checks that the heading spans at least 80% of its container at every tested width. Evidence: `header-collision-before.log`, `header-collision-before/1440-comparison-heading.png`, and `cross-browser-final/{1440,690,344}-comparison-heading.png`.

## Tests and evidence

Evidence root: `/workspace/output/news-strategy-20261121`. All sessions, market prices, public reports and news here are synthetic. No actual NH authentication, account, store, order or paid provider call is made.

| Check | Command / result |
| --- | --- |
| Full Node regressions | `for file in tests/*.test.cjs; do node "$file" || exit 1; done` — **628 PASS**, 64 files, 0 failures (`node-final.log`) |
| Python regressions | `python -m unittest discover -s tests -p 'test_*.py'` — **347 PASS**, 0 failures (`python.log`) |
| JS/GAS syntax | Existing `vm.Script` inspection — PASS; GAS files read for syntax only, not changed or called |
| Standalone comparison | `python tests/browser_strategy_scenario_compare_v1.py` — 1440 / 690 / 344px PASS (`strategy-preview.log`) |
| Existing strategy route | `python tests/browser_strategy_compare_route_v1.py` — three widths PASS; no extra relay requests, no app-storage changes (`strategy-route.log`) |
| News regression | `python tests/browser_news_final_v1.py` — three widths PASS: backup/import, last-good report, invalid/private JSON, route/logout cancellation (`news-browser.log`) |
| Prior final integration | `python tests/browser_final_integration.py` — nine industry/news/home scenarios PASS (`regression-browser.log`) |
| New cross-page test | `python tests/browser_news_strategy_integration.py --output /workspace/output/news-strategy-20261121/cross-browser-final` — three widths PASS (`cross-browser-final.log`) |

The cross-page test covers six menus, news → stock → strategy → stock identity preservation, comparison open/close/reset, invalid zero/negative/blank entry prices, fractional lot size, market/currency mismatch, separate USD labels, no comparison-triggered API calls, no horizontal overflow, unchanged local news archive, logout/relogin clearing selected stock and manual comparison input. Existing real-time/news/event/account regression checks are synthetic, not live-service certifications.

The first local Node run's CLI child processes were blocked by sandbox `EPERM`; the complete suite passed in the execution environment that allows local child processes. No application fix or weakened test assertion was used for that environment issue. The independent CSS collision above was reproduced and fixed as an actual integration defect.

Actual user login: **NOT_RUN**. Physical PC/Fold6 device checks: **NOT_RUN**. Chromium viewport tests are not physical-device results. Actual market API capture is **NOT_RUN in this integration task**; prior news capture evidence remains in the original report and is not represented as a new live test.

## Public briefing follow-up — unchanged publication boundary

Public JSON remains **unpublished**. The existing development frontend can display an explicit missing-file state and local manual archives. No synthetic report is shipped as real public data. No new scheduler, AI call, write permission or ChatGPT delivery is enabled.

| Topic | Existing capability | Remaining work / risk |
| --- | --- | --- |
| Public capture stability | Fixed Naver/Yahoo/FRED routes; two workers; 25s timeout; no redirects/retries; mandatory US close identity/date/price/change checks | Undocumented endpoints may change, throttle or stop. No guaranteed quota/SLA or redistribution rights were verified. Automated use needs source-terms review and agreed failure policy. |
| Holidays / shortened sessions | Weekend clock context; special holidays and early closes explicitly unverified | Need an official/appropriately licensed dated exchange calendar, provenance/version/expiry and exception handling. Clock windows never prove exchange opening. No assumed-open dates inserted. |
| US industry / sector data | Existing sector page has sector ETF and stock-theme sample analysis | Reuse existing adapters only after verifying response identity, date, units and sample coverage. ETF returns are not whole-industry/company-theme performance. Briefing collector does not yet consume this data. |
| Source terms / redistribution | Public GET access exists; no paid service or key is used | Reachability is not permission. Review Naver/Yahoo/FRED series-specific use, attribution, scheduled access and redistribution conditions before public publishing. No terms-compliance PASS claimed. |
| 07:00 recovery / duplicates | Existing local store locks, validates, atomically replaces, skips same-date/origin duplicates and preserves last good on failure; tests retained | Pick an approved public-only store/writer, ensure conditional commit/revision handling, notifications, last-good retention and delayed/holiday labeling. Same-day corrections require review; do not silently replace a report. Schedule and writer remain disabled. |
| ChatGPT vs independent reports | Existing origin metadata and UI distinguish `chatgpt-task`, `dashboard-pipeline`, manual; pipeline explicitly rule-based, actual AI false | External automatic ChatGPT delivery was not verified; do not access internal/undocumented account APIs. Local task text must be reviewed before explicit import/publication. |
| NYSE $TICK / official events | Missing states retained | No verified source; no value/event generated. |

Before any automatic publication: owner must approve the concrete public-only destination, repository-limited writer, source-use terms, calendar/failure behavior and schedule. 07:00 KST is 22:00 UTC on the previous date; GitHub scheduled execution can be delayed, so generated/observed/received times must remain explicit. No credential/account fields may enter a public report. Existing strict JSON/schema tests are retained; they do not replace human review of free text.

## Publication and next step

- Integration branch/code is separate from PR #7/#8 and the strategy/P4 candidates. No PR is created or merged.
- This task does **not** replace the current development site; it remains `4c9f1f5d...` / news source `56320d05...`. The integrated artifact is tested locally and in secret-free push CI, not presented as already live.
- Production `main`, `release/pages`, operating GAS/Sheets/Properties, authentication/NH logic and order code are unchanged. Actual NH/account/order calls: **0**. Operating changes: **0**.
- Next owner: **Codex** — review the integrated candidate for development publication, then proceed with source/calendar/public-store preparation within separately approved publication scope. Keep actual login/physical device checks separate. Broader redesign or P4 history integration remains a separate task.
