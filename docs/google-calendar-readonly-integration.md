# MY INVEST V2 — Google Calendar read-only integration contract

Status: **backend NOT connected**. Frontend does not receive OAuth access or refresh tokens. Existing dashboard login is not a Google identity assertion.

## Required before activation

1. Authenticate the user's Google identity with an authorization-code + PKCE flow (or server-confidential equivalent), explicit consent, CSRF state and user-to-session binding. Request only `https://www.googleapis.com/auth/calendar.readonly` (or a narrower suitable scope). Avoid write privileges.
2. On the trusted backend keep refresh/access tokens encrypted and server-only, separate from public GAS, Pages, browser localStorage and GitHub source. Restrict allowed origins, apply CSRF/cookie controls and enforce ownership of every calendar. Users must be able to revoke connection.
3. Implement only authorized read endpoints for calendar list and a given month. Never accept a Google account identifier or calendar ID from the caller as proof of access.
4. Return sanitized DTOs (example below) and enforce a maximum 30 calendars, 300 events for a month and request timeouts/rate limits. Time zones and all-day events must be converted to calendar date deliberately, not by browser UTC coercion. Handle multi-day events as explicit dates per desired business rule.
5. Explicitly attach a session-scoped provider after the backend passes authentication and capability checks:
   `MYInvestGoogleCalendarSync.connect({listCalendars: () => trustedClient.list(),listEvents: args => trustedClient.events(args)})`
   Do **not** configure a public anonymous endpoint or use `DashboardTransport.publicRead` for private calendar data.
6. Disconnect on logout or revoked consent; frontend does this on DashboardShell.stop. Do not mix personal calendar events into investment recommendations by default.

## Allowed DTOs

Calendar list:
```json
[{"id":"primary","name":"내 캘린더","primary":true}]
```

Events for request `{year:2026,month:11,calendarIds:["primary"]}`:
```json
[{"id":"provider-event-id","date":"2026-11-23","title":"개인 일정","calendarId":"primary"}]
```

No location, attendees, description, emails, organizer, conference links, credentials or raw API payload is needed by the dashboard. The frontend validates DTOs and keeps them in memory for 5 minutes. Calendar visibility settings are session-only.

## Current user experience

When no trusted adapter is connected, the calendar clearly says "미연결", performs **zero** Google Calendar API calls and retains the working local .ics import. When the adapter is connected, the user can sync a month and selectively hide calendar entries. This is **not** background polling: a manual request plus a five-minute cache. Continuous automatic updates should be added only after backend authentication and permissions are tested.

## Release gates

- Real backend OAuth handshake and revocation verified against a test account
- Read-only scope verified; create/update/delete operations absent
- No cross-user calendar leaks, no token in logs/URLs/HTML
- Cache isolation across logout, calendar switches and concurrent sessions
- PC / Fold6 visual smoke test and regression suite
- No changes to production GAS, Sheets or release branch without separate approval

## Frontend relay bridge (implemented, disabled by default)

Added:
- `js/calendar-google-auth.js` validates the trusted consent URL (Google accounts HTTPS, code flow, state, client_id and readonly scope), checks server-issued capability, attaches the provider only after verification and purges cache on revoke/logout.
- `js/calendar-google-transport.js` routes actions through the existing authenticated `DashboardTransport.post` **only** when a trusted relay config includes `googleCalendarReadOnly: true` and `mode: "relay"`.
- Calendar UI shows connect / confirm / disconnect controls only after an authenticated relay capability has been configured. Without that capability it remains disconnected; .ics import still works.

**Five exact relay actions required before activating the feature:**

| action | trusted backend response fields | rule |
|---|---|---|
| `googleCalendarStatus` | `{success:true,connected:boolean,readOnly:boolean,scopes:string[]}` | verify account bound to MY INVEST user and readonly consent |
| `googleCalendarBegin` | `{success:true,authorizationUrl:"https://accounts.google.com/o/oauth2/v2/auth?..."}` | backend generates CSRF state + PKCE challenge and stores authorization pending for same validated MY INVEST principal |
| `googleCalendarList` | `{success:true,calendars:[{id,name,primary}]}` | limit 30, no raw profile |
| `googleCalendarEvents` | `{success:true,events:[{id,date,title,calendarId}]}` | validate month and ownership of each requested calendar ID, max 300 |
| `googleCalendarRevoke` | `{success:true}` | unlink/revoke Google consent and destroy server secrets |

