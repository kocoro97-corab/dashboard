# Codex calendar integration review — 2026-11-23

Baseline: `4402848bd83e142999adfe6c5174a2765653ce67`, feature branch `feat/nh-integration-v2`.
Existing published frontend runtime: `aa39df95c9024f70bff71e2ba06ab3a10f294a14` (development Pages `175439ca0dab4ec4979c940b234387c6556da572`).

## Implementation and evidence

- Reused BLS/BEA/BOK/FOMC/earnings/calendar modules and calendar UI supplied on the feature branch.
- Corrected actual BLS `TZID=US-Eastern` compatibility; source fetch yielded 102 recognized events through 2026-12-15. BEA yielded 127 through 2027-12-22, BOK statistics 69 through 2026-12-29.
- Current public snapshots carry their actual retrieval timestamps. Historical entries are not future predictions. Missing times stay date-only.
- Fed and BOK meeting pages plus the Fed strategy-meeting amendment are parsed by `collect-policy-calendar.cjs`: 16 Fed meetings for 2026–27 and 8 BOK meetings for 2026, date-only. A fresh `policy-events.json` snapshot replaces the static list in browser consumers through `economic-policy-calendar.js`. Missing/stale data stays unavailable; BOK 2027 coverage remains unavailable.
- Reviewed fixed official NVIDIA/Samsung releases: two **historical** issuer-confirmed earnings announcements. No future earnings date is inferred. Source links are bound to NVDA and 005930 respectively; vendor estimates remain disabled.
- Snapshot export validates provenance, freshness and an explicit public-field allowlist before copying five exact filenames into Pages. It never copies `server/`, OAuth secrets, private manifests or holdings into calendar data.
- Cache expiry is enforced even when reading an existing in-memory snapshot without refreshing. Concurrent source fetches are joined; explicit force refresh remains available.
- Calendar closes clear Google display state. An ICS file read completing after close/logout cannot reinsert private events. Private Google/ICS events do not enter `invest-event-context`.
- Preserved existing published news, strategy comparator, diagnostics and one-hour development session by reusing the prior frontend modules and resolving only shared HTML/news/shell/strategy/sector integration. No GAS or relay change was imported.

## Regression failure diagnosis

The cited CI run 45118286473, and baseline HEAD run 45120592580, stopped at `browser_futures_display.py`, before reaching `browser_accounts_profile.py`. The dated futures fixture froze the browser clock but left the local Worker on the current date; its observation-age guard correctly refused the old quote. Reusing the already reviewed fixture clock fix makes the browser and Worker clocks agree; quote validation was not weakened.

`browser_accounts_profile.py` was run unchanged locally: all six test/management scenarios at 1440/344/690 passed. No account application logic was changed. Calendar `.test.js` scripts were previously outside the general `*.test.cjs` loop; full CI now includes both extensions on Node 22. Two hidden test issues were corrected: CommonJS Google-sync dependency setup and the BEA fail-closed expectation.

## Executed validation

- All `tests/*.test.cjs` and `tests/*.test.js` via Node; Python `unittest discover` (332 tests).
- `node scripts/calendar-release-audit.cjs --strict`: all five public snapshots present/fresh; implementation audit is not Google authentication proof.
- `tests/browser_calendar_final.py`: 1440/690/344, official public capture replay + synthetic auth. Popup layout, links, keyboard navigation, cache reuse, four-request force refresh, private ICS exclusion, route cleanup, logout and zero console errors.
- `tests/browser_futures_display.py`: three widths passed after fixture-clock correction.
- Full GitHub CI, development publication and public live readback are reported by commit/run SHA in the final task result. Physical Fold6 and real user Google OAuth remain NOT_RUN.

## Google and parallel candidate boundary

The existing Node OAuth service is retained. Private HTTP routing and injected Durable Object storage adapters were added; nonce consumption is atomic and token refresh uses compare-and-swap so revoke wins a refresh race. OAuth callbacks additionally require the same authenticated MY INVEST principal that began consent.

No OAuth credentials, AES keys, namespace, runtime settings or Google actions were provisioned in the existing Worker; `googleCalendarReadOnly` stays OFF. Real activation still needs a supported trusted runtime, private storage binding, authoritative stable user/session identity, HTTPS callback session binding, Google client/redirect/consent and secret-manager configuration. Existing public `sessionInfo` confirms validity but does **not** return a stable per-user principal; token syntax or a constant “owner” must not be substituted. Existing GAS/auth deployment was not changed to invent that identity.

Parallel PR #9 (`84825a939691f216a8364912b30aadf9e89af7e3`) was inspected and preserved without merging. Its direct-browser Google token model differs from this instruction's server-only token requirement. It is not silently enabled or substituted for the trusted backend plan; its separate calendar workspace is not part of this feature-branch release.

## Development-only refresh and release limits

The existing source collectors are retained as read-only CI artifact jobs, avoiding source-branch snapshot pushes. Their concurrency groups stay independent so all three jobs can run. `refresh-calendar-development.cjs` independently validates each source and retains previous bytes on collection failure. The manual source workflow creates a development frontend artifact without deployment credentials.

The development Pages repository's default branch is already **dev-pages**, independently of protected source **main**. A scheduled public-data refresh can therefore reside there without changing source main, production Pages, GAS or account stores. Its exact tested revision and actual run result are tracked in the final task result; no source-main schedule or operating scheduler is activated.

Operating deployment is not approved by this review. Future earnings coverage, backend Google setup, live user/device authentication and unattended refresh verification must remain distinct from synthetic PASS results. Actual NH/account/order calls and operating/account-store writes in this work: zero.

## Legacy manual-note ownership gate

An offline two-context reproduction confirms that `myinvest_events_manual_v1` is a browser-wide legacy key, independent of the authenticated session. Google/ICS session cleanup does not make these existing manual notes account-private. The UI now explicitly labels their shared-browser scope. No existing notes were read from a real browser, moved, assigned to a guessed owner, deleted or overwritten.

Account-private persistent manual notes are NOT complete: this requires the authoritative stable principal and a reviewed ownership/migration policy for unscoped existing records. Do not claim the overall multi-user calendar isolation gate passed based only on Google mocks. Real-account/backend configuration and legacy ownership decisions remain required before an operating release.
