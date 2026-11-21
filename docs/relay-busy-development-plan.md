# Development relay busy recovery — 2026-11-21 KST

Scope: dashboard feature branch and existing isolated development Worker only. No operating GAS v26/Sheets/Properties, credentials, account records, quota increases or actual NH API calls.

## Evidence and limits

- Start source/Pages provenance: `5e84f9f03a30e0ec65040fdb8e2b2f8c40c5e0d1`; pre-change development Pages `72b4277ed2445c5857a029950587e3aed855bc24`.
- Public Worker metadata read: HTTP 200, persistent profile, public market and industry capability true. This is not a user login, exact Cloudflare script-version ID or historical incident log.
- Runtime has no bound Cloudflare credential/outbound identity. GitHub integration cannot read Actions secret names (HTTP 403). No attempt to retrieve secret values. Cloudflare live metrics, active version ID and incident-time leases remain NOT_RUN.
- The exact source Gate returns 503 when four leases are held. Serialized real-Gate simulation: nine simultaneous reads => four successes/five `RELAY_BUSY`, all admitted leases released. This reproduces the code-level failure mechanism; it does not prove the cause of the owner's 12:30:50 incident without server evidence.
- Previously the getTxt-only queue admitted three persistent reads while other transport callers/protected reads bypassed it. A failed public read retried after 200 ms. Browser abort also does not imply immediate server lease release.

## Frontend correction

- Shared relay-read queue at DashboardTransport: at most two persistent / one temporary physical read, bounded waiting queue, same public URL pending join. Authentication and reviewed writes retain their existing one-shot path and never acquire automatic retry.
- Rapid country switch reproduction: starting in US swing 5d, switch to KR while SPY is pending. Previously no KR history request started after completion. The sector loader now compares its captured visible selection key when finishing (including MIX), and schedules the current view. The new Chromium reproduction passes.
- Endpoint, session and page generation are captured. Departed queued work is rejected; already-started reads keep their physical budget until their response completes so navigation cannot immediately multiply upstream leases. Page context invalidates unfinished jobs while retaining completed cache entries.
- Read-only transient recovery: at most three attempts, exponential 1s/2s plus jitter, valid Retry-After seconds/date honored. Long hints fail without retrying early. Permission/isolation failures never retry. Backoff uses a shared monotonic pause; canceled backoff does not issue new requests.
- Deadline starts after queue admission. Legacy getTxt concurrency wrapper removed. Failed quote refresh retains its old price/receipt and marks it as previous data; the home policy does not treat it as current market-regime evidence.
- Tests retain actual auth, CORS, isolation and write-outcome checks. Browser fixture Gate transactions now serialize like the actual Durable Object.

## Worker code candidate — NOT DEPLOYED, separate approval required

Only `relay/worker/worker.mjs` changes:

1. Public `publicFetch` gets one 25-second deadline covering metadata verification, GAS session validation, redirects and supplier wait. It also bounds an already-pending shared metadata proof. Lease release remains in finally; late work cannot start a supplier call after the deadline.
2. Gate busy returns Retry-After 5 seconds; rate limit returns 60 seconds. Retry-After is exposed to the existing allowed CORS origin. Gate capacity remains 4; per-IP/global/login quotas, origin checks, allowlists and session checks remain intact.
3. Public metadata adds `developmentReadResilienceVersion:1` to permit feature readback. No GAS source/manifest or secret values change.

No Worker deployment, environment-variable/secret update, logging setting change or migration has been performed. Existing deploy tools that bulk-write secrets must not be used for this code-only proposal.

### Approved rollout procedure (only after owner approval and CI PASS)

- In the existing authorized owner Cloudflare environment, read the current active version of **myinvest-v2-dev-relay**, and verify its isolated role/name. Record the actual active version ID privately before mutation; it is currently unknown in this assistant environment.
- Save the current module/version, then upload only the reviewed worker.mjs module while preserving policy.json, existing bindings, secrets, compatibility settings and Durable Object state. Do not create a Worker/project/account or apply migrations. Do not enable logging or alter permission scopes as a side effect.
- Verify appVersion still has the same GAS isolation identity/capabilities and now the resilience marker. Public-origin checks and synthetic pressure verification must remain correct; no NH/account/store calls are part of activation.
- If readback or required checks fail, immediately roll the same Worker back to the captured active version using its existing Cloudflare version history. Recheck old metadata/connection. Do not reset the Gate, Sheets or existing user data. Source/Pages rollback uses a new revert commit on dev-pages to the above pre-change content; never force-push.
- Exact Worker-version verification and historical 503 analytics require existing owner read access; do not assume that source tests establish live deployment success.

## Current verification