These actions must be implemented and explicitly allowlisted in the relay, not only on GAS. The relay must accept the site's authenticated session forwarded by DashboardTransport, but **not trust token format as proof of identity**. It must validate token against the authoritative MY INVEST session service before linking it to a Google principal. The callback must validate state and PKCE, exchange the code on the server only, and store tokens server-side using authenticated encryption under per-user keys. Use no token/PII in query strings or logs.

OAuth client ID, redirect URI, relay deployment and key-management configuration are **not provided**. Consequently no real OAuth token exchange or production Google Calendar fetch has been performed. Keep flag disabled until deployment/security gates pass.

Google provider API references:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list

## Standalone server implementation (development branch)

`server/google-calendar-oauth-service.cjs` implements an environment-independent service with:
- `service({verifySession,store,google,clientId,redirectUri,secretKey,now})`
- `handle(action,myInvestSessionToken,payload)` for exactly five read-only/link/unlink actions
- `callback({state,code})` for the Google redirect flow
- PKCE-S256 challenge, cryptographically random single-use state, 10-minute expiration
- AES-256-GCM encrypted pending verifier and Google tokens at rest
- stable user identifier derived only after `verifySession` checks an authoritative MY INVEST session
- server-side calendar membership checks (never trust requested IDs)
- token refresh and revoke, 30 calendars / 300 events caps

**Not included:** deployed session verifier, HTTPS OAuth callback HTTP endpoint, Google Cloud OAuth client credentials, persistent atomic storage, encryption key management, Google SDK/REST adapter, deployed relay action whitelist, domain callback registration, real-account end-to-end verification. These are required before flipping `googleCalendarReadOnly` on.

Required storage contract: `takePending` must be an atomic consume operation; do not implement as separate read-then-delete. `verifySession` must return a stable per-user ID only after verifying the MY INVEST session against its authoritative issuer. The private store must encrypt at rest and restrict service access in addition to the application-level AES encryption. Encrypt/rotate keys via a managed secret service; never use a hardcoded default.

This module has no listener, deployment configuration, user-facing Google credentials, or auto-activation. It is not a functioning hosted OAuth service until those dependencies are supplied and the release gates pass.

## Google provider adapter added

`server/google-calendar-google-api.cjs` provides dependency-injected HTTPS calls to Google's OAuth token/revoke endpoints and read-only `calendarList`/`events` endpoints. The event request uses `Asia/Seoul`, expands concrete recurrence instances with `singleEvents=true`, and normalizes date-time events into KST date-only DTOs. It requires a server-side OAuth client ID and client secret supplied by a secret manager.

Development tests:
- `node tests/calendar-oauth-backend.test.cjs`
- `node tests/calendar-google-api.test.cjs`
- `node tests/calendar-google-auth.test.js`
- `node tests/calendar-google-sync.test.js`

These tests are committed but **have not been run against a live Google account**. Server source/tests passed JavaScript syntax inspection; full Node test execution and CI outcomes remain to be verified in the actual repository runtime.

Deployment checklist: secret manager (client secret and AES-256 key), durable private KV with atomic one-shot state deletion, authoritative MY INVEST session verification, HTTPS callback route, server-side Google provider adapter, relay action allowlist, Google Cloud consent screen and permitted redirect URI, test Google account, revoke/refresh and cross-user isolation tests. Do not activate the existing `googleCalendarReadOnly` flag before every item passes.

## Codex runtime completion — 2026-11-23

- `server/google-calendar-http.cjs` provides the five exact action routes, same-origin allowlist, JSON-only bounded action contract, no-store replies and safe error codes. Its callback requires an authoritative MY INVEST session as well as one-use OAuth state. GET callbacks require the host's injected HttpOnly session resolver; absence fails closed.
- `server/google-calendar-durable-store.cjs` supplies atomic pending-state consumption/expiry and compare-and-swap encrypted account storage using injected private Durable Object storage. No binding or credentials are created by this module.
- The core callback now checks that the current MY INVEST principal matches the pending authorization. Token refresh cannot resurrect a linkage revoked concurrently.
- Tests cover cross-user reads/callbacks, replay/expiry, encryption, read-only actions, revocation/refresh races, disallowed origins and private-data exclusion. The HTTP and storage adapters are exercised offline.
- **Still not deployed:** authoritative session resolver/HTTPS host wiring, the private storage binding, Google OAuth client/redirect/consent and secret-manager credentials. The current public Worker has not been granted Google routes or modified. Existing backend deployment/configuration must be reviewed together with the real OAuth setup; real account tests remain NOT_RUN, feature flag OFF.
- Node modules use Node crypto and require a supported private runtime. No new paid service, namespace or runtime flag was provisioned.

