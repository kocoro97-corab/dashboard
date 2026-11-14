# Existing development public-market connection

URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html

This change includes the earlier 231a2b4 display fixes. Publish the latest artifact
once with the existing owner publisher; no intermediate publication is needed.
The current integration cannot write dashboard-v2-dev (existing GitHub 403), so
publication and the private Cloud Shell launcher remain owner steps. No new GAS,
Sheet, authentication settings, account, provider or deployment is created.

## Data path

Browser existing market/chart/news functions → existing HTTPS relay publicFetch →
existing GAS sessionInfo authorization → relay HTTPS GET to the existing
Naver/Yahoo/Google News/Daum public endpoints. Tokens stay in the HTTPS request
header and GAS session POST body; they never enter a URL or the vendor request.
GAS source and the existing session authority are unchanged.

The launcher adds opt-in `--public-market`. Default launches remain auth-only.
Even with this option, only auth routes and publicFetch are allowed. The new
market_routes module restricts publicFetch to the actual UI paths, parameter
names/values and bounds. Arbitrary same-host URLs, credential-bearing URLs,
private/account/order endpoints, nested arbitrary targets, additional fields and
duplicate queries are rejected before upstream calls. GAS verifies the session
before every public GET, including expiry and required password change. The public
profile does not call GAS doGet, which is intentionally disabled in staging.

Existing exact Origin/HTTPS/Host/private development code, body/rate/concurrency
limits, fingerprint verification, redirection rules and expiry remain enabled.
Public responses are bounded to 2 MiB with a 20-second public GET timeout. No NH
request, account read, Drive import, registration/admin action or store write is
added to the allowlist. NH collectors are also skipped by the development adapter.
The frontend waits for the relay's public capability before enabling market UI.

## Reused frontend and fixes

- getTxt now uses the explicit relay even when exported operating GAS defaults
  are empty. Previously its early MYP check prevented any public relay request.
- DevelopmentMarket invokes existing refreshMarket, showQ/loadQ, loadNews and
  theme controls. It queues public reads one at a time before their timeout starts,
  reserving server capacity for auth. Queue length is bounded at 48. Logged-out
  sessions or changed endpoints discard queued/in-flight results without replay.
- Public market/index cards, chart periods, refresh, rule-based scenario and news
  become available. Themes are manual to avoid an unnecessary initial batch.
- A failed/malformed RSS response is shown as failed/unconfirmed rather than
  claiming zero articles. Quotes that remain unavailable stop saying loading.
- OCR/Drive/manual registration/settings save remain disabled and unexecuted.
  Their existing functions and connections were inspected only: external image
  engine → local OCR review, Drive → externalDriveImages, manual → local draft,
  reviewed save → saveExternalHoldings, settings → tab storage plus refresh.
- TradingView's external widget remains blocked by the unchanged CSP. TICK's
  existing public-index estimate/manual input is not a live NYSE TICK feed.
- Personalized holdings news and an AI API remain unimplemented; default news
  and the existing rule-based analysis are labeled accurately.

## Verification and actual-data distinction

Direct public-source checks (no GAS/session): Naver index HTTP 200 JSON; Naver
chart HTTP 200 / 60 rows; Yahoo chart HTTP 200 with chart data; Google News HTTP
200 / 100 RSS items. These confirm real public sources from Codex's network,
not the owner's GAS proxy path. No public values/raw responses are logged.

Related scoped checks cover exact URL scope, rejected unauthenticated/revoked
sessions, unchanged NH/store restrictions, queue bounds/logout/target changes,
source failures, and synthetic UI at 344/1440 pixels. The new synthetic browser
check runs in existing CI; no manual full suite is repeated.

Actual Pages → HTTPS → isolated GAS → public API display is NOT_RUN until the
owner publishes and starts the updated launcher. Use existing private arguments
plus `--public-market --verify-market`. This reuses the existing browser verifier
and test login (no new auth setup), observes public quote/chart/news counts only,
and keeps the successful relay available for Fold6. No account action is used.
It reports fixed source counts and blocked UI state, not prices/passwords/tokens.
For manual testing omit --verify-market and use the existing test login in Pages.
A successful synthetic check is never reported as a live public-market PASS.

Operating Pages/main/release-pages/GAS/Sheets/Properties are unchanged. Actual NH
and order calls zero; account-store reads/writes zero. Normal test login/session
properties are handled only by the existing GAS authentication implementation.

## Zero-data actual result: narrow response diagnosis

The owner reported HTTPS/login PASS but zero quote/chart/news counts after the
public wait, with publicReadFailures=0 and 20 preflights. The published JS hashes
match 597a314. This rules out missing publication but does not establish whether
requests are queued, the capability is disabled, or HTTP-success responses contain
non-market data. No provider/GAS error cause has yet been confirmed.

Use the same owner launcher with `--public-market --diagnose-market` to compare
only two fixed URLs (Naver KOSPI and default market-news RSS) through the authenticated market reader
and directly from the same Cloud Shell. Before the transport correction, this
field was named gasProxy and used GAS GET; it is now authenticatedMarket. This mode creates no tunnel or browser,
needs no separate development code, and uses the existing private test login.
It validates the isolated target and existing session, revokes that test session
in finally, and makes no NH, account-store or Drive request. No transport fallback
or authentication rule changes are introduced by this diagnostic.

