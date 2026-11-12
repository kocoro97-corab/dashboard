# MY INVEST NH Integration V2

**Current follow-up:** [V2_LIVE_OWNER.md](V2_LIVE_OWNER.md) supersedes the fixed-test
application commands below. Existing test GAS/Sheets must now remain unchanged;
use a newly created project/Sheet. Native real-account snapshots are opt-in,
fresh-development-only; the original 6e23b3b source did not support this flow.

Baseline: `d99b9a06c52ffd43b644b306d8c8b96bb1da3188`.
One development PR. No main merge, production publish, operational data migration,
or real NH execution is performed by this change.

## Architecture and compatibility

- `gas/NhGatewayV2.gs`: dependency-injected transport, exact request registry,
  private token cache and bounded 401 refresh. All NH traffic uses this boundary.
- `gas/NhAccountsV2.gs`: domestic/overseas pagination and normalization, null-safe
  accounting, explicit capabilities and domestic/overseas stock quotes.
- `gas/AccountStoreV2.gs`: user-scoped append-only snapshot journal with optimistic
  revisions, durable prepare verification, commit markers and restore as a new commit.
- `gas/Nhplug.gs` and `gas/ExternalHoldings.gs`: existing action/function adapters.
  Existing futures calculations, existing validated field names and OCR/KRX review
  remain. The old broad transport, token loader, balance mapper and destructive
  delete/rewrite/rollback store are replaced, not used as fallback implementations.
- `js/market.js`: existing account cards/table with session-scoped account merging.
  Failed market results retain the last values with a visible stale label; successful
  empty balances remain empty. Partial pages retain omitted prior rows as stale.
- `js/external_accounts.js`: stale/partial NH values cannot supply fresh OCR prices
  or masquerade as complete integrated totals. Missing values remain unconfirmed.
  No changes to news, market indicators, charts, analysis, or OCR recognition.

Existing actions stay: `nhAccounts`, `nhQuotes`, `nhExternalQuotes`,
`externalHoldings`, `saveExternalHoldings`, `externalHistory`,
`restoreExternalHoldings`. Existing `holdings`, `revision`, `storeVersion: 2`,
`accounts[].domestic/overseas`, quote and error fields stay compatible.
`nhStockQuotes` adds market-qualified stock quotes (`DOMESTIC` / `OVERSEAS`).
`gatewayVersion: 2` and `storeEngine: account-store-v2` identify the new engine.
The store protocol number is unchanged; revision values are opaque and have new
values after every commit, including restore (no ABA reuse).

An authenticated account response intentionally contains the holdings needed to
render the owner's dashboard. API credentials, full account numbers, account
suffixes, token metadata, vendor raw bodies and vendor errors are never returned
as diagnostics. Account correlation keys hash the account number with the current
session token; keys differ between sessions. The browser clears data on logout.

## Read-only request registry

Source of truth: the exact tuples in `NhGatewayV2.gs`.

| HTTPS origin | Exact path | Method | Purpose / authentication |
|---|---|---|---|
| `https://api.nhplug.com:8443` | `/oauth2/token` | POST | Token; internally encoded appkey/appsecretkey/grant_type/scope query, empty form body |
| same API origin | `/n2/acctinfo` | POST | Account list; bearer header |
| same API origin | `/krstock/inquiry/v1/balance` | POST | Domestic balance; bearer header |
| same API origin | `/gbstock/inquiry/v1/balance` | POST | Overseas balance; bearer header |
| same API origin | `/krstock/quote/v1/currentPrice` | POST | Domestic stock/ETF quote; bearer header |
| same API origin | `/gbstock/quote/v1/current` | POST | Overseas quote; bearer header |
| same API origin | `/krfuture/quote/v1/day` | POST | Existing futures quote; bearer header |
| `https://www.nhplug.com` | `/openapi-docs/krstock/openapi.json` | GET | Public specification; no credentials |
| same docs origin | `/openapi-docs/gbstock/openapi.json` | GET | Public specification; no credentials |
| same docs origin | `/openapi-docs/krfuture/openapi.json` | GET | Public specification; no credentials |
| same docs origin | `/openapi-docs/gbfuture/openapi.json` | GET | Public specification; no credentials |