## Follow-up: complete reads and activation boundary — 2026-11-23

The private Google adapter now follows event response pages, deduplicates event IDs and rejects incomplete pagination. It bounds reads to four pages, 30 calendars and 300 combined monthly events. Repeated tokens, failed later pages and limit overflow are errors, not successful partial calendars. The service checks the combined limit across selected calendars; no first-calendar-only success is returned. These are synthetic tests, not Google account verification. No backend has been deployed and the browser flag remains OFF.

### Concrete remaining activation scope for review

1. **Existing isolated development authentication only:** add a server-to-server authenticated identity response derived from the verified session's stable user record. The current public `sessionInfo` response has no stable principal. Do not use the submitted login name, `isAdmin`, token parsing, a browser assertion or a constant owner as identity. Do not return a Google token or raw account details. The source `gas/Security.gs` is evidence of this gap, not permission to deploy that file over the already-running isolated revision.
2. **Existing approved private runtime only:** wire the existing service/HTTP/storage adapters to that authority, private durable storage and secret management. Review runtime compatibility, the exact namespace/settings change and rollback before activation. No namespace, auth response, secret, GAS revision or Worker setting has been changed in this follow-up.
3. **Google real-account settings (separate approval required):** use an existing owner-selected Google Cloud project, read-only Calendar API, web OAuth client, exact reviewed HTTPS callback and test-user consent. Client secret/AES key/Google refresh tokens stay server-side. Determine the real callback URL from the reviewed private runtime; an example URL in a test is not a deployable configuration. Cookie/session association across the Google redirect must pass PC/mobile tests before enabling the flag.
4. **Legacy manual notes remain untouched:** the existing browser-wide key has no trustworthy owner. There is no automatic migration, deletion or inferred assignment in this plan. Present a separate reviewed user-claim/migration choice only after a stable identity is available. Do not advertise account-private manual notes until that decision and its isolation tests pass.
5. **Activation gates:** same-user OAuth callback, cross-user denial, no credential leakage, token refresh/revoke, multi-page/limit handling and logout cleanup, then explicit real-account consent. Publish development only after these checks; operating main/Pages/GAS/Sheets/Properties remain excluded.

The user explicitly reserves real-account credential setup and development-plan changes for separate approval. Approving this scope would authorize the isolated identity/runtime configuration work only; it would not authorize operating deployment, migration of existing notes, calendar writes, new paid services or NH calls. If the private owner environment is unavailable, report that limitation rather than exposing secrets through chat or adding them to this repository.

## Approved isolated identity/OAuth preparation — 2026-11-23

The user approved the isolated identity and Google read-only OAuth configuration scope after the follow-up review. Do not ask for that same approval again. Credentials and the owner Cloud Shell are not available in the current execution environment, so that approval is not a claim that a live deployment or user consent occurred.

### Implemented connection path (feature flag remains OFF)

