# Development HTTPS relay (existing test GAS only)

This stage reuses the owner-verified local relay and existing isolated GAS,
Sheet, Properties and dashboard account. It does not create or deploy GAS, call
NH, change the operating Pages site, or repeat the old five-minute local test.

## Hosting and cost

The development-only candidate uses an accountless Cloudflare Quick Tunnel from
the existing owner Cloud Shell, plus a **separate public frontend repository**
`kocoro97-corab/dashboard-v2-dev`, branch `dev-pages`, in the existing GitHub account.
The source remains in `dashboard` branch `feat/nh-integration-v2`. No new external
account, paid plan, billing activation, domain purchase or Cloud Run deployment is
needed. No CI workflow is exported to the frontend repository.

Quick Tunnels are free, temporary development endpoints, not production hosting.
The hostname changes at each launch and availability is not guaranteed. The owner
must keep Cloud Shell running; the default maximum lifetime is 30 minutes. Stop
the foreground process with Ctrl+C to close the relay and tunnel. Do not assume
the static Pages URL alone means the backend is running.

Official sources: [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[free/accountless service](https://blog.cloudflare.com/protected-quick-tunnels/),
[GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Security boundary

- Existing GAS remains the user/session/admin authority. Public exposure is
  restricted by default to `appVersion`, `login`, `sessionInfo`, `logout`.
  The explicit `--public-market` profile adds authenticated `publicFetch` only
  for the exact existing public-market GET routes. All NH, account storage,
  editor diagnostic, arbitrary proxy and order actions still stop before upstream calls.
- The origin HTTP server binds to loopback only. Only the connected tunnel's exact
  Host and Cloudflare's HTTPS scheme header are accepted. HTTP clients are rejected
  before reading credentials; browser endpoint configuration also requires HTTPS.
  TLS verification is never disabled and client API redirects are rejected.
- CORS allows only `https://kocoro97-corab.github.io`. Same-account project Pages
  **share this origin**: a different repository is not a different browser security
  origin. The server additionally requires a development-client marker
  (or the legacy exact development-page referrer) and a private, per-launch
  development access code. Marker/Referrer/Origin are routing
  controls, not user authentication; the development code and existing GAS session
  are checked separately. An attacker-controlled same-origin script is not isolated
  by storage prefixes; this deployment trusts the owner's reviewed Pages code.
- The development artifact uses **prefixed sessionStorage only**, including the
  existing session timer, settings and logout. It never adopts or clears operating
  localStorage. Token and access-code state stay in that tab. Changing the relay
  endpoint clears development state before another request. No code/token/password
  is in a URL, public config, GitHub file, CLI argument or diagnostic report.
- The client retains standard `strict-origin-when-cross-origin` referrer privacy.
  Mobile browsers may omit Referer; the public `X-MyInvest-Dev-Client` marker
  identifies routing intent without treating a path as authentication. The client
  validates its exact development page before sending this marker. Explicit
  production-path referrers remain rejected. The page rejects query/fragment
  configuration and credentials are never in that URL.
- A restrictive development CSP blocks external scripts/widgets and direct GAS
  browser calls. The existing HTML/authentication is reused; the development
  bootstrap establishes the test connection and suppresses normal account/market
  initialization for this auth-only page. Missing setup/transport fails
  closed. Operating GAS URL defaults are removed from the exported artifact.
- Global limits: 120 requests/minute (including OPTIONS), 5 login attempts/minute,
  2 concurrent upstream requests, maximum 8 KiB POST body, maximum 60-minute launch.
  Supplied IP headers cannot evade these limits. Expiry and owner shutdown reject
  traffic before GAS. The tunnel's debug/management routes are disabled.
- The connector binary is pinned and checksum verified. Its output is consumed
  privately and discarded; only the public endpoint is printed. No access code,
  password, session, request body/header, financial data or raw upstream error is
  logged. Existing tunnel configurations cause a stop instead of being overwritten.
  Cloudflare terminates HTTPS and is part of the approved development transport;
  no NH API keys or financial account responses are sent through this auth-only path.

## Owner setup and actual verification

If startup stops with a generic result, use the same environment/binary arguments
with `--diagnose-preflight`. This reports only a fixed phase and allowlisted reason
for local connector, private plan, read-only GAS source identity and deployment
checks. It does not prompt for a code/password, open a tunnel, run a browser,
log in, or write account data. A successful `HTTPS_PREFLIGHT_ONLY` result is not
an actual HTTPS/login PASS. Normal startup also includes phase/reason diagnostics;
raw exceptions, source, credential values and private paths remain suppressed.
If startup reaches `PUBLIC_HTTPS_PROBE`, failures include a sanitized `probe`
summary: HTTP status, JSON/HTML/OTHER, approved/missing/other CORS, a known relay
reason if present, or a TLS/DNS/timeout/network category. Response bodies, Location
URLs and exception text are never reported. Login/session and metadata POSTs
are never retried.
For a new tunnel, the required local DNS lookup is now checked before constructing
the authenticated metadata request: up to 8 DNS checks within a 30-second budget.
Only EAI_NONAME/EAI_AGAIN are retried; a hung lookup stops within the budget.
An active HTTPS proxy/NO_PROXY route is preserved, so proxy-resolved public names
are not incorrectly required to resolve locally. IP results are never used as a
fallback endpoint. System DNS, proxies and TLS settings are not modified.
On exhaustion, `HTTPS_DNS_NOT_READY` reports the target role, attempt count and
DNS-only control results, without hostname/IP/proxy credentials. This does not
establish whether the cause is temporary propagation or a persistent resolver
policy. After DNS, credential-free OPTIONS checks wait only on HTTP 530: at most
6 attempts within 30 seconds, using the same endpoint and verified TLS. Progress
is `HTTPS_EDGE_WAIT`; persistent 530 stops with `HTTPS_EDGE_NOT_READY`. Known
plain-text Cloudflare error codes 1016/1033 are reported as numbers only; their
absence leaves the direct cause unconfirmed. Other status/transport failures
stop immediately. An exact approved CORS origin, POST method and current client
headers must be advertised before proceeding. No access-code value, password,
session, request body or upstream GAS call is involved in this readiness wait.
The authenticated metadata POST is still sent once, only after readiness passes.
This addresses transient edge readiness without treating a persistent 530 as a
successful connection. The observed 530 alone does not establish its direct cause.
This change is in the owner launcher only; existing development Pages assets do
not need republication. Reuse the existing GAS and restart with the updated tool.

Codex's current GitHub integration received HTTP 403 when attempting to create
the separate development repository. The connector's issuance attempt also
failed in Codex; a subsequent diagnostic GET to the public issuance API returned
HTTP 403. The direct cause of the connector failure was not established. These
are unresolved external access limitations, not a
successful public deployment or a GAS authentication failure. No new repository
was created by those rejected requests. Owner execution is required for these
external steps; do not create a new provider account or enable billing.

1. Check out the exact verified feature commit in the existing owner checkout.
2. Use the existing GitHub account's `gh` login if repository creation/Pages
   permission is not already available. No GitHub token should be pasted into chat.
3. Run `python3 tools/publish_dev_pages.py --publish-dev-pages`. It exports only
   allowlisted public assets and creates/reuses the fixed development repository.
   It refuses other accounts/repositories, private plans, unknown existing content
   and conflicting Pages settings. The operating repository's Pages settings are
   never an API target. A pending Pages build is NOT_RUN, not an authentication FAIL.
4. Run `python3 tools/install_dev_tunnel.py --output <private-user-bin-path>`.
   The official Linux x86_64 connector is verified against the pinned SHA256.
5. Run the existing Python/Playwright environment with:

   ```bash
   python tools/nh_v2_https.py --environment <existing-private-test-directory> \
     --cloudflared <verified-user-bin-path> --verify-browser
   ```

The tool checks existing project/sheet/deployment/source identity, then asks for
a **separate temporary development access code** (16–128 ASCII letters/digits,
underscore or hyphen, hidden). Do not reuse the dashboard password. It waits for
the tunnel connection and performs a TLS-verified metadata probe before printing
`HTTPS_DEV_READY` and the public endpoint. The tool does not print the secret code
or write it to a file; the development tab retains it in sessionStorage for reload.
Enter the existing dashboard username/password only at the private
visible/hidden prompts for the optional actual Chrome check.

The new actual check uses the real development Pages URL, normal Chrome TLS/CORS,
and no request interception. It checks the published source commit, connection,
development gate, unauthenticated denial, existing login, refresh/session restore,
logout/token rejection and operating localStorage preservation. It does not redo
the already-passed local flow or five-minute wait. The relay remains available for
Fold6 until Ctrl+C, tunnel exit, or its maximum lifetime. Browser failure closes it.

## Fold6

Connection failures show only a local allowlisted code and HTTP status, never a
raw response, exception or entered value. `DEV_ACCESS_REQUIRED` means the separate
code was rejected; `DEV_PAGE_REQUIRED` means the request lacked the development-client
marker/legacy page referrer or supplied an explicitly different project path; `DEV_NETWORK` means no readable response
arrived and does not establish a wrong code. Report only that code before changing
credentials or retrying. The development inputs disable mobile autocapitalization.

After Pages publication and `HTTPS_DEV_READY`, open
`https://kocoro97-corab.github.io/dashboard-v2-dev/` in Chrome on the phone. Enter
the endpoint printed by Cloud Shell and the separate access code privately; then
use the existing test dashboard login. There is no credential-bearing sharing URL.
Test the cover screen, unfolded screen, fold/unfold, refresh, scroll/touch and
logout. Account/market data is deliberately unavailable in this auth-only test;
do not classify financial rendering as PASS. Physical Fold6 remains NOT_RUN until
the owner performs it. Never send the access code/password or browser storage to chat.

## Evidence labels

`tests/browser_https_dev.py` uses simulated Pages/HTTPS with synthetic GAS. Its
Playwright routing does not prove real HTTPS/CORS behavior. The owner tool has no
routing and reports `LIVE_HTTPS_PAGES_TO_TEST_GAS` only after actual verification.
The prior `LIVE_GAS_AUTH_ONLY_VIA_LOCAL_RELAY` PASS remains valid but separate.

### Mobile referrer compatibility update

Update the relay and publish the matching development artifact together: the new
client marker requires the updated preflight allowlist. Restart the old relay
after updating source, and use the newly printed endpoint. Existing GAS, Sheets,
Properties and credentials remain unchanged. Synthetic browser checks cover both
origin-only and missing Referer; actual Fold6 verification remains an owner step.

### Credential-free DNS comparison

When `HTTPS_DNS_NOT_READY` persists while the known-service controls resolve, do
not infer a wrong code, alter system DNS, or repeatedly restart authentication.
Use the existing launcher with `--diagnose-tunnel-dns` and the usual environment
and connector arguments. This mode checks the pinned binary, opens one temporary
tunnel against a reserved **unlistening** loopback port, and compares the allocated
hostname using the system resolver and Cloudflare's HTTPS DNS JSON service. It
samples at most three times, then closes the tunnel. No application is exposed.
The environment path argument is retained for CLI compatibility but its contents
are not read in this mode. No Google/GAS access, password, development code,
account data or login is needed. Only a public allocated hostname is sent to the
fixed Cloudflare DNS diagnostic endpoint; returned addresses are never printed,
stored or used for connection routing. HTTPS redirects are rejected.

- `PUBLIC_ONLY_RESOLVES`: the sampled public resolver has an A record while the
  system resolver fails. Local caching/resolver behavior needs investigation;
  this does not identify its exact cause or change the application's resolver.
- `BOTH_UNRESOLVED` with `NXDOMAIN`: neither the system nor this sampled public
  resolver resolves the new name. Issuance/propagation needs investigation; one
  recursive resolver is not proof of a global provider outage.
- `BOTH_RESOLVE`: both resolve at this snapshot; it is not a login/HTTPS PASS.
- `SYSTEM_ONLY_RESOLVES` or `INCONCLUSIVE`: retain the categories for further
  analysis without making a routing/authentication change.

The final report deliberately keeps application status `NOT_RUN`, sets
`diagnosticComplete`, and includes only these fixed categories. It never reports
raw DNS answers, IPs, private paths or exception text. A new provider account,
domain, paid service or Pages republication is unnecessary for this diagnostic.

### Readiness of the actual allocation

A standalone DNS diagnostic allocates a different hostname and closes it at exit.
Its success cannot establish readiness of a later application allocation. The
owner observed this distinction: one diagnostic resolved immediately, while the
next normal startup failed its own DNS lookup.

Normal startup now compares the **same failing hostname** with the existing
Cloudflare DNS diagnostic while its connector is still alive. Only when the
system lookup fails, both known-service controls succeed, and public DNS reports
`NXDOMAIN` or no A record, it closes that allocation and requests another. It
reports `HTTPS_TUNNEL_REALLOCATING` and tries at most three allocations total.
Every replacement fully closes the preceding tunnel/application before opening
the next. The working allocation stays open for actual connection; the final
`HTTPS_DEV_READY` includes `allocationAttempt`. No separate diagnostic run or
Pages republication is required.

A public A-record answer with a system failure and healthy controls now retains
the same tunnel for up to 60 additional seconds of system-DNS-only waiting, within
the original access lifetime (HTTPS_LOCAL_DNS_WAIT). Persistent failure stops with
localWaitAttempted=true. Unavailable diagnostic service, DNS SERVFAIL, failed
controls or proxy-DNS failure stops with enriched evidence.
HTTP, TLS, CORS, authentication and failures after readiness never trigger an
allocation replacement. The only repeated operation is allocating an unpublished
credential-gated development tunnel after verified DNS absence. No login or
metadata POST is replayed: the DNS-not-ready code arises before HTTP construction.
No resolver/proxy settings, TLS checks, GAS modules or account data are changed.
Three failures remain NOT_RUN; this is bounded recovery, not a claim that the
provider registration problem or local resolver cause has been established.

## Public-market opt-in

See [PUBLIC_MARKET_DEVELOPMENT.md](PUBLIC_MARKET_DEVELOPMENT.md) for the new
restricted public-data profile and actual/synthetic verification distinction.
Reuse the same environment and add `--public-market`; add `--verify-market`
for one owner-authorized actual display check. Defaults and earlier auth-only
results remain distinct. No NH or saved-account operation is enabled.
