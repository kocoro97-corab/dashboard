# Approved AAPL five-minute reference integration — 2026-11-22 KST

Status: code integration and local tests PASS; actual Worker activation / owner-authenticated live data NOT_RUN. This supersedes the disabled-candidate status in `FIVE_MINUTE_CANDIDATE_REVIEW.md`; its raw-source findings remain valid.

## Authorization and scope

The user answered “네” to the explicit request to allow AAPL / five-minute / latest one-day reads through the existing authenticated development relay and connect a reference chart. Applied the previously reviewed `proposals/aapl-five-minute-reference.patch` to active development source. That historical patch is retained as evidence, not a second patch to apply.

Only this exact URL is newly allowed:

`https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m&range=1d`

Other symbols, Korean intraday requests, intervals, ranges, query variants, redirects and hosts remain outside the pilot. No settings, secrets, bindings, GAS, auth/account/order code or relay policy configuration is changed. Actual NH/account/order calls and account-store writes: 0. No new PR, branch or merge.

## Development UI

`#/strategy` → **AAPL 5분봉 참고 차트 · 최근 1일** → **AAPL 5분봉 조회**.

- Collapsed and idle initially; opening alone does not request data. No polling, retries or fallback.
- Each explicit read first checks existing `appVersion` for isolated staging metadata, public-market capability and `developmentFiveMinuteReferenceVersion: 1`. An old Worker displays an inactive connection message and makes zero intraday requests.
- Uses only `DashboardTransport.publicRead`, its current bearer session, read budget and cancellation behavior. No token in URL or source request; no new credential input.
- Renders validated close values in USD with source, provider window, bar-start time and adapter receipt time. Source collection time is explicitly unknown. No real-time, official session/calendar, price finalization or trade-VWAP claim.
- Existing parser excludes terminal markers and unfinished bars. Result does not enter the daily-analysis cache, calculator inputs or strategy signals.
- Close, route navigation, session cancellation and unmount invalidate responses and clear chart data. The reference remains explicitly AAPL regardless of another daily selection.
- Only `build_dev_pages.py` injects these optional scripts; operating `index.html` is unchanged.

## Worker activation procedure

`tools/worker_code_only.py` is the existing owner-run code-only updater. Its pinned Worker digest is updated to the exact reviewed source. A successful readback must now include the new capability marker as well as the existing resilience marker; otherwise its existing concurrency-safe recovery applies. Settings/secrets writes remain zero; no new Worker or GAS deployment.

Current Codex environment reports `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` **ABSENT** (values were not read or printed). No Cloudflare upload/activation was attempted. Existing owner Cloud Shell can run the tool on this reviewed revision using its hidden token prompt; credentials must not be pasted into chat. No renewed permission request is needed for this approved scope.

Example preserving the current checkout and uncommitted work, from the user's existing `/home/kocoro97/myinvest-v2-fresh-private-r2` repository:

```sh
cd /home/kocoro97/myinvest-v2-fresh-private-r2
git fetch origin integration/news-strategy-20261121
review_dir=$(mktemp -d /tmp/myinvest-five-minute.XXXXXX)
git worktree add --detach "$review_dir" FETCH_HEAD
if python3 "$review_dir/tools/worker_code_only.py" --diagnose; then
  python3 "$review_dir/tools/worker_code_only.py"
fi
```

The detached checkout creates no new branch. Stop if the read-only diagnosis is not PASS; do not change permissions, create projects or override concurrent-change errors. Account ID and API token are prompted privately if not already configured. Do not execute the activation line after a failed diagnosis.

## Verification and limits

- Node suite: 643 PASS; Python suite: 362 PASS (includes new missing-capability-marker recovery test).
- Worker security / candidate tests: 28 Node PASS. Narrow relay contract, code-only updater and development bundle: 47 Python PASS, included in full suite.
- Synthetic browser at 1440 / 690 / 344: explicit read, no auto request, missing server capability with zero reads, invalid currency refusal, delayed response after navigation, logout, close and no overflow PASS.
- Previously captured real Yahoo AAPL response replayed through synthetic authentication and the real local Worker handler at all three widths: PASS. This is not a new live or owner-session result.
- Existing daily strategy market-link browser regression at all three widths: PASS.
- A new direct public Yahoo GET during this task returned HTTP 200 and 78 validated AAPL five-minute bars. This is source reachability, not authenticated relay verification; raw data is local only.
- Actual remote relay `appVersion` probe from this execution environment: HTTP 403, both before and after adding the required development-client header. This is a relay-host HTTP refusal, not developer-page DNS failure. No authenticated public read was attempted. Do not infer Worker activation or a particular Cloudflare/GAS fault from this response.
- Development Pages publication and final CI result are reported separately in the task result; an exported page alone does not certify live relay activation.

The first CI run (45004555608) hit the existing futures display test’s clock mismatch: the browser was frozen at November 18 while the local synthetic Worker used wall time past the quote’s four-day age limit. The bridge now accepts an explicit synthetic-futures-only fixed clock matching that browser date. All three futures widths pass after this test-only fix; production freshness, contract and clock validation were unchanged.

Evidence (local, not public fixtures): `/workspace/output/five-minute-activation-20261122/`. Existing source captures remain outside the repository. No automatic 07:00 publication, paid API or production change.

Next owner: **Codex** — verify owner-run activation marker, then actual authenticated reference read and owner-device behavior. Korean session-aware adapter remains a separate qualification task; do not stitch Yahoo and NAVER bars or invent intraday signals.
