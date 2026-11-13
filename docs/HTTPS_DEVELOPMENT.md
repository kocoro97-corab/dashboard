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
  restricted to `appVersion`, `login`, `sessionInfo`, `logout`; all NH, account
  storage, editor diagnostic, proxy and order actions stop before upstream calls.
- The origin HTTP server binds to loopback only. Only the connected tunnel's exact
  Host and Cloudflare's HTTPS scheme header are accepted. HTTP clients are rejected
  before reading credentials; browser endpoint configuration also requires HTTPS.
  TLS verification is never disabled and client API redirects are rejected.
- CORS allows only `https://kocoro97-corab.github.io`. Same-account project Pages
  **share this origin**: a different repository is not a different browser security
  origin. The server additionally requires the exact development-page referrer
  and a private, per-launch development access code. Referrer/Origin are routing
  controls, not user authentication; the development code and existing GAS session
  are checked separately. An attacker-controlled same-origin script is not isolated
  by storage prefixes; this deployment trusts the owner's reviewed Pages code.
- The development artifact uses **prefixed sessionStorage only**, including the
  existing session timer, settings and logout. It never adopts or clears operating
  localStorage. Token and access-code state stay in that tab. Changing the relay
  endpoint clears development state before another request. No code/token/password
  is in a URL, public config, GitHub file, CLI argument or diagnostic report.
- The full development-page referrer is sent deliberately to bind the shared
  origin to the test path. The page rejects query/fragment configuration and
  credentials are never in that URL. Production-path requests are rejected.
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
code was rejected; `DEV_PAGE_REQUIRED` means the browser did not supply the
approved development-page referrer; `DEV_NETWORK` means no readable response
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
