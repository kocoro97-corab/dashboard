# V2 follow-up: fresh-environment live verification

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