The result reports only format categories, whitelisted JSON key names, known
GAS/relay codes, valid-price presence and RSS counts. A JSON-string-wrapped body,
HTML and rejected JSON are never recorded as valid quote/RSS data. The direct
comparison uses verified HTTPS, exact public routes, no credential headers, no
redirects, a 15-second timeout and a 2-MiB cap. Values, arbitrary messages/keys,
URLs, passwords and tokens are never printed. This distinguishes a GAS proxy
problem from a Cloud Shell/provider problem without repeating the full browser
failure. No Pages publication is needed for this tool-only diagnosis.

## Confirmed staging GET failure and scoped correction

Owner evidence: both Naver index and Google News returned GAS_PUBLIC_HOST_DENIED
through staging, while direct reads in the SAME Cloud Shell returned valid price
data and RSS/100 items with HTTP 200. This confirms the failure is not browser
CORS, login, source availability or the Cloud Shell source network.

StagingBridge.gs intentionally has PROXY_ALLOWED_HOSTS=[] and a legacy GET stub
returning STAGING_POST_ONLY. Expanding the host list alone would not implement a
proxy and could open an unnecessary anonymous GAS surface. This was missed in
the initial public-data connection. No GAS code, versions, Sheets, Properties or
source digest are changed to fix it.

Only Config.public_market uses the corrected path: after the existing GAS
sessionInfo check succeeds, a separate public-only reader performs the exact
allowlisted GET. It constructs new fixed public headers and never receives a
password, token, development code, cookie or client-supplied headers. It preserves
default certificate validation/proxy/DNS behavior, rejects all redirects, caps
responses at 2 MiB/20 seconds, and never falls back to the blocked GAS GET.
The existing non-public-profile behavior remains unchanged.

Related backend reader/scope/session/security tests: 55 PASS. Existing normal
frontend/login tests are reused because those modules are unchanged. The owner
will publish the reviewed commit (including the marker required by the existing
verifier), restart the SAME relay with --public-market --verify-market, and
confirm public display. No repeat diagnostic mode or test GAS redeployment is
needed. Until that result, complete Pages-to-market verification remains NOT_RUN.

## Public record exists but system DNS still fails

The owner again observed system errno -2 while both control names resolve and
Cloudflare DNS reports ANSWER for the same allocated tunnel. This establishes a
system/public-resolver discrepancy; negative caching versus resolver policy is
not yet determined. It occurs before any public-market HTTP probe.

Startup now retains that same connector and waits for system DNS for up to 60
additional seconds (8 checks, 8-second intervals), bounded by the original public
access deadline. It prints HTTPS_LOCAL_DNS_WAIT. Only when system DNS resolves
does it continue the existing HTTPS/CORS/metadata probe. The initial failed probe
stopped before HTTP, so credentials or metadata POSTs are not replayed. No new
allocation is made for this condition. Persistent failure closes cleanly with
localWaitAttempted=true; resolver/DNS/proxy/TLS settings and fallback IPs are
unchanged. Existing missing-public-record reallocation remains bounded separately.

This launcher-only change does not require Pages publication. Start the normal
launcher with --public-market, keep the terminal open after HTTPS_DEV_READY, and
use the new endpoint in the existing development page. This avoids repeating the
already-passed login/session verification; a subsequent actual data display still
needs owner confirmation. Market transport and GAS settings remain unchanged.

## Actual display confirmation and chart-selection latency

The owner confirmed public index/quote cards, Korean/US chart switching, both news
sections and manual refresh work in the development page. KOSDAQ150 futures is
excluded as a pre-existing unimplemented feed; no new NH path is opened for it.
This is actual user display evidence, distinct from the earlier synthetic tests.

The owner measured chart transitions at approximately 5–10 seconds. Source review
shows fresh requests on every selection, a one-at-a-time public queue and GAS
session validation for each request. The contribution of each network stage is
not individually measured. A single 120-row Naver request returned an error in
a public parameter check, so that unconfirmed API change is not applied.

Only the development public-chart UI now keeps up to 12 in-memory symbol/period
entries for 30 seconds from receipt. Revisiting a chart within that window causes
no additional public API or GAS request and displays the cache age. It does not
cache account data, credentials on disk, or server authorization decisions. Scope
changes, logout/local expiry make prior entries ineligible; a response begun in
an older session cannot populate the new scope. Failures are not cached. Header
full refresh clears the cache and fetches fresh data. Normal non-development
chart behavior and all server authentication/permission rules remain unchanged.

Related tests: chart/cache 10 and public queue/full-refresh 7 PASS. Cold first
loads still incur network latency. Actual post-publication performance is not
benchmarked yet; no numerical speedup is claimed. The browser CI case also checks
that a recent Korean chart can be revisited after a US chart without another read.

Publish the latest public artifact using the existing publisher in another Cloud
Shell terminal. Keep the current working relay running: no backend/GAS update or
tunnel restart is needed for this frontend-only change. Reload the development
page, then revisit the same chart within 30 seconds to check the cache label.
