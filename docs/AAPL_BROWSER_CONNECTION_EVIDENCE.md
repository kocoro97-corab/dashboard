# AAPL reference connection evidence — 2026-11-22 KST

Status update, November 23: the user supplied a browser-observed **PASS** report from source `b217c806b683`, HTTP 200, 78 validated AAPL/USD five-minute bars and full provider-window coverage. Independent transport verification, real-time verification and signal readiness remain false. Scoped NH/account/order calls are zero. This confirms the reported reference reception, not every market feed or a current live-market price. The earlier environment/activation observations below are historical. Existing AAPL/5m/1d approval persists; no relay permission, Worker, authentication, GAS, account, order or session-rule change is required.

## User flow

1. Log into `https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/diagnostics`.
2. Expand **AAPL 5분봉 참고 차트 · 최근 1일**.
3. Click **AAPL 5분봉 조회**.
4. Click **연결 결과 복사** and share that JSON for follow-up. If clipboard access is blocked, the page exposes a read-only, selectable **공유용 연결 결과** field. No DevTools, snippet or credential sharing is needed.

The copy action does not trigger another source request. Closing, route/session cancellation and logout clear the report and disable copying. Source or metadata responses arriving after an invalidation cannot overwrite the new request's HTTP evidence.

## Meaning and privacy

- `mode: BROWSER_OBSERVED_AAPL_5M_REFERENCE` limits the result to what this browser observed. `independentTransportVerification: false` is always explicit. A copied PASS is not an independent audit, an owner identity attestation, or certification of real-time prices.
- PASS/PARTIAL requires the approved capability and parsed AAPL/USD reference data. Partial coverage remains PARTIAL. Real-time and signal verification stay false.
- An absent capability is **NOT_RUN / RELAY_CAPABILITY_REQUIRED**, with zero intraday requests. A denied or unsuccessful metadata response is **FAIL / CAPABILITY_REQUEST_FAILED**, rather than being mislabeled as an inactive feature. Wrong isolation metadata is a separate failure.
- Public-read failures and source identity/currency/time/OHLCV failures have separate phases. HTTP codes are copied only as integers 100–599; diagnostic codes come from a fixed local list.
- JSON includes only fixed instrument/source labels, status/phase/code, source-build revision, adapter check time, bar count, last bar-start time and adapter receipt time. It excludes prices, OHLCV arrays, account identity, holdings, user ID, session/token, endpoint URLs, request headers, credentials, provider error text and raw responses.
- Zero NH/account/order counts are explicitly scoped to **THIS_REFERENCE_CHECK_ONLY**, not unrelated operations elsewhere in the app. No private-state storage or automatic publication is added.
- Pure evidence construction rejects optimistic PASS/PARTIAL without valid parsed data and server capability. Optional unknown fields and private error strings cannot enter the copied object.

## Environment and remaining activation boundary

The managed environment status was current for the selected machine: unrestricted network policy enforced, with no configured secrets or runtime variables. Shell presence checks also found no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; values were not read or printed.

Following the managed networking guidance, a normal-sandbox request could not confirm the connection; the same credential-free `appVersion` request outside that sandbox returned HTTP 403. The known proxy-denial category was unconfirmed. This is not evidence that the user's browser or the Worker is globally broken. No DNS, proxy, TLS, host or security settings were bypassed or changed. No repeated source/login attempt, Cloudflare activation, real NH call or paid API call was made.

Existing source and development remote HEADs were checked before editing. Prior actual Yahoo source evidence remains distinct from authenticated relay verification. The owner was asked whether the existing Worker activation procedure had been executed; no permission expansion is requested again. If activation is still needed, use only [the previously approved owner code-only procedure](FIVE_MINUTE_REFERENCE_ACTIVATION.md#worker-activation-procedure).

## Validation

- Six new Node evidence tests: successful/partial reference reporting, missing capability, invalid source data, invalid HTTP/build fields and injection of private error/URL/token/holding fields.
- Synthetic browser tests at 1440/690/344 cover clipboard success and fallback, no extra fetch on copy, report clearing, source currency failure, missing capability with zero reads, JSON HTTP 403 and non-JSON HTTP 502 failures without private-string leakage, late responses, navigation and logout.
- Captured real public-data replay and actual published assets are identified separately from synthetic auth and live relay checks.
- Full CI and publication status / SHAs are reported in the task result. No new PR or branch and no operating deployment/merge.

Next owner: **Codex** — retain the user-reported reference PASS separately from independent verification, and verify explicit execution states in the dedicated diagnostics menu. Other dedicated check collectors remain unconnected unless actually instrumented; do not turn them into automatic PASS or automatically issue account/storage calls.
