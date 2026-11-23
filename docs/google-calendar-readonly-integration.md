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