- `tests/staging/CalendarIdentityBridge.gs`: opt-in private identity handler for the existing isolated GAS. It checks the existing project/Sheet binding, signed server request, request age, current session, password-reset state, approved user record and its existing Users.createdAt marker. A recreated login gets a different subject; a missing legacy creation marker is rejected for owner review rather than assigned a guessed identity. It returns only a domain-separated HMAC user subject and a short-lived signed assertion; no username, Google token or holdings. A separate stable subject key keeps user identity stable when the transport bridge key rotates. It changes no session policy, Users data, holdings or calendar.
- `server/google-calendar-session-authority.cjs`: consumes the existing verified GAS gateway (`verify` + `post`), validates isolated metadata, signs a fresh challenge and verifies its exact signed response. Public `sessionInfo` booleans/browser assertions are not identity. Signed replies cannot be replayed as another request/user or used after expiry. The private identity action is not added to the public relay allowlist.
- `server/google-calendar-runtime.cjs`: assembles the existing Google API, encrypted storage, session authority and HTTP adapters. It requires the existing private storage handle and keys as injected dependencies; it does not create a namespace, runtime or deployment. Actual existing Worker/DO host wiring, metadata update and supported Node crypto/runtime settings still need the owner-side configuration audit. Do not replace the active Worker with an old feature-branch Worker bundle.
- `server/google-calendar-callback-session.cjs`: a ten-minute AES-GCM authenticated HttpOnly/Secure/host-only callback cookie holds only the encrypted MY INVEST session. The actual MY INVEST session is checked again at OAuth callback, so logout invalidates a pending callback. No Google token is stored in the cookie.
- Consent begins with a user-initiated top-level POST to `https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/start`, then HTTP 303 to Google. This establishes the backend cookie without relying on third-party fetch cookies. Callback is `https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/callback`; after a verified callback the cookie is cleared and the user returns to the fixed development news page without a token/query payload.
- Existing connection buttons call this POST bootstrap. Only the fixed development artifact permits the two exact form destinations in CSP (backend start and Google consent); unconfigured artifacts keep `form-action 'none'`. Google feature remains OFF until live server configuration and read-only consent/isolation checks succeed.

### Owner-side preparation, not deployment

`tools/prepare_calendar_identity_overlay.py --owner-dir <existing-private-checkout> --output <new-private-directory-outside-checkouts>` prepares only `StagingBridge.gs`, `CalendarIdentityBridge.gs` and a review plan. It rejects the known production ID, mismatched source markers, output reuse and automatic repatching. It preserves the original bridge byte-for-byte except for one private dispatch line and leaves Security/session/other modules untouched. Original owner files are never modified. The output is private source (directory 0700/files 0600), never a public Pages artifact. It must not be uploaded before the active owner revision and module hashes are compared and existing revision/source metadata is updated through the approved owner procedure.

Private settings to configure only in the existing isolated environment:

| Setting | Destination | Handling |
| --- | --- | --- |
| `CALENDAR_IDENTITY_BRIDGE_KEY` | isolated GAS + private runtime | 32 random bytes, GAS value encoded as 64 lowercase hex characters; never send through chat |
| `CALENDAR_IDENTITY_USER_KEY` | isolated GAS only | separate stable 32-byte subject key; preserve across deployments; rotation requires explicit ownership migration planning |
| `CALENDAR_IDENTITY_ENABLED` | isolated GAS only | default absent/false; enable only with verified backend binding |
| Google web client ID/secret | private runtime secret/config manager | existing owner-selected Google Cloud project; only `calendar.readonly` |
| encryption key + existing storage handle | private runtime only | 32-byte server key; preserve existing token encryption identity and private store |

These setting names/values are **not registered** by writing this document or by exporting the frontend. The runtime's constructor accepts injected dependencies; mapping them into the existing Worker/DO and secret store must be audited against the actual owner deployment. Do not run the old full staging builder over the current one-hour-session deployment.

### Finding an existing Google OAuth client

Open https://console.cloud.google.com/apis/credentials and choose the existing project. Check **OAuth 2.0 Client IDs** (or Google Auth Platform → Clients) for type **Web application**. Do not create a new project/account or paste a client secret into chat. If there is no suitable client, use the approved read-only OAuth setup scope in that existing project, configure the exact callback above and owner test-user consent, then verify the private runtime before enabling the browser flag. An example or planned callback in a document is not proof that the endpoint is active.

### Executed verification boundaries

New unit tests execute the GAS handler against the server verifier, including Korean user identifiers, renewal stability, different users, disabled/unapproved sessions, proof/signature/tenant tampering, replay/expiry and key rotation. The assembled runtime completes synthetic consent with encrypted storage and clears its cookie. Logout-before-callback is rejected without invoking the Google adapter.

`browser_calendar_oauth_bootstrap.py` runs an **offline** browser at 1440/690/344. It checks the real exported CSP, actual form POST, same-site callback-cookie round trip, cookie cleanup and no session token in URLs. Synthetic HTML navigations replace mock HTTP redirects because browser interception does not reliably intercept every redirect-chain hop. Actual HTTP 303 contracts are separately tested in Node. Neither is real Google account consent or proof of the owner's mobile/browser policy.

## Named private settings contract — client created

`google-calendar-settings.cjs` and `calendarRuntimeFromSettings` now define the exact private setting names. They do not write any remote settings. The user has confirmed creation of the dedicated Google Cloud project and web OAuth client; creation is not proof that its secret is registered in the Worker or that the callback is live.

