# Account integration: approved capabilities, owner runtime activation required

Owner approval received on 2026-11-15 for both private reads through the existing
Cloudflare relay and fixed synthetic-only save/readback/restore. No further
approval is needed for these exact scopes. Real-data replacement and production
changes remain outside that approval.

Targets: existing `feat/nh-integration-v2`, separate `dev-pages`, existing isolated
test GAS / Sheets / Properties. No new project, account, subscription or NH scope.

## Confirmed blockers

1. `AppContext.accounts()` returns immediately in the development profile.
2. `DevelopmentInspection` disables NH/private-store controls and installs local
   preview wrappers. This is an intentional restriction, not an NH API failure.
3. `RelayApp` rejects private actions under `auth_only` with
   `RELAY_SCOPE_BLOCKED`. Changing a button alone cannot enable private access.
4. `PublicDevelopment` requires the isolated auth-only config, exact HTTPS tunnel,
   exact Pages origin, private development code, rate/size/concurrency limits and
   expiry. These requirements must remain intact.

Existing owner-private domestic/overseas inquiry was reported PASS with desktop
and mobile adapters, no writes and no public relay. Do not rerun it merely to
confirm the same diagnosis. This workspace has no owner `fresh-plan.json` or
Google OAuth binding. Live owner credentials must stay in the existing private
Cloud Shell or the user's own browser, never chat or GitHub.

## Approved A: private reads through the existing HTTPS relay

Add a default-off, explicit account-read capability alongside `auth_only`, rather
than turning off the existing allowlist. Exact permitted private actions:

- `nhAccounts`: existing administrator-only domestic/overseas balance handler.
- `externalHoldings`, `externalHistory`: the logged-in user's existing store.
- `nhExternalQuotes`: existing domestic stock/ETF read-only price handler.

The account page should not require unrelated protected static holdings,
registration, password changes, member approval, Drive, arbitrary proxy URLs,
NH snapshots or orders. All remain blocked in this development capability.

Attest the same script/sheet/source fingerprints and owner-run deployment settings
before exposing the relay. Keep existing GAS session/administrator checks,
Authorization headers, code validation, exact CORS, bounded requests, no redirects,
no raw logs and no response caching. Surface only confirmed server capabilities
to the frontend; absent capability means the existing preview restriction.

Risk requiring explicit approval: real balances pass through the existing
Cloudflare HTTPS tunnel into the authenticated development browser. This is an
external transmission even though no financial data is committed to Pages.
Browser users with authorized account access can view their corresponding data.
Stop/expiry must close external access; no persistent private browser cache.

## Approved B: limited external test-store writes

Separate default-off permission for `saveExternalHoldings` and
`restoreExternalHoldings`, retaining existing authenticated user isolation,
pre-save review, exact expected revision, locking and append-only recovery.
No NH snapshot writes, resets, deletes or source schema changes.

Activation alone must not run a write. Before live validation, the owner must
identify an existing test user/store containing only approved synthetic holdings,
or explicitly approve the particular real-data replacement. If an existing store
has unapproved rows or recovery history, do not overwrite it for a test.
Reuse the existing store/Sheet; never create a new project as a workaround.

An interrupted write must retain uncertain-outcome handling and must not retry.
Validation performs one reviewed synthetic save, readback and reviewed restore;
the resulting prior versions remain recoverable. Raw holdings are not logged.

Implemented in `relay/account_scope.py`: successful login binds a token digest
in memory to the declared existing test administrator. Before each write, verify
the current admin session, review flag, revision, current holdings and available
recovery history. Every row must exactly match a row from the public
`data/account-test-holdings.json` fixture, not merely carry a synthetic marker.
Unknown existing rows/history stop before any mutation. Restore IDs must come
from that checked history. Fixed test rows are excluded from real asset totals.

## Existing owner environment startup

Keep the relay terminal open for browser testing. Stop the old relay process
before starting this profile. Reuse the existing checkout and private environment:

```bash
cd "$HOME/myinvest-v2-live" &&
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only origin/feat/nh-integration-v2 &&
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_https.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --cloudflared "$HOME/.local/bin/myinvest-cloudflared-2026.11.0" \
  --minutes 60 --public-market --accounts --external-test-store \
  --test-store-user nh_test_v2
```

The explicit flags default to false; ordinary startup retains the old scope.
Startup runs the existing private source/sheet/deployment preflight. It never
creates a project, deployment or test user. If fast-forward/source checks stop,
preserve local work and report the safe code; do not reset or force-push.

After `HTTPS_DEV_READY`, open the existing development URL at `#/accounts/nh`,
enter the new public endpoint plus the private development code and log in using
the existing dedicated test administrator. No secrets go into chat.

The page's "계좌 연결 상태 확인" button checks session/GAS metadata without
another NH inquiry. On `#/accounts/ocr`, use "합성 저장 검증자료 불러오기",
review the marked synthetic rows, save, read back, open "저장 복구 기록" and
restore the reviewed prior synthetic/empty state. Each write retains the existing
review dialog and expected revision. Actual OCR data may be recognized and edited
locally but is rejected by this synthetic-only persistence permission. If current
data is not the fixed fixture, stop; do not clear it to make the test pass.

Live validation cannot run in the Codex workspace without the owner's existing
private Google authentication and `fresh-plan.json`. Do not rerun the old private
NH-only test; the remaining check is the new authenticated Pages account flow.
A source/browser test PASS is not a live Pages/GAS account PASS.

## Special accounts: public evidence, 2026-11-15

Credential-free official documents fetched successfully:

- https://www.nhplug.com/openapi-docs/krstock/openapi.json — HTTP 200, 34 paths,
  including `/krstock/inquiry/v1/balance`.
- https://www.nhplug.com/openapi-docs/gbstock/openapi.json — HTTP 200, 19 paths,
  including `/gbstock/inquiry/v1/balance`.

Neither inspected document explicitly identifies ISA, IRP, pension savings or a
verified special-account product code. This does NOT establish official lack of
support. Classification: support unconfirmed, actual special-account inquiry
NOT_RUN. Existing application filtering of general types `01`/`02` is not proof
that special accounts use those types. Preserve the filter and OCR/manual path;
do not invent product codes or call speculative endpoints.

## Acceptance after approval

Authorize read and optional test-store capabilities explicitly in the existing
owner-run startup path, bind to the already-approved isolated target and log in
in the private environment. Check six account subroutes, query/error timestamps,
same-identity quantities/weighted averages, partial queries, null prices, no
double FX conversion, reviewed save/readback/restore if approved, expiry,
reauthentication, logout cleanup, PC and user-operated Fold6.

Report synthetic tests separately from live results. Until owner activation and
real authentication, the overall account task remains PARTIAL.
