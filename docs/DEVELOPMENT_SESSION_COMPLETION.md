# Development logout/session completion

The owner requested completion without additional questions. Implementation and
synthetic verification are completed here; **actual isolated server activation
requires the existing owner environment and is not claimed as completed**.

## Completed implementation

- The pinned development frontend uses one hour of actual user inactivity.
  Input, clicks, scrolling and touch reset it; automatic requests do not.
- Heartbeat and page-reload restoration distinguish definitive authorization
  refusal from transient network/busy/timeout/JSON failures. Retries are bounded,
  and the authentication screen remains closed to dashboard data until a restore
  succeeds. No passwords are replayed and no expired token is recreated.
- Stale restore/pulse replies cannot log out a newer login. A restore that
  arrives after local inactivity expires cannot reopen the dashboard.
- Manual logout retains immediate local cleanup and existing best-effort server revocation.
  Client expiry gets a specific reason; server refusal and verification failure
  get different fixed codes. Password-change guards remain authoritative.
- The isolated fresh GAS project can mint a one-hour session with a server-only
  `i` policy marker. Operating and non-fresh sessions remain five minutes, with
  their original record shape. Legacy tokens without the marker stay five
  minutes: activation never revives an expired legacy session.
- Both `securitySession_` and the staging login-time `purgeSessions_` use the
  token's effective limit. A new login no longer purges another valid hour token
  at five minutes. Malformed/expired records and the unchanged eight-hour
  absolute lifetime are still enforced. Password change revokes old tokens and
  mints a new policy-bound token.
- The fresh-project policy checks the script and Sheet identity, environment
  and existing fresh marker. No new Property, OAuth scope, project, user, account
  store or credential is introduced. Production has no policy hook and keeps
  its original five-minute default; no operating deployment is performed.
- Diagnostics distinguishes **server default policy**, **current token's
  effective idle limit** and the client hour. Missing metadata is “미확인”,
  not proof of an active server hour. A legacy token can correctly show five
  minutes under a newly activated sixty-minute server default.

The server window is measured from a verified server request, while client
inactivity is measured from user input. Heartbeats bridge those clocks while
running. OS/network suspension cannot revive a token past its actual server
deadline or eight-hour absolute limit.

## Existing-environment activation tool

`tools/nh_v2_session_activate.py` defaults to a local, read-only plan. `--apply`
requires the already approved private fresh plan, existing Google clasp login,
and existing Cloudflare account/token. The token prompt is hidden. Do not place
credentials in chat, command arguments, URLs or the public repository.

The tool:

1. Proves the private baseline source, identity and immutable deployment.
2. Refuses any changed GAS module beyond `Security` and `StagingBridge`, or any
   OAuth manifest change. Refuses an unactivated latest Worker candidate.
3. Confirms settings belong to the existing development Worker, then captures
   its exact active entrypoint and module bytes. It does not require a local
   build to match the provider's existing compiled representation.
4. Uses the existing isolated GAS upgrader and private source/version backups.
5. Creates a candidate with identical Worker code, strictly inherits every
   binding except `MYINVEST_EXPECTED_METADATA`, and replaces only that target
   proof with the new GAS source digest. Existing credentials, flags, upstream,
   Durable Object, logs, limits and all other settings stay unchanged.
6. Activates and reads back the exact source identity plus policy version 1,
   idle 3,600,000 ms and absolute 28,800,000 ms. Parallel actor changes are never
   overwritten. A failed readback restores the owned Worker/GAS connection, or
   explicitly returns `OWNER_REVIEW_REQUIRED` if concurrency prevents recovery.

The original `ACTIVE_WORKER_CODE_MISMATCH` preflight incorrectly assumed a
single locally generated `worker.mjs` must byte-match the active deployment.
That assumption is unnecessary for a metadata-only update and blocked the
owner before any mutation. The corrected tool clones the **active** bundle:
observed entrypoint, all supported ESM/CommonJS/JSON/text/binary/Wasm/source-map module names and
exact decoded payload bytes. No minification or whitespace equivalence is used.
It verifies the module SHA-256/size/type manifest before the GAS change, after
candidate upload **before activation**, during final verification and on rollback.
Malformed, ambiguous, oversized or unsupported bundles still stop; unreadable
code is never replaced with a local fallback. Multipart ESM and CommonJS types
are distinct and preserved. A raw main-module HTTP response's JavaScript MIME
alias is interpreted only with provider entrypoint evidence; it does not change
a multipart CommonJS helper into ESM. Local files and code hashes are
not uploaded as substitutes. Checkpoint files contain code manifests rather
than raw module bodies, and source bodies never enter result JSON.

Phase checkpoints are separate private files. Failed inactive candidate versions
are retained as evidence, not automatically activated or deleted. Do not repeat
an apply after a concurrency/manual-recovery result. Inspect the existing state.

From the reviewed source checkout in the existing owner Cloud Shell:

```sh
python3 tools/nh_v2_session_activate.py \
  --environment /home/kocoro97/myinvest-v2-fresh-private-r2
python3 tools/nh_v2_session_activate.py \
  --environment /home/kocoro97/myinvest-v2-fresh-private-r2 --apply
python3 tools/nh_v2_session_activate.py \
  --environment /home/kocoro97/myinvest-v2-fresh-private-r2 --inspect
```

Do not run apply if the local plan fails. `--inspect` is read-only, requests only
metadata and needs no owner app login. Activation changes neither existing
passwords nor account data. After activation, log out and log in once to mint a
new hour token; a pre-activation legacy token is deliberately not upgraded.

## Restrictions observed in this execution environment

- The supplied owner path is not mounted here. The default tool check returns
  `NOT_RUN / OWNER_PRIVATE_ENVIRONMENT_UNAVAILABLE`, without any remote mutation
  or credential prompt. No owner private plan/Google deployment access was used.
- The GitHub integration rejected even repository Actions secret metadata with
  HTTP 403 (`Resource not accessible by integration`). No secret values were
  requested or exposed. Existing operating deployment workflows target the
  protected production deployment and were not run or modified.
- Therefore actual GAS/metadata-binding activation and owner-authenticated
  device tests remain **NOT_RUN**. Code-only/synthetic success is not live server
  deployment success. Existing backend and account data were not altered.

## Verification

- Node server-policy tests execute the checked-in GAS against synthetic
  Properties and a controlled clock: six suspended minutes, sliding hour,
  operating five minutes, non-fresh exclusion, legacy expiry, purge across a
  new login, absolute expiry, revocation, password change and identity refusal.
- Browser tests at 1440/690/344 execute the checked-in GAS security function
  through the existing local Worker bridge, using synthetic identity/Properties.
  They verify six-minute survival, client activity, normal and reload-time 503
  recovery, unchanged inputs, policy display, expiry and private-state cleanup.
  This is neither live NH/GAS validation nor a physical Fold6 observation.
- Python activation tests simulate the Google/Cloudflare version APIs, exact
  single-binding change, read-only preflight, manifest/module refusal, full
  activation, recovery and concurrent-actor preservation. No live credentials
  or network are used.
- Full Node, Python, browser CI, frontend source/publication SHAs and public
  artifact digests are reported separately in the task result.

Actual NH/account/order calls: zero. Actual account-store writes: zero. Operating
`main`, `release/pages`, GAS, Sheets and Properties changes: zero.

Next owner: **Codex** — run the existing-environment activation once that
environment is available, verify the hour metadata, then an actual authenticated
foreground/suspension/re-login flow. No additional approval question is needed
for this already requested development-only scope.
