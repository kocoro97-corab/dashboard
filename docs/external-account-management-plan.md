# External account organization — compatibility plan

Current external holdings identify accounts only by ISA/PENSION/IRP. They cannot
distinguish two ISA accounts at different brokers. A table-only rename would
silently merge those positions, so persistent account identity is required.

Approved isolated-test extension (no production deployment, no row reset):

* Keep existing Sheets columns and AccountStoreV2 journal unchanged.
* Add optional `accountId` to holding JSON; absent IDs retain the existing legacy
  account-type identity. Existing rows and recovery history are not migrated.
* Store a small user-scoped catalog (opaque ID, broker, alias, existing account
  type) in a new namespaced test Script Property, with a revision and lock.
* Read legacy holdings as explicitly unclassified broker accounts. Never guess
  a broker or request actual account numbers. An empty account can be created.
* Editing broker/alias leaves holdings untouched. Account type remains immutable after creation; create another account and
  move reviewed positions to change type. Deleting an account with saved
  holdings requires moving/removing those holdings through the existing save first. Nothing is auto-deleted.
* If an old holding version is restored after catalog deletion, its archived broker/alias
  is recovered (unknown IDs remain unclassified) instead of dropping the holding.
* Advertise the catalog capability only from an updated isolated GAS. Older GAS
  retains original OCR/manual holdings functionality; never discard new IDs by
  silently sending them to an incompatible server.

New authenticated actions: `externalAccounts` (read) and `saveExternalAccounts`
(reviewed, user-scoped catalog CAS). Keep all existing session/authorization,
revision, escaping, request limits and order blocking. The existing owner-only
test GAS update procedure is required; Codex has no private Google credentials.

OCR/manual inputs use the existing accessible dialog; image recognition and
position review reuse the existing code. Drive remains explicitly deferred
(준비중) until the final development stage. No Drive route or OAuth scope changes.
GENERAL is an external manual category only, never an NH product code.
Catalog validation and holdings commit share the script lock to prevent races.

No project creation, operating GAS/Sheets/Properties changes, destructive
migration, guessed product codes or actual store writes are part of development
verification. Tests use synthetic brokers, accounts, images and holdings.

## Implementation and owner continuation

Preserved ChatGPT account UI commits through `0d838aa` and later market commits
through `94ea991`. No rewritten NH request/authentication module. The optional
store guard validates catalog membership under the same script lock as commit;
old clients cannot silently remove individual account IDs. Empty accounts are
soft archived, preserving labels needed by historical holdings recovery.

`js/external-account-ui.js` owns metadata CRUD and input target selection;
`page-accounts.js` owns grouped reports. OCR geometry/name matching remains in
the existing module. The reviewed save control is beside the main position
review table, outside the input dialog. Broker suggestions already saved in the
browser remain available; they are never automatically assigned to legacy rows.

Synthetic validation: catalog CAS/user isolation; same broker multiple accounts;
two images deduplicated in the selected account; same symbol in another account;
review/save/read/recovery; archived metadata recovery; nonempty deletion blocked;
partial totals/verified identities/currency; logout; 344/690/1440 layouts.
Live test GAS code/property changes and physical Fold6 remain unverified here.

The owner must upgrade only the EXISTING isolated test GAS, using the existing
private environment. No new project, Sheet, OAuth scope or data reset:

```bash
cd "$HOME/myinvest-v2-live" &&
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only origin/feat/nh-integration-v2 &&
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_upgrade.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2"
```

Then start the existing approved account-management profile:

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_https.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --cloudflared "$HOME/.local/bin/myinvest-cloudflared-2026.11.0" \
  --minutes 60 --public-market --account-management
```

Use the newly printed HTTPS endpoint and private development code on the dev
page. Keep the terminal open; Ctrl+C closes external access. Do not post the
code, token, password, account data or private environment files. Do not repeat
the earlier private NH-only login test. Verify the changed account catalog and
save/read/recovery once with approved synthetic material before personal data.

After storing optional account IDs, retain a schema-aware GAS reader. Never
roll back to an older writer that drops IDs. The upgrade tool's code backup
contains no new account data and does not replace the holdings recovery journal.
