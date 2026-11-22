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
