# V2 follow-up: fresh-environment live verification

**Current login/transport task:** use [TRANSPORT_V2.md](TRANSPORT_V2.md) and
`tools/nh_v2_relay_check.py --environment <existing-private-environment>`.
This auth-only check reuses the existing isolated version 2 deployment and private
history. Do not rerun the historical creation, capture/restore, representative NH
quote, or direct native-browser commands below for the current task. Actual NH
queries and new cloud infrastructure are outside the current validation scope.
The following sections are retained as the earlier owner setup record.

This procedure supersedes the earlier fixed-test-target instructions in
NH_INTEGRATION_V2.md. Do **not** run `nh_v2_stage.py --apply`, the old Home updater,
or any production tool for this follow-up. Main, release/pages, production GAS,
all existing projects and all pre-existing Sheets stay untouched.

Baseline PR #7 was 6e23b3b. That source could not persist native general-account
snapshots: its external store accepts only ISA/PENSION/IRP. This follow-up adds an
explicitly fresh-development-only native snapshot adapter over AccountStoreV2.
A new verified commit/digest is required; results cannot be attributed to 6e23b3b.

## Boundaries and minimum backup

- `nh_v2_fresh.py create` always creates a new standalone project, without a parent
  resource, and refuses production/old test identities. Captured clasp output and
  `.clasp.json` remain in a private folder outside Git. The newly created project's
  initial source is archived and verified before its V2 source is pushed.
- No existing GAS source is read or edited. No existing Sheet is opened by setup.
  `setupNhFreshV2` refuses a pre-bound project/Sheet and creates a new Sheet.
- After setup, privately record new project/Sheet/deployment settings and permanent
  Script Properties in a password manager. Do not export session/token caches into
  chat, source, CI or a public file. Make a private copy of the newly created empty
  Sheet before testing; this is independent of source backup. Existing backup files
  and existing data migration remain untouched.
- Public metadata, actual uploaded HEAD and immutable source are checked before
  NH authentication. The snapshot handler checks admin login, fresh markers,
  project/Sheet separation and the staging guard before accessing its store or NH.
- Snapshot actions do not exist as a production storage feature: the guard rejects
  production/no-staging-bridge and the old test Script/Sheet before any storage/NH.

## 1. Owner Google authentication and new source preparation

