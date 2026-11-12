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

Enter the new **dashboard test user/password** at the hidden local prompts. The NH
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
