# MY INVEST V2 — Investment Calendar synchronization contract (development only)

Status: **NOT DEPLOYED**. Existing GAS, Sheets, Google Calendar and credentials must not be modified or replaced without a reviewed migration and live validation. The currently connected Calendar interface cannot create a secondary calendar; create `MY INVEST` in Google Calendar settings and supply its ID before enabling writes.

## Storage ownership
- **Google Calendar:** authoritative event date/time, title, description, and notification; only the dedicated MY INVEST calendar may be written.
- **Existing GAS + separate Sheets tabs:** event registry, approval rules, explicit user rejections, tombstones for deletions, audit trail, sync cursor and recovery journal. Use existing authenticated deployment; do not store OAuth tokens in Sheets or the browser.
- **Browser:** temporary manual events and UI cache only; `js/invest-calendar-policy.js` is a deterministic local preview, **not** an authorization to write to Calendar. Local decisions do not authorize server auto-creation.

## Proposed tab schemas (append-only audit)
- `InvestEvents`: event_key, provider, event_type, symbol, occurrence_date, timezone, start_at, end_at, source_url, verified_at, source_hash, google_calendar_id, google_event_id, status, revision, last_synced_at.
- `InvestRules`: rule_id, provider, event_type, symbol_scope, approved_by, approved_at, enabled, min_source_confidence, last_reviewed_at, version.
- `InvestDecisions`: decision_id, event_key, rule_id, decision (approve/reject/delete/disable-rule), actor, decided_at, reason, revision.
- `InvestAudit`: audit_id, request_id, event_key, action, before_hash, after_hash, outcome, actor, occurred_at, error_code.
- `InvestSync`: cursor_name, cursor_value, updated_at, lease_owner, lease_until, last_success_at.

## Server-side invariants
1. No calendar write unless the MY INVEST calendar ID has been explicitly configured and access verified.
2. Use stable event key = publisher + event_type + symbol_scope + occurrence_date; reconcile Google event IDs before creating. Source publication updates do not create duplicate events.
3. **New or uncertain event => pending approval.** Auto-create only when a matching server-side rule was explicitly approved, verified source and date are present, and no negative/tombstone decision applies.
4. Explicit rejection/deletion wins over positive family rules. Never recreate a deleted occurrence without a fresh explicit approval.
5. Do not infer recurring consent from a single approved occurrence; a separate `approve-rule` decision is required.
6. Every create/update/delete operation must be idempotent with request_id, revision check and audit record. Re-read before modifying external events. Fail closed on timeout/partial state.
7. Sync Google Calendar deletions back into tombstones before future news discovery. Never modify unrelated primary-calendar events.
8. On conflict or missing event provenance, queue for human review. No stock trading/order permission is introduced.
9. Protect privacy: event description may contain public ticker and source only, **never account numbers, position sizes, cost basis, credentials or private holdings**.
10. Implement bounded polling and quotas; verify external publication dates against primary official sources. Store UTC timestamps plus IANA timezone, display Asia/Seoul.

## Proposed GAS endpoints (not implemented/deployed)
- `GET investCalendarState`: authorized calendar metadata, next events, pending approvals, sync state; paginated.
- `POST investCalendarDecision`: event_key + action + expected_revision + idempotency_key; authenticated.
- `POST investCalendarSync`: scheduled server job; verify sources, read existing Google events, apply approved rules and append audit.
- `GET investCalendarAudit`: audit history and tombstones; read-only.

## Release gate
Backup current GAS/Sheets configuration and confirm no production writes. Add synthetic unit tests for duplicate events, previously deleted occurrences, changed date, recurrence, stale data, and concurrency. Test browser on PC/Fold6, then Google Calendar read-only against the dedicated calendar, then a separately approved test event. Production enablement requires explicit approval after test results.
