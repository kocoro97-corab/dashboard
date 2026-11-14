# Existing development public-market connection

URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html

This change includes the earlier 231a2b4 display fixes. Publish the latest artifact
once with the existing owner publisher; no intermediate publication is needed.
The current integration cannot write dashboard-v2-dev (existing GitHub 403), so
publication and the private Cloud Shell launcher remain owner steps. No new GAS,
Sheet, authentication settings, account, provider or deployment is created.

## Data path

Browser existing market/chart/news functions → existing HTTPS relay publicFetch →
existing GAS sessionInfo authorization → existing GAS public GET proxy → existing
Naver/Yahoo/Google News/Daum public endpoints. Tokens stay in the HTTPS request
header and GAS session POST body; they never enter a URL or the vendor request.
GAS source and the existing session authority are unchanged.

The launcher adds opt-in `--public-market`. Default launches remain auth-only.
Even with this option, only auth routes and publicFetch are allowed. The new
market_routes module restricts publicFetch to the actual UI paths, parameter
names/values and bounds. Arbitrary same-host URLs, credential-bearing URLs,
private/account/order endpoints, nested arbitrary targets, additional fields and
duplicate queries are rejected before upstream calls. GAS verifies the session
before every public GET, including expiry and required password change.

Existing exact Origin/HTTPS/Host/private development code, body/rate/concurrency
limits, fingerprint verification, redirection rules and expiry remain enabled.
Public responses are bounded to 2 MiB with a 20-second GAS GET timeout. No NH
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
only two fixed URLs (Naver KOSPI and default market-news RSS) through existing GAS
and directly from the same Cloud Shell. This mode creates no tunnel or browser,
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