First owner-side registration step, in **the existing `myinvest-v2-dev-relay` Worker → Settings → Variables and Secrets**:

- `GOOGLE_CALENDAR_CLIENT_ID`: Google-issued web client ID, stored as Secret.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: Google-issued client secret, stored as Secret.

Do not paste either value/JSON into chat, a public repository or a Pages asset. If either setting already exists, do not blindly replace it. These two registrations alone cannot enable Google. Keep `GOOGLE_CALENDAR_ENABLED` absent/false while wiring/configuration/consent checks remain pending.

The approved private host must additionally supply the existing isolated metadata via `MYINVEST_EXPECTED_METADATA`, the matched private `CALENDAR_IDENTITY_BRIDGE_KEY` and persistent `GOOGLE_CALENDAR_ENCRYPTION_KEY` (each 32 bytes represented as 64 lowercase hex characters in secret settings), and injected authoritative gateway/private storage. No random key is generated or rotated implicitly. The settings reader returns null when the feature is off and emits only the fixed `CALENDAR_SETTINGS_INCOMPLETE` error when enabled settings are invalid. It never prints submitted values or enables a feature merely because secrets were registered. This wrapper does not by itself install the runtime into the active Worker/DO.

## Owner confirms two Google secrets registered — relay bridge and read-only preflight

The user reports `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` registered in the existing development Worker. They have not been read back by this environment; no secret value is requested in chat. Existing approval remains valid. The current environment still has no Cloudflare deployment credential or mounted owner checkout, so no remote deployment/configuration is claimed.

`server/google-calendar-relay-overlay.cjs` is an installable factory around an owner-verified **current** Worker module exposing `default`, `RelayGate`, `configuration` and `createGateway`. The deployment entry must import that preserved module and export the factory's `worker` default and `RelayGate` class. It must not import an outdated feature-branch Worker as a replacement for the active service.

The overlay:

- delegates existing routes unchanged and delegates everything when Google is OFF;
- enforces the fixed development origin/host, development-client header and bearer-only public API contract, then converts the verified-format bearer into the private runtime's body token internally;
- uses the existing `GATE` namespace and existing quota object's acquire/release protocol; the separate deterministic private object stores only prefixed encrypted calendar records, preserving quota storage;
- extends the existing `RelayGate` class for private requests and otherwise calls its existing fetch implementation, with no namespace creation or migration;
- bounds OAuth form size and GAS verification deadline, releases leases on failure and never returns private exception text;
- advertises `developmentGoogleCalendarReadOnly` only from an installed, enabled overlay with valid isolated settings. `dev_connect.js` accepts that capability only for the fixed persistent development endpoint; absence keeps Google OFF;
- bounds the revocation request so an unreachable Google endpoint cannot leave connection removal waiting indefinitely.

Factory/legacy integration and bearer conversion are tested with the actual DashboardTransport and the existing Worker handler plus synthetic authentication/network. This is not proof of the active Cloudflare module graph, real Node compatibility or actual owner consent. Bundling, current-code verification, Node compatibility, authoritative GAS extension, private key binding and provider-side concurrency checks remain owner-side activation gates.

### Standalone owner preflight

`tools/calendar_owner_preflight.py` uses only Python's standard library. It accepts the **existing Cloudflare** Account ID/API token via hidden terminal prompts (or existing environment), never the Google secret. It reads only the fixed existing account/subdomain and Worker's settings, deployments and version list. Its only public relay request is `appVersion`, which makes no NH/account/Google query. It repeats the deployment read to detect concurrent changes. It never writes settings, secrets, source, private stores or deployment versions.

The JSON reports secret **names/presence only**, the active version, pending-version status, existing `GATE` class, Node compatibility, hour policy and whether the known owner checkout can be verified locally. It prints no account ID, token, credential, raw binding values or source. `readyForActivation` stays false even when the inspection succeeds; an inspection PASS is not Google connection PASS. A blocked read reports only a fixed code/HTTP status.

The user can run a pinned public copy in the existing Cloud Shell without relying on the current directory being a Git repository. Return only the resulting JSON, never credential values. The script cannot activate the connection; use its blockers to prepare the exact existing-runtime configuration/bundle and GAS metadata update before activation.