Official public krstock/gbstock OpenAPI documents were read without credentials
during implementation. They confirm POST balance/current-price paths and the
added overseas current-price contract (`Input_0.iem_cd`, `Output_0.trdprc`,
`Output_0.currency_unit`). Existing token/account/futures request contracts were
preserved from the previously verified implementation. Live vendor execution is
not proven by reading public specifications.

Exact matching rejects HTTP, other hosts/ports, userinfo, suffixes, extra segments,
queries/fragments and encoded/traversal variants before even fetching a token.
Only the token transport constructs its fixed encoded query after validation.
The gateway constructs headers/options itself. All requests set
`followRedirects: false`; 3xx responses become fixed `NH_HTTP` before reading body
or Location. No redirect retry, order, modification or cancellation route exists.
Continuation headers reject CR/LF; transport exceptions become fixed codes.

GENERAL is an implemented API capability, not a live-test success claim.
ISA/PENSION/IRP direct support remains `NOT_RUN`: no speculative product code or
endpoint is introduced. These types use existing KRX-verified OCR/manual holdings
until owner-side evidence establishes direct API support. Overseas native prices
retain their currency; balance valuations retain NH's existing KRW conversion.
No FX rate or unverified valuation is invented.

## Account Store V2 schema and durability

New sheet `AccountStoreV2` columns:
`userId, commitId, phase, parentRevision, createdAt, reason, beforeJson, afterJson, checksum`.
Each JSON cell is limited to 45,000 characters; holdings retain the 150-row input
limit, numeric validation, formula-injection checks and duplicate rejection.
The SHA-256 checksum detects corruption, not malicious spreadsheet-owner edits.

1. Under the script lock, compare the caller's revision and explicit confirmation.
2. Append a PREPARE containing before/after snapshots; flush and verify readback.
3. Append a COMMIT marker; flush and verify the committed state.
4. Only prepared records with valid matching commit markers change the visible state.
   Interrupted/uncommitted prepares do not replace the last good snapshot.
5. If writing reports failure after COMMIT persisted, resolve via readback instead
   of repeating or deleting data. Unknown/corrupt committed states fail closed.
6. Restore selects a user-owned snapshot and commits it under a fresh revision.
   The UI exposes the last five snapshots; physical journal records are retained.

`ExternalHoldings` remains read-only legacy input; no automatic destructive
migration occurs. `ExternalHoldingHistory` remains untouched. Its old history is
not imported into the V2 history view; privately preserve it before a future
approved production migration. After a V2 commit, modifying legacy rows through
an older deployed GAS would invalidate the chain and must be prevented operationally.
Old tabs calling the new GAS supply stale revisions and are rejected safely.

The new journal avoids destructive rollback but grows over time and scans the
sheet. Owner-reviewed archival/capacity planning is required before large-scale
use. A corrupt committed journal requires owner recovery from a private backup;
it is not silently skipped. Code rollback alone does not reverse V2 data commits:
a future production release needs a separately approved data migration/rollback
plan. Production is deliberately untouched in this PR.

## Validation classification

Automated tests use synthetic identities, holdings, credentials and responses.
They cover denied requests with zero fetch calls, five redirect statuses for
token/inquiry/spec, 401 refresh, partial balances, currencies, user separation,
confirmation/revisions, interrupted writes, restore, commit ambiguity and the
existing browser action contracts. Browser tests intercept Google/NH/CDN traffic.
They are not real OCR engine tests or Galaxy Fold6 device tests.

The branch's optional live CI job is explicitly disabled; regression CI uses no
Google/NH secrets. The full staging source graph and sourceDigest include all
three new modules. `security_patch.py` includes them in a complete bundle.
The old production CLI's single-Nhplug mode is refused before credential loading;
no production deployment workflow is invoked.

## Owner-run isolated staging application