Open [Google Cloud Shell](https://shell.cloud.google.com/) as the owner. Codex
cannot inherit that session. Use a fresh clone and the exact verified PR commit:

```bash
git clone --branch feat/nh-integration-v2 https://github.com/kocoro97-corab/dashboard.git myinvest-v2-live
cd myinvest-v2-live
git rev-parse HEAD
```

Compare HEAD with the verified commit in PR #7 before continuing. The tools refuse
dirty tracked source. Do not paste passwords/keys into commands or chat. An existing
owner clasp login may be reused; if it is missing, perform its browser login locally
(`npx --yes @google/clasp@3.4.1 login --no-localhost`, after checking its help).

```bash
umask 077
python3 tools/nh_v2_fresh.py create --output "$HOME/myinvest-v2-fresh-private"
```

Use a new directory name if that path already exists; it is never overwritten.
Expected safe result: `status: PASS`, `phase: OWNER_PRIVATE_SETUP_REQUIRED`,
`initialSourceBackup: PASS`, `sourceReadback: PASS`, `nhRequested: false`.
This invokes Google project creation and source push **only for the new project**.
It performs no NH authentication. If Google authorization fails, stop; do not send
raw clasp output, OAuth codes, tokens or source archives to Codex.

## 2. Private settings, new Sheet, and immutable test deployment

At https://script.google.com/home open the newly created project titled
`NH-STAGING V2 FRESH <commit prefix>`. In Project Settings add these properties
privately (values never go into source or chat):

- `NHPLUG_APP_KEY` and `NHPLUG_APP_SECRET`: the owner-approved existing test credentials.
- `NHPLUG_KEY_USAGE`: `staging-readonly`.
- `STAGING_TEST_USER`: a dedicated new test dashboard username.
- `STAGING_TEST_PASSWORD`: a strong test dashboard password, 16–256 characters.

Do **not** set APP_ENV, STAGING_SHEET_ID or point this project at an existing Sheet.
In the editor run **setupNhFreshV2** once as owner and grant its Google permissions.
It creates a new Sheet and user, sets the fresh bindings, removes the setup password
property, and reports only `STAGING_SETUP_OK`. Preserve the password privately.
Inspect the new Sheet in the private STAGING_SHEET_ID setting; back up that new
empty Sheet and permanent settings before actual NH testing. A partially failed
setup requires private inspection; do not adopt/reset an old project to bypass guards.

```bash
python3 tools/nh_v2_fresh.py publish --output "$HOME/myinvest-v2-fresh-private"
```

Expected: `status: PASS`, `phase: NH_AUTH_APPROVAL_REQUIRED`, sourceDigest/fresh
bindings PASS, `nhRequested: false`. The tool checks actual source, creates and
verifies a new immutable version and a new deployment of this new project, then
checks public metadata. It never updates an existing deployment or production.
On failure, stop; newly created resources may remain for owner inspection. No
automatic deletion or mutation of existing resources is attempted.

## 3. Explicit NH read and private snapshot approval boundary

**Stop here until the owner is ready to approve actual NH reads and private copies
of financial holdings in this newly created Sheet.** This approval does not permit
orders, production writes, existing-data migration or PR merge. The permanent
settings/empty Sheet backup above must already exist. Shared-key vendor token
policy remains relevant; do not force token expiry or delete production tokens.

The following command checks source/bindings only and stops before login/NH:

```bash
python3 tools/nh_v2_live_check.py --environment "$HOME/myinvest-v2-fresh-private"
```

Expected: `status: NOT_RUN`, `code: OWNER_NH_APPROVAL_REQUIRED`, `nhRequested: false`.
The explicit opt-in command for when the owner chooses to proceed is:

```bash
python3 tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private" \
  --approve-nh-read-and-private-snapshot --browser
```

Enter the new **dashboard test user/password** at the local prompts. The username
is visible and trimmed so typing errors can be checked; the password stays hidden.
Neither value is included in the final JSON report. The NH
key/secret already reside privately in the new project's Properties. Neither login
is entered into chat, CI or command-line arguments. Missing Google/NH access is
NOT_RUN, never an authentication PASS.

For `--browser`, install Playwright/Chromium in an owner-local virtual environment
if necessary; use the same environment's Python for all commands:

```bash
python3 -m venv "$HOME/myinvest-v2-live-venv"
"$HOME/myinvest-v2-live-venv/bin/python" -m pip install playwright==1.56.0
"$HOME/myinvest-v2-live-venv/bin/python" -m playwright install chromium
```

Then replace `python3` in the live command with
`"$HOME/myinvest-v2-live-venv/bin/python"`. No browser screenshots or traces are made.
The actual Fold6 device remains a separate owner check.

## 4. What the live tool verifies and what it does not

1. Actual fresh-project HEAD/immutable source, deployment version, revision,
   sourceDigest and Sheet fingerprint; staging markers and read-only configuration.
2. Strong dedicated admin dashboard login. The native snapshot namespace must be
   entirely new/empty, including its visible history. Otherwise it stops.
3. `nhSnapshotCapture`: actual NH account-list/domestic/overseas read-only calls,
   followed by canonical native account snapshots in `NhReadSnapshotsV2`. Partial
   responses never overwrite the previous snapshot. The native adapter uses the
   same AccountStoreV2 prepare/commit engine; it does not forge ISA account types.
4. A separate GAS readback must exactly match the captured canonical account
   payload/revision, including markets, codes, quantities, averages and currencies.
   No actual values, account keys, symbols or counts are printed or written to logs.
5. At most one eligible domestic and one eligible overseas symbol are quoted.
   Missing eligible holdings is NOT_RUN, not PASS. Quote currency must agree with
   the original holding. No comparison assumes prices are unchanged across time.
6. Desktop/mobile UI receives actual saved GAS readback via an isolated browser
   route adapter and compares displayed names/codes/quantities/averages/prices.
   All browser external traffic is intercepted; the production URL is never called.
   Scope is `LIVE_SNAPSHOT_UI_ADAPTER`: this is actual saved-data rendering, **not**
   an unmodified browser-login-to-GAS end-to-end test. The old frontend cannot log
   into the staging bridge unaided because it lacks stagingBinding; no production
   fallback is used to disguise that limitation.
7. Restore only this run's empty active baseline under revision protection, verify
   readback, logout. On an ambiguous capture/write/read failure it stops, marks
   ownerRecoveryRequired, and leaves data for private inspection rather than
   issuing destructive cleanup. Native snapshot journal history retains real
   copied holdings in the new private Sheet even after the active state is empty.

Source/raw vendor responses are never stored. Only the canonical authenticated
account output is persisted. Snapshots exclude account numbers, suffixes, keys and
tokens. Limits are 20 accounts, 1,000 holdings, and 45,000 characters per before/after
JSON cell; exceeding capacity fails before commit and preserves the previous state.
The journal grows without automatic deletion; capacity and recoverability are
reviewed, not migrated or stress-tested against production.

ISA/PENSION/IRP direct API support remains NOT_RUN until independently confirmed.
The general-account endpoint and external/OCR tests cannot prove special-account
support. API support must not be inferred from the owner's account existence.

Partial failure, token expiry/401 refresh, transport failure, redirect rejection,
conflicts and interrupted commit are **synthetic regressions**, not deliberately
induced vendor faults. A naturally occurring live failure is reported as FAIL,
not turned into a retry loop or replaced with synthetic success. The tool does
not observe whether a valid token was freshly issued versus reused from cache;
successful NH reads prove acceptance, not forced token-issuance coverage.

## Safe result sharing and completion gate

Share only the tool's final allowlisted JSON status/phase/checks. Do not share
fresh-plan.json, archives, copied Sheet content, original responses, source, keys,
passwords, tokens, terminal history, screenshots or financial browser traces.
Results have PASS/FAIL/NOT_RUN plus scope. CI/local mock PASS and old live PASS do
not satisfy this version's real-NH completion condition. Until actual owner-run
results arrive, NH reads, native integrity, real-data display and cleanup are
NOT_RUN, and PR #7 remains unmerged/unpublished.

## Recovery from the initial --project-path failure

The initial 16d643b helper passed a nonexistent `.clasp.json` file as `--project`
to clasp 3.4.1's create command. clasp rejects that path during CLI initialization.
The corrected helper selects the existing isolated directory for create; all
subsequent project operations still use the exact existing config file.
This was reproduced offline against clasp's actual initialization code, with no
network calls. New regression tests cover both argument forms and redacted errors.

Preserve the failed output directory. Update to the newly verified PR commit and
use a different **new** private output directory, for example
`$HOME/myinvest-v2-fresh-private-r2`. Never delete or reuse the failed directory to
force creation. Safe CLI categories now distinguish path, owner login, OAuth scope,
and Apps Script API enablement failures without revealing raw output.

## Read-only diagnosis after LIVE_QUOTE_NOT_CONFIRMED

Owner-reported execution of the deployed 7093e64 source reached PASS for dashboard
login, actual NH domestic/overseas balance inquiry, native snapshot exact readback,
and domestic quotation. It stopped before UI validation/active-baseline restoration
with LIVE_QUOTE_NOT_CONFIRMED during the overseas check. These are partial live
results, not an overall PASS. Special account support remains NOT_RUN.

Do not rerun the capture flow, recreate the environment, reset data, or republish
GAS. Preserve the existing native snapshot and private journal. The failure can mean
missing price, absent balance/quote currency, or a currency mismatch; no correction
or symbol guessing is justified without classification.

Update only the repository helper to the verified PR commit, keeping the existing
private environment unchanged, then execute:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --diagnose-overseas-quote
```

Enter the existing fresh test dashboard username at the visible prompt and check
its spelling. The password prompt remains hidden. Credentials are not included
in the JSON report.
This mode permits only login/logout, snapshot reads, and one overseas quote action
(the existing gateway may naturally refresh once on HTTP 401). No capture, restore,
write, deletion or automatic retry loop is performed. It reports only booleans,
allowlisted diagnostic/HTTP codes, whether the snapshot stayed unchanged, and
whether an empty baseline is present in recoverable history. It never prints the
symbol, currency values, quantities, prices, account keys, snapshot IDs or raw text.
Even a diagnostic PASS does not prove that the previously failing condition was
fixed; the response may have changed. UI validation and recovery remain separate.

A helper-only revision change is accepted **only in this read-only mode**, with
an identical GAS sourceDigest. The private bundle, actual HEAD and immutable source
must independently equal a freshly generated bundle of the verified local GAS
files, using the deployed revision marker. Public metadata must retain the exact
plan revision, project and Sheet fingerprints. The full capture mode still requires
the original strict revision match. A changed GAS digest or private bundle edit
blocks before authentication/NH.

## Owner-editor probe for the combined NH_NO_PRICE category

The owner read-only diagnostic subsequently reported `NH_NO_PRICE`, no returned
quote, confirmed balance currency, and unchanged stored snapshot. This does not
prove the vendor omitted a price: the deployed V2 handler combines missing output,
symbol mismatch, invalid price and absent/invalid currency into that one category.
Do not change currencies, strip symbol prefixes, substitute closing prices or mark
this as a resolved quote failure without evidence.

To inspect the original vendor response **inside the existing fresh GAS only**,
`tests/staging/OwnerOverseasProbe.gs` is an optional owner-editor function. It is
excluded from all build/deployment bundles and from sourceDigest. It reads the
configured fresh admin's existing native snapshot, requests the same single
approved overseas quote through the existing gateway, and logs only presence/type/
validation booleans and a safe HTTP/error code. It never logs original values,
symbols, currencies, amounts, accounts, password hashes, raw bodies or tokens.
It checks positive held-quantity/price, exact and trimmed symbol match, exact and
trimmed/case-normalized currency validation, and whether the documented previous/
regular close fields are positive. Those closing values are **not** used as current
prices and nothing is guessed or corrected. It verifies the saved state is unchanged.

The owner-only installer temporarily adds that single file to the **fresh test
project HEAD**. The existing immutable web-app version and URL stay unchanged.
It never creates/updates a deployment, exports/changes property values, writes Sheets, or
calls NH. It backs up the verified original source in a private ZIP first. Removal
restores the exact original HEAD only when the current source is the original or
the installer's exact known source; concurrent edits block rather than being lost.
This is not an operation on production GAS or on the earlier fixed test project.

From the checked-out verified helper commit, execute once in owner Cloud Shell:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_owner_probe.py install \
  --environment "$HOME/myinvest-v2-fresh-private-r2"
```

Expected safe JSON: `status: PASS`, `phase: OWNER_EDITOR_PROBE_READY`, backup PASS,
`existingDeploymentChanged: false`, `storageWrites: false`, `nhRequested: false`.
If any failure occurs, do not repeat install or overwrite the private backup;
preserve it and inspect the reported ownerSourceReviewRequired state.

Then open only the fresh `NH-STAGING V2 FRESH …` project at
https://script.google.com/home, select **ownerProbeOverseasQuote** in the editor's
function list and run it once as owner. Do not press Deploy. Share only its final
JSON. `status: PASS` here means the diagnostic completed, not that the quote or
whole integration passed; `quoteAcceptedByCurrentRules` separately reports that.

After collecting the diagnostic, remove the temporary file using the **same helper
commit** before any other source updates or regular CLI tests:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_owner_probe.py remove \
  --environment "$HOME/myinvest-v2-fresh-private-r2"
```

Expected: `ORIGINAL_TEST_HEAD_RESTORED`, original deployment unchanged and no Sheet
writes/NH calls. Backups remain private. During installation the ordinary CLI's
strict HEAD check intentionally rejects the extra file; do not reset data, recreate
the environment or redeploy to bypass it. Snapshot recovery is still a separate
verified operation; this probe does not restore/delete private financial history.

## Official overseas identity proof and code-only fresh-test upgrade

Owner probe evidence classified the overseas rejection: HTTP 200, positive price,
valid currency matching the balance, but neither exact nor trimmed symbol matched.
This is not a reason to remove symbol validation or use closing-price substitutes.
The owner subsequently confirmed `ORIGINAL_TEST_HEAD_RESTORED` with no deployment
change, storage writes or NH requests. Keep the current private snapshot/history.

Primary sources:
- NH support SDK: https://github.com/PLUG-OpenAPI/nhplug-sdk/tree/main/instruments
- Official field layout: https://www.nhplug.com/instruments/m_gtsstock.h
- Official full public universe: https://www.nhplug.com/instruments/m_gtsstock.mst
- Quote contract: https://www.nhplug.com/openapi-docs/gbstock/openapi.json

`NhForeignIdentityV2.gs` validates the complete declared CP949/164-byte layout,
reads byte offsets (not decoded name character offsets), and joins only aliases in
the same official record: GIC, ticker, ISIN, country, exchange and settlement currency.
The quote request uses that record's ticker. The returned identifier must equal an
alias in the same record, and positive current price/currency must independently
validate. Only documented right-space padding is removed; no prefix/case/name
heuristic is used. Multiple listings remain unconfirmed unless exact balance currency
leaves one unique record. Same-currency multiple listings are rejected.

The full public master is downloaded once per overseas quote batch, without any
portfolio symbol in its URL, without credentials and with redirects disabled.
Only requested records are retained; vendor raw responses are never returned.
The reference has header/master SHA-256 and download timestamp provenance.
`freshness: DOWNLOAD_TIME_ONLY` explicitly does not claim a provider publication
or market-as-of date. Invalid layout, ambiguous/missing identity or download failure
returns safe diagnostics and no price; it never changes saved holdings. Availability,
GAS execution limits, reference size (currently about 6 MB; capped at 8 MiB), and
future listing changes remain live-test/operational risks.

The following command is specifically for the **already created fresh environment**;
never use the old fixed-test updater, full capture, create, publish, setup or reset.
First fetch/check out the exact newly reviewed PR commit reported by Codex, then:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_upgrade.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2"
```

The command validates the original public build graph at the deployed revision
without executing historical code. Local bundle, actual HEAD, immutable deployment,
public metadata, fresh Script/Sheet bindings and manifest must all match. It keeps
a private source ZIP and previous plan/bundle, uploads only code to this fresh test
project, verifies a new immutable version, updates its existing test deployment,
and checks public sourceDigest/identity feature metadata. No Sheets, Properties,
NH, orders, old test resources or production resources are written/called.
The web-app URL, fresh Sheet, schema version 2 and active snapshot remain unchanged.

On a verified, non-concurrent failure it restores the prior code/deployment only;
it never rolls back data. Any unknown source/deployment change stops with
`OWNER_REVIEW_REQUIRED`. Do not repeat or erase an existing backup directory.
A PASS reports `FRESH_TEST_IDENTITY_UPGRADE_VERIFIED`, sourceDigest PASS, backup
PASS and false storage/Properties/NH/production-change flags. An upgrade PASS is
not an actual overseas quotation PASS.

After an upgrade PASS only, run the earlier `--diagnose-overseas-quote` command
against the existing snapshot. This version also requires
`referenceIdentityVerified: true`. Share only its sanitized JSON. Do not rerun the
full capture flow on existing history. UI validation and a separately checked
baseline restoration remain pending after the quote diagnosis.

## Resume existing snapshot UI without recapturing data

Owner-reported read-only diagnosis after the identity upgrade: PASS, positive
foreign current price, balance/quote currency match, official reference identity
verified and storedSnapshotUnchanged. This verifies that selected foreign quote;
it does not verify every held foreign instrument or all account types.

The prior full flow is intentionally not repeatable on existing data/history.
After checking out the reviewed **helper-only** commit, run:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --verify-existing-snapshot-ui
```

No GAS reapplication is needed: the unchanged core sourceDigest and the originally
deployed revision marker are fully checked against private bundle, actual HEAD,
immutable source and fresh bindings before login. The owner enters existing fresh
credentials privately. Only login/logout and snapshot reads are allowed. The
browser receives actual saved readback via the isolated adapter and verifies names,
codes, quantities, average/current prices and currencies at 1440/344px. All external
browser traffic is intercepted; no screenshots, traces or financial values are
printed. This is saved-data rendering, not native browser-to-GAS login E2E or a
Galaxy Fold6 hardware test. Failure paths still reread revision/accounts/history
and logout. Concurrent changes are FAIL, with no automatic restore or overwrite.

Expected safe result: READ_ONLY_EXISTING_SNAPSHOT_UI, status PASS, desktop/mobile
PASS, storedSnapshotUnchanged true, storageWrites false, nhRequested false and
orderCalls 0. Baseline restoration is separate and is **not** performed by this mode.
Keep the active snapshot and journal until its result is reviewed.

## Restore only the original fresh-test active baseline, preserving recovery

Owner reported existing-snapshot UI PASS for desktop/mobile with
LIVE_SNAPSHOT_UI_ADAPTER scope, no NH or storage writes and unchanged snapshot.
This is actual saved-data rendering at 1440/344px, not a physical-device test.

The original full capture flow stopped before restoration. Do not rerun capture
or clear the Sheet to clean up. The following separate command restores **only the
fresh test user's initial empty active snapshot**, as an append-only store commit:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_restore.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --restore-initial-empty-baseline
```

Use the exact reviewed helper commit. No GAS reapplication is necessary; strict
same-source preflight verifies existing fresh project/deployment/Sheet and immutable
source before login. The explicit restore flag is required. The tool requires one
and only one original `nh-read-snapshot` history record with an empty before-state,
and the active revision must be the revision of that same capture. Unknown history,
a subsequent commit or an empty active state blocks; it never guesses a baseline.

Before the write, it creates a new mode-700 private backup directory under the
existing private environment, writes the current snapshot/revision/history to a
mode-600 file, flushes/fsyncs it, and verifies JSON and a separate SHA-256 file by
readback. Existing backups are never overwritten. These files **contain actual
financial information**: do not paste, upload or publish them or their contents.
They exclude login passwords and session tokens. This is a normalized snapshot
backup, not a replacement for a whole-Sheet/settings backup.

It rereads the unchanged state, then calls `nhSnapshotRestore` once with that
snapshot ID, current revision and explicit confirmation. The server revision guard
blocks intervening writes. Success requires empty active accounts, a new revision,
an exact history copy of the pre-restore actual snapshot and retention of the
original capture history. It deletes no rows or journal history. It never calls NH,
changes source/deployments/Properties, accesses old/production Sheets, or performs
orders. The active snapshot is intentionally empty afterward; actual captured data
remains privately recoverable in both journal history and local backup.

Expected safe JSON: FRESH_TEST_INITIAL_BASELINE_RESTORE, PASS, backup PASS,
activeEmptyBaselineRestored/realSnapshotRetainedInHistory/originalHistoryRetained
true, storageWrites true (this fresh test journal only), nhRequested false, orderCalls
0 and ownerRecoveryRequired false. A lost acknowledgement or readback failure is
FAIL even when readback suggests a completed restore. **Never repeat on FAIL**;
preserve the private backup/history and review the safe state flags. No automatic
second restore, deletion or corrective overwrite is performed.

## Final integration pass on the unchanged GAS build

The latest owner-approved task is final validation, not a redesign. GAS, auth.js,
UI, main and release/pages are unchanged. The original full runner refuses any
history and strict helper SHA changes; this prevented a continuous rerun after
successful cleanup. An explicit `--repeat-empty-baseline` option now permits the
already verified empty fresh store without deleting its recovery history. It
backs up that baseline privately first, requires a restored revision, rereads it
before capture, and limits existing visible history to three records so that both
capture and restore retain all earlier entries in the five-record view. Current
owner-reported baseline has two entries. Do not repeat this command on failure or
after another successful run; it is one final pass, not a reset loop.

After checking out the exact CI-verified helper commit, owner Cloud Shell command:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --approve-nh-read-and-private-snapshot \
  --repeat-empty-baseline --browser --real-browser --representative-quotes
```

Enter the existing fresh dashboard username/password locally once. No new app key,
token reset or NH authentication scheme is introduced. Existing NH token caching
is retained; an accepted cached bearer proves authentication without forcing a
new token issuance. The full sequence is new NH inquiry/capture, exact native
save/readback, account/code/currency checks, domestic/overseas quote checks,
1440/344px saved-data adapter rendering, restore of this run's empty before-state,
original/new history retention and logout. Failures stop with safe codes and
preserve the available snapshot/history for owner review; no blind restore or
recapture is attempted.

Only after full-flow PASS does native browser verification start. Existing auth.js
runs unmodified from the local development origin. The existing endpoint setting
points to the verified fresh URL; no synthetic session is inserted, API response
is replaced or CORS/security policy disabled. The staging-only `stagingBinding`
required by StagingBridge is injected into requests to that exact verified URL.
This is the verified test Sheet fingerprint, not an auth token or login bypass.
No production endpoint is used. Native text/plain browser POST and Google's normal
ContentService redirect are exercised; third-party widgets, market proxy/futures
background actions and mutations are blocked as outside the auth/account check.
This test is not a claim about live public-market/news widgets or the exact
production GitHub Pages origin. No public frontend is published for testing.

The native check verifies unauthenticated account rejection, normal login, actual
NH account response-to-DOM comparison, reload session retention, then waits for
**real five-minute browser inactivity** (no artificial timestamp/clock changes).
The expired/logged-out token must subsequently be rejected by actual GAS. The
combined flow cannot distinguish server idle expiration alone from explicit
logout revocation, so `serverIdleExpiryInIsolation` remains NOT_RUN. Expect roughly
6–10 minutes total and sanitized progress messages. No screenshots, traces, raw
responses, financial values or credentials are printed/saved by this browser check.
The existing synthetic browser fixture separately accelerates inactivity and
replaces GAS only inside tests; those results never count as actual CORS/live PASS.

After core/browser PASS, one read-only batch checks three **public non-portfolio
representatives**: NASDAQ AAPL, NYSE KO, ETF SPY. These are not disclosed holdings.
The public official NH master confirms unique USD entries; all must independently
pass the existing identity/positive-price/currency validation. A missing price is
FAIL/unconfirmed, not an invented UNSUPPORTED classification. This batch does not
write snapshots. The current frontend quote contract does not expose vendor
market-period/trade-date/delay evidence; these remain NOT_RUN rather than claiming
zero delay or an intraday/close classification. Representatives do not cover all
foreign securities and are not a requirement for special-account support.

Official support review (2026-11-13): https://www.nhplug.com/llms.txt and the official
krstock/gbstock OpenAPI/overview document the generic account list and balance
requests. `acct_type` 01/02/03 describes general/delegate/mock API environment,
not evidence of ISA/pension/IRP product support. No explicit support mapping for
those three product types was established from these sources. Each remains
지원 여부 미확인 / NOT_RUN; no speculative product codes or extra API paths are
used. Existing OCR/manual support is unchanged. This does not block core general
account completion. Fold6 hardware requires owner access and remains NOT_RUN until
an actual external/internal/fold/refresh/touch checklist is completed; viewport
mock PASS must not be substituted.

Share only the final sanitized JSON. `checks` records core evidence,
`nativeBrowser` records the real browser boundary, and `representativeQuotes`
records the separate public sample batch. Inspect each sub-result; prior build
success is not reused for this final pass. No deployment, merge, production Sheet
or Properties operation is part of this command. Preserve all private backups.

## Native browser CORS failure: anonymous evidence only

Owner-reported final execution at f59b8ac: latest-build dashboard/NH authentication,
domestic/overseas inquiry, exact native store readback, identity/currency, both
quotes, desktop/mobile adapter, original/new history retention and baseline restore
all PASS. Thus priority 1 is PASS for that continuous run. Native browser stopped
at UNAUTHENTICATED_PROBE with observed CORS/network failure before login; priority
2 is FAIL. The foreign representative batch did not run. Order calls 0; existing
resources unchanged. Do not repeat the full flow: its successful run left four
history entries, which the deliberate preservation limit will refuse.

A local synthetic three-origin HTTP reproduction confirmed that both native
text/plain POST and Playwright body-injected POST can follow a CORS-enabled 302
successfully. This does not establish the Google deployment's CORS headers or
identify a backend/auth bug. No app source or authentication behavior is changed
on that evidence alone.

After checking out the reviewed diagnostic helper commit, run only:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --diagnose-browser-cors
```

This mode requires no dashboard credential prompt, does not login/capture/restore,
and makes at most three anonymous browser requests: public appVersion, missing-token
nhAccounts with the previous route injection, and missing-token nhAccounts with the
binding already present before fetch. The verified GAS source rejects missing
sessions before any NH/account inquiry. Source/deployment/binding preflight stays
strict. It never uses no-cors, a relay, response rewriting or disabled web security.

Only fixed role/method/content-type/allow-origin/error categories and HTTP codes are
reported. Redirect URLs, signed query strings, header values, response text, tokens
and data are omitted. Header categories show whether denial occurred at preflight,
exec or content redirect as observable. Diagnostic status PASS means evidence
collection completed; each case's status/jsonReadable/authBlockedAtSessionCheck
reports communication separately. Any unexpected private response or destination
stops. Share only the safe JSON. Do not rerun full capture or change GAS while the
cause remains unresolved. Fold6 remains NOT_RUN and special-product support remains
unconfirmed; neither is replaced by synthetic evidence.

## Resume native login after anonymous CORS probes PASS

Owner-reported anonymous evidence at 0792882: all three cases PASS. Metadata and
both auth-probe body styles were JSON-readable, exec/content responses had wildcard
allow-origin, no preflight was observed, and missing-token requests were rejected
at the session check with no private fields. This does not reproduce the earlier
CORS failure or establish its root cause. Do not change working application/auth
code or claim the first failure was definitively transient. Native login and
session must still be tested separately.

The explicit native-only mode reuses that same native checker and strict fresh
preflight, without calling the full runner, capture, restore or backup rewrite.
From the exact reviewed helper commit run:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_live_check.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --native-browser-only --representative-quotes
```

Enter existing fresh credentials locally once. This makes actual read-only NH
inquiries through the native browser, verifies login/response/display/session, and
waits for natural five-minute inactivity. On native PASS it performs the already
prepared three-public-instrument read-only quote batch. On FAIL it stops before
that batch. Existing snapshots and journal history are not captured/restored by
this mode, and mixing it with full/repeat capture options is rejected before auth.
Routine test-session authentication is unchanged. No GAS reapplication or frontend
publish is needed. Prior latest-build full-flow PASS remains separate evidence;
this command does not pretend to repeat it. Share only the sanitized final JSON.

## Native startup sequence and failure-only evidence

Owner's native-only execution at e21dc7e again stopped before login at
UNAUTHENTICATED_PROBE with observed CORS/network failure. Store/NH core-flow PASS
is retained; no capture/restore/full rerun is justified. The earlier successful
anonymous diagnostic starts with browser-side appVersion, whereas the native
checker previously started directly with missing-token nhAccounts. This is an
observed setup difference, not a proven explanation of Google's earlier failure.

The checker now follows the same browser metadata-first sequence: native text/plain
appVersion with the existing binding already in its body, verify freshTestEnvironment
and exact sheetHash, then the original unauthenticated probe/login/session checks.
Already-bound bodies are not needlessly rewritten by the route handler. There is
no response replacement, auth bypass, security disablement, server/header patch,
automatic retry or application-source change. This normalizes the checker setup
and verifies the browser endpoint before submitting credentials; it must not be
reported as a proven CORS fix without actual execution evidence.

Failure reports add only fixed HTTP/content-type/allow-origin/destination-role
categories (at most the last eight responses), fixed CORS categories and error type.
No original header values, signed URLs, exception text, body, password, token or
financial data are output. Success omits this extra network evidence. Existing
synthetic browser login now asserts metadata/Sheet verification and report privacy.

Use the same --native-browser-only --representative-quotes command from the exact
reviewed commit; no GAS deployment or Sheet operation is needed. If metadata,
unauthenticated probe or login fails, stop and preserve the safe final JSON. The
previous full run must not be repeated.

## Confirmed endpoint fallback defect and native login-only failure

Owner's d8d2dd7 result: browserMetadata PASS, unauthenticatedBlocked PASS; native
login did not complete. The CORS category was ALLOW_ORIGIN_MISSING, an out-of-bound
attempt was blocked, and the checker eventually timed out. The login CORS response
itself was not available to the page-level observer, so its underlying HTTP cause
remains unconfirmed. Core NH/store/adapter/restore PASS is unaffected.

Code review and an independently failing synthetic browser assertion confirmed a
separate concrete error-path defect in auth.js: a custom-endpoint transport/non-JSON
failure removed the user's saved endpoint and replayed the same credentials to the
built-in production endpoint. The isolated test firewall prevented actual production
requests. The minimum frontend patch removes only that automatic destination
switch/replay; normal login/register payload, session/token behavior, server password
validation and GAS source are unchanged. A failed chosen endpoint now reports the
existing safe error and preserves its setting. Any endpoint change must be explicit;
there is no silent recovery by another server. No production frontend is published.

The existing privacy browser fixture now sets a synthetic custom endpoint, reproduces
both non-JSON and aborted-network login failures, and asserts exactly one request to
that same endpoint and preservation of the setting. It failed on the old source
(LOGIN_ENDPOINT_CHANGED_AFTER_ERROR) and passes on the patched source at both widths.

The native checker now observes Chrome Network events read-only (Network.enable,
not request/response interception) in addition to the existing request safety gate.
CORS-blocked replies can therefore contribute fixed method/role/HTTP/content-type/
allow-origin/CORS/network error categories even when fetch cannot read the response.
No raw event, postData, cookies, header values, signed URLs, failed-parameter text,
passwords or tokens are retained/output. Unknown values become OTHER. Redirect-hop
header state is cleared to avoid assigning the previous response to a later failure.
Success omits this extra diagnostic evidence. Login failure is explicitly FAIL and
ends when the existing safe UI error settles, rather than always waiting 120 seconds.

Continue only with the reviewed --native-browser-only --representative-quotes mode.
No GAS reapplication, whole-flow capture, restore, data clearing or authentication
redesign is required. This frontend fix addresses unauthorized fallback, **not a
claim that the original CORS problem is solved**. Actual native login and foreign
representatives remain pending. On failure, stop and share only the sanitized JSON.