- Real-Gate nine-request reproduction and 32-read corrected load: PASS (synthetic upstream); no corrected-load 503, no lost reads/leaked leases; maximum physical reads two.
- Duplicate joins, auth capacity, queued cancellation, endpoint/session affinity, three-attempt bound, Retry-After/date/jitter, no replay of writes/auth, isolation-error non-retry, timeout/finally release: automated regressions.
- New browser busy-injection/native flows: 1440/690/344, 12 PASS with synthetic GAS and provider responses. Records per-phase request counts and timings without credentials. Retained failed quote uses original observation/receipt and explicit old-data label.
- Persistent Worker session/login/reload/logout browser regression: 3 PASS (synthetic). Industry/theme-stock-strategy: 15 PASS (synthetic). Sector controls/dates/equities: 18 PASS (synthetic). Physical Fold6 and actual owner session are NOT_RUN.
- Actual public capture: 65 successful payloads (58 Yahoo histories plus Naver data), one Daum futures HTTP 403, no retry/bypass. This is provider-direct reception, not authenticated relay reception. Actual NH calls 0. Independent public-response Chromium replay: US equity themes 1/5/20/60 returns and SPY-relative values PASS at all three widths; all 11 ETF return/relative values and theme → analysis → strategy provenance/1R/2R/reload PASS at all three widths. Strict public-only fixture mode was used for the latter (no synthetic price fallback). KR public replay confirms 79 industry rates/breadth and one received top theme with one rankable 5/20/60 sample row; uncollected member responses remain unavailable, not synthetic. These use synthetic login and cannot establish live authenticated relay success.

No frontend publication before required CI PASS. Worker code candidate needs separate owner approval even if frontend/CI pass.

## Owner approval and code-only runner

Owner approved the above code-only rollout in chat. This assistant environment still
has no Cloudflare credential binding or access to the owner's Cloud Shell.
Public metadata remains HTTP 200 with no resilience marker; no actual upload has
been attempted here.

`tools/worker_code_only.py` is the owner-run path for this already-approved update.
It uses only Python standard-library HTTPS calls. Account ID and the existing token
are read from the owner environment or a local hidden token prompt, never command
arguments or chat. It requires the existing Worker/role/subdomain/GATE and one
100% active version. A split deployment is refused.

- Source and unchanged policy hashes are pinned to the reviewed candidate. The
  JSON policy is embedded locally; no npm installation or external build is needed.
- A mode-0600 rollback record is saved in `$HOME/.myinvest-worker-rollback/` before
  upload. All binding names (including secrets and GATE) use Cloudflare `inherit`
  pinned to that exact active version, with `bindings_inherit=strict`.
- The versions API uploads a candidate without activation. The runner rechecks
  deployment/settings for concurrent changes before the deployment API switches
  100% to it. No PUT/PATCH/DELETE/settings/secret/migration/plan API is used.
- Compatibility and usage model are preserved. Exact settings, isolated metadata,
  capability values and the marker/CORS exposure are checked after activation.
  Failure restores the captured version and verifies it. A third party's newer
  deployment is never overwritten, and rollback never uses `force`.
- Cloudflare API access requires the existing account's Worker script read/edit
  permissions. API/metadata failures emit only fixed codes and numeric HTTP
  status; they never print response bodies, tokens or account details.
- Twelve synthetic regressions cover pinned inheritance, preservation, rollback,
  uncertain activation, concurrent updates, preflight refusals and private files.
  These are not evidence of a successful Cloudflare upload. Actual owner execution
  is still required; real NH/account/order/store calls remain zero.

The owner command extracts only the runner and reviewed code/policy from a pinned,
CI-passing source commit into a temporary directory using `git archive`. It does
not merge/reset/stash or change the owner's working tree. The private rollback
record survives temporary directory cleanup. Do not use the older
`nh_v2_persistent.py` deploy command for this code-only scope: it bulk-writes secrets.

### Owner HTTP 400 follow-up

The owner reported `CLOUDFLARE_REQUEST_REJECTED` HTTP 400 from the first runner.
That result did not include a request stage or provider code, so it cannot establish
whether the rejection was a read preflight or candidate upload. Do not diagnose it
as token expiry or claim a successful upload/activation.

The runner now includes a fixed `requestStage`, numeric `providerCodes`, and fixed
`providerHints` categories for a rejected API call. Raw Cloudflare messages, URLs,
submitted source/configuration and credentials remain excluded. `--diagnose` runs
only the existing Worker/version read preflight, without checkpoint/upload/activation.
The actual candidate Worker and policy hashes, binding inheritance, activation and
rollback behavior are unchanged. Added privacy/read-only regressions pass locally;
live rejection detail still requires owner execution in the credential-bearing shell.