Open [Google Cloud Shell](https://shell.cloud.google.com/). Codex cannot inherit
its Google login or the private staging password. Do not send credentials, source
archives, actual holdings or raw command outputs to chat/GitHub.

Use a fresh clone, fetch this PR's branch, and check out the **exact reviewed SHA**
reported in the PR. Do not run the abandoned `$HOME/update_test_gas*.py` helpers:
they are pinned to older source and do not contain this module graph.

Before `--apply`, privately back up the current test Sheet (including its history),
Script Properties and web-app run-as/access settings. This is separate from source
backup. Keep existing backups. No reset or deletion is necessary.

Run from the repository root, with a new private directory outside any Git tree:

```bash
umask 077
python3 tools/nh_v2_stage.py \
  --output "$HOME/nh-v2-prepare-$(date -u +%Y%m%dT%H%M%SZ)"
```

This default performs source backup/ZIP readback verification and bundle preparation
only. It does not push. It requires the known test deployment to remain version 2,
its actual HEAD/deployed source to match frozen baseline d99b9a0, and its public
metadata to match the dedicated project/Sheet bindings. Any unexpected source,
version, environment or unpublished change blocks before writes.

After those checks and the private Sheet/settings backups, use a **different new**
output directory to perform the authorized TEST-only update:

```bash
python3 tools/nh_v2_stage.py \
  --output "$HOME/nh-v2-apply-$(date -u +%Y%m%dT%H%M%SZ)" \
  --settings-backup-confirmed \
  --sheet-backup-confirmed \
  --apply
```

The tool captures clasp output privately, pushes the fixed test project only,
checks actual uploaded source, creates/verifies an immutable version, updates the
existing test deployment, checks metadata/sourceDigest and rereads HEAD. On failure
it restores only its own known test source/deployment changes when no concurrent
edit is detected. It never writes Sheets/Properties or authenticates with NH.
`OWNER_RECOVERY_REQUIRED` means stop and recover privately; do not retry blindly.
The tool requires an already authenticated owner clasp session and never prints
raw clasp output. Its default is not production-capable.

Only after an apply PASS, run actual integration checks with the existing CLI.
Username/password are entered locally; do not set them in shell command history:

```bash
python3 tools/nh_staging_test.py \
  --url 'https://script.google.com/macros/s/AKfycbx5s1yhQGKUytKLAE8c6UdZA2wRzenCA3nB-EnP-BpvGGTdYMJvxY8hdzEuWEpWBXkFbQ/exec' \
  --script-id '1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw' \
  --sheet-id '1oQA2wD_0jtGVOezLclzUyejsYA2Z-3X_kkD7-by0tsY' \
  --allow-staging-write --account-type ISA \
  --report "$HOME/nh-v2-isa-safe-report.json"
```

Repeat with `--account-type PENSION` and `IRP` and distinct safe report files,
stopping on any FAIL or incomplete cleanup. Use synthetic fixtures (no
`--private-holdings`). This tests external account types, not actual special-account
API availability. The fixture master must be current; `MASTER_REFRESH_REQUIRED`
is a stop, not permission to change timestamps or bypass freshness checks.
The dedicated test user must have empty active holdings; the tool refuses other
baselines. It restores active holdings to empty but preserves synthetic recovery
history in the journal. General NH balances stay in memory and are never saved.

The runner validates digest/bindings before login, reports only allowlisted codes,
and logs out. Real-response values still need owner-side comparison to the NH app.
Token failure/expiry/limits are fault-injected locally, not forced on the live NH
service. If keys are shared with another app, assess vendor token policy before
any forced refresh; do not clear production tokens or properties.

## Release gate

Until owner-run apply, live domestic/overseas results, private comparisons and
cleanup evidence are received, this PR is **implemented and mock-verified, not
fully live-verified or approved for production**. The last 24 live PASS results
predate this V2 and must not be reused. No main/release/pages modification,
production GAS/Sheets/Properties write, actual order or actual balance-to-Sheet
copy is authorized or performed by these development steps.
