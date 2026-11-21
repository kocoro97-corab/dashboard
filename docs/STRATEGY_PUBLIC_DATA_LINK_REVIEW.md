# Strategy public-data connection — 2026-11-22 KST

## Implemented

The existing strategy selector and `InvestWorkflow.ensure()` public OHLCV adapter now feed the embedded comparator. No new provider route, authentication flow, model math, account query or order path is introduced.

- `js/strategy-market-link-v1.js`: projects only validated public fields; checks selected symbol, provider symbol, exchange, market/currency, ascending valid OHLC, last-bar reference, source and timestamps. Requires 60 bars, last bar at most four calendar days old and a response received within five minutes. These limits do not certify holidays, exchange opening, finalized closes or real-time prices.
- `js/page-strategy.js`: reuses the existing analysis request/cache and `InvestWorkflow.scenarios()`; publishes link state to the optional panel. Existing request-version/selection guards remain. A late prior-symbol response cannot replace the selected symbol. No account context is passed to the panel.
- `js/strategy-scenario-compare-panel-v1.js`: optional linked mode. Displays symbol, exchange, currency, public source, daily C value, bar timestamp and receipt time. Bar timestamps are identified as bar-start references; neither exact trade time nor finalized-session-close verification is claimed. Prices are not labelled real time.
- Linked mode has no synthetic capital or price defaults. Capital, cash, existing exposure and open risk start blank and are manually entered; changing currency clears these amounts rather than relabelling/converting them. Price edits are temporary and can explicitly reapply received conditions. Loading/error, new selection, collapse, route exit and logout clear appropriate transient state.
- Day entry may reference the received daily C value, but day stop/target stay blank: no intraday, VWAP, quote or trade stream is connected. Existing swing cases supply entry/stop/target; these remain conditional mathematical scenarios, not predicted prices or orders. Costs can make the model's reward/risk threshold fail and produce zero quantity; no target is altered to force a positive result.
- The standalone preview retains its clearly labelled synthetic example. The original strategy planner and all risk/comparison calculations remain unchanged.
- `tools/build_dev_pages.py`: adds only the new adapter script to the development bundle. Source `index.html`, auth/NH/transport, GAS and account storage remain untouched.

## Tests

- Full Node suite: **633 tests / 65 files PASS**. New adapter tests cover KR/US projection, wrong identity/currency/provider/exchange, unknown/future/stale timestamps, malformed/reversed/duplicate bars, bad cases, private-field omission and no mutation.
- Full Python suite: **347 PASS**. Development bundle test includes the new adapter in dependency order and still verifies preservation of news scripts and exclusion of public briefing JSON/server/CLI code.
- Existing standalone preview, strategy/no-selection route and news-stock-strategy integration tests are preserved; expectations for the embedded panel now require blank inputs instead of fake defaults.
- `tests/browser_strategy_market_link.py`: three widths (1440/690/344), KR→US switch, correct received price and original swing case, blank budgets, locked market/currency, no comparison-triggered requests, manual reapply, late-response rejection, bad-currency error clearing, route/logout cleanup.
- Read-only public capture succeeded for `005930.KS` (KRW/KSC) and `AAPL` (USD/NMS), using the same Yahoo daily chart paths as the existing stock page. Raw captures are local evidence only and are not committed or published as fixtures. Replaying these actual captures through the analysis/strategy path passed all three widths with synthetic authentication.

Commands:

```sh
for file in tests/*.test.cjs; do node "$file" || exit 1; done
python -m unittest discover -s tests -p 'test_*.py'
python tests/browser_strategy_market_link.py
python tests/browser_strategy_market_link.py --actual-dir /workspace/output/strategy-live-link-20261122/public-capture --output /workspace/output/strategy-live-link-20261122/actual-replay
python tests/browser_news_strategy_integration.py
python tests/browser_strategy_compare_route_v1.py
python tests/browser_strategy_scenario_compare_v1.py
```

Evidence: `/workspace/output/strategy-live-link-20261122/` (logs, source metadata and synthetic/actual-capture replay screenshots). Real captures prove provider access and projection of real public data, **not** an automated owner-authenticated Pages→relay session. Owner device confirmation of the newly linked page must be reported separately from the prior manual-preview confirmation.

## Deliberate remaining boundaries

- Actual NH authentication/accounts/orders: **0 calls** by this task. Cash/exposure/portfolio risk are not account-linked. No actual account values are copied, inferred or persisted.
- Intraday signals and automatic execution: **not connected**. The display is a public-data-informed hypothetical planner.
- Public briefing JSON, 07:00 publication, ChatGPT delivery, Worker settings and operating GAS/Sheets/Properties are unchanged. Existing missing-feed/JSON 503 issue is separate from these public stock chart paths.
- Source redistribution rights, split/dividend adjustments, session finalization, special holidays and provider latency remain unverified. Do not describe a daily bar's C value as certified real-time/current execution price.
- Work continues on the existing `integration/news-strategy-20261121` branch. No new PR is opened because a PR can trigger NH staging. Only secret-free push regression CI and development-only publication are intended; PR #7/#8 remain unmerged.

Next: Codex verifies the published page with the owner, then prepares the next data/briefing connection within the existing publication approval boundary. GPT retains ownership of broader strategy-design changes; no risk/signal formula was rewritten here.
