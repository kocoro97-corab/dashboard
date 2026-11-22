# One-hour development session and AAPL follow-up — 2026-11-22 KST

The user explicitly requested one-hour development sessions so page testing can continue, followed by the pending AAPL five-minute integration checks. This authorizes the bounded development-session change; no operating authentication change or new API scope is introduced.

## Implementation

- Only the pinned isolated development Pages artifact replaces the reviewed browser `SESSION_MS=300000` with `3600000`. The existing production `js/auth.js`, operating `index.html` and all GAS files are untouched. Builds without a pinned relay retain five minutes.
- Development-only `js/dev_session.js` runs only on the exact development Pages origin/path with `devSession`, a matching pinned isolated relay and the one-hour timer. It wraps session start/logout to schedule/cancel a bounded check; it never intercepts the authentication decision.
- The existing GAS still has a five-minute server idle window and an eight-hour absolute maximum. While the browser is running, one authenticated `sessionInfo` check every two minutes keeps that server session active. No new backend route, token type, password replay, automatic re-login, bypass token, GAS deployment or Properties configuration change.
- Background checks do not update `invest_last_active`, reinitialize the dashboard, reset forms, or create user activity. The browser still logs out after one hour without actual activity. Manual logout cancels renewal and existing private-state cleanup runs unchanged.
- As the user clarified, this is the existing **sliding inactivity rule**: click, input, keyboard, wheel and touch activity reset the remaining time to a full hour. It is not a fixed one-hour login lifetime. The original `resetSessionTime` behavior is reused; automatic market refresh and session checks do not extend the user deadline.
- Server revocation, network/JSON/non-success responses, a 15-second check timeout and password-change requirements remain authoritative. A late old-session reply cannot affect a new login. The existing eight-hour server ceiling is unchanged.
- A suspended/closed browser cannot promise a keepalive: if the OS suspends JavaScript past the GAS idle window, the next request may require login even before the displayed hour. This is deliberately not hidden by fabricated session success. Fully independent one-hour server inactivity across device suspension would require a separately isolated server-policy deployment; none was performed.
- Only the existing authentication control endpoint is called (at most about 30 checks/hour while active). No NH quote/account/order or account-storage request is added.

## Validation

Actual production/GAS source remains byte unchanged. No real owner credentials were used.

- New Node tests run the unchanged GAS `securitySession_` against a controlled clock: survival past the five-minute server window, exact one-hour client inactivity, preserved eight-hour absolute cap, revocation, timeout/network/malformed response, password guard, logout cancellation, stale old-session reply, and operating-build exclusion.
- Development bundle regressions verify original five-minute source, one-hour pinned export, unchanged non-pinned export, script ordering and a fail-closed duration-marker check.
- Synthetic browser at 1440 / 690 / 344: 60:00 display, survival past six minutes, unchanged input and last-active values, reload, expiry/private-state cleanup, and no NH/order/write calls.
- Existing AAPL five-minute reference UI regression is rerun with the new session build. Source data and synthetic authentication are reported separately; a mocked login is not a live owner-session PASS.
- Full Node/Python and GitHub CI results, source SHA, development publication SHA and actual published-asset checks are recorded in the task result.

## AAPL activation follow-up

The exact approved AAPL/5m/1d implementation is already in source and the development reference panel. Worker code and its updater hash are unchanged in this session task. Rechecked environment variable presence only: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` remain absent. No values were printed or searched from private files. No actual Cloudflare activation was attempted.

A new read-only remote `appVersion` request returned HTTP 403 with a non-JSON refusal at `myinvest-v2-dev-relay.kocoro97.workers.dev`. This is an HTTP refusal at the relay-host request, not an unresolved development-page hostname. It does not prove a particular Worker/GAS cause or that activation succeeded. Owner-authenticated AAPL relay reception remains NOT_RUN. Existing direct Yahoo source capture verification is retained without relabeling it as a relay result.

Use the existing owner procedure in [FIVE_MINUTE_REFERENCE_ACTIVATION.md](FIVE_MINUTE_REFERENCE_ACTIVATION.md#worker-activation-procedure) from the owner's Cloud Shell. The prior activation approval persists; no repeated permission question or token-in-chat request is required. Run only the reviewed code-only updater; do not change settings, secrets, auth scopes, GAS or operating resources.

Next owner: **Codex** — confirm the owner's activation result and actual authenticated five-minute reception. The user can test the newly published development hour timer using the existing login; physical-device and uninterrupted real one-hour owner-session tests are NOT_RUN until observed.
