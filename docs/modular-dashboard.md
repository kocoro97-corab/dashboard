# MY INVEST V2 modular dashboard

The single scrolling screen is now an eight-route application. This is a gradual
adapter migration: existing authentication, NH requests, OCR, revision checks,
Sheets storage and recovery contracts are preserved. The approved external
account extension adds optional holding IDs and a user-scoped metadata catalog;
see `external-account-management-plan.md`. Production branches and data remain unchanged.

## Routes and module ownership

| Hash route | Page module | Existing functionality reused |
|---|---|---|
| `#/home` | `page-home.js` | Shared `Q/SRC/QT`, existing portfolio calculations |
| `#/market` | `page-market.js` | Market cards, futures, TICK, macro live preview |
| `#/sectors` | `page-sectors.js` | `themes.js`, existing theme collection/rendering |
| `#/stocks` | `page-stocks.js` | `chart.js`, symbol input, line/candle/range controls |
| `#/strategy` | `page-strategy.js` | Existing deterministic scenario calculation |
| `#/news` | `page-news.js` | Existing market/default-watchlist news and source/time |
| `#/accounts` | `page-accounts.js` | NH, external accounts, OCR, save/recovery adapters |
| `#/settings` | `page-settings.js` | Existing settings and connection diagnostics |

Account subroutes are `overview`, `nh`, `special`, `ocr`, `holdings`, `analysis`.
Opening the original URL falls back to `#/home`. Unknown routes normalize to
home; queries and unregistered/secret-bearing hashes remain invalid at the
development transport boundary. Hashes are never appended to relay requests.

## Common contracts

`app-router.js` owns hash history; `app-shell.js` owns navigation, active page,
independent scroll positions, mounting and error isolation. `app-context.js`
provides authentication status (no token in the public status object), settings,
public data access, per-session request deduplication and account snapshots.

Each page factory returns `mount(container, context)`, `refresh(context, force)`,
`unmount()` and `getStatus()`. Existing page modules register at startup.
`DashboardShell.connect('market', factory)` or `connect('sectors', factory)` can
install a trusted, bundled Work module using this same contract. Its factory is
validated before mounting. Call `context.once(key, loader)` for shared requests,
subscribe with `context.subscribe(callback)` and release the returned subscription
on unmount. Do not add global timers or send private data to a new service.

The existing modules still have ID-based DOM dependencies. Their original nodes
are moved by `page-adapter.js` into the active page and returned to a hidden,
noninteractive compatibility host on unmount. Inactive new views are detached,
subscriptions removed, macro work disposed and account auto-refresh paused.
The compatibility host keeps existing async renderers safe; it does not start
inactive-page collectors. Navigation is implemented by lifecycle modules and
scoped loaders rather than toggling eight complete copies of the old screen.

The shell starts a single existing clock. Per-page initial data jobs are shared
within the authenticated session. Visiting another menu never replays a request
solely because its DOM was remounted. Explicit refresh affects that page.
Logout discards page instances, independent scroll state and context job scope;
existing auth/account cleanup remains responsible for clearing private state.

## Account safety

`account-overview.js` maps existing NH/external state to `WorkPortfolio.analyze`.
NH `evalAmount` and `profit` are already KRW, including overseas positions: these
are not converted again. Missing external prices/identity are null. No FX rate
is invented. The UI shows a known subtotal and partial scope when stores/accounts
are unqueried, a side fails, quotes are missing or a draft is unsaved. Account
details remain distinct; confirmed instrument identities feed combined exposure.
Unknown identities are not guessed. Original account numbers never enter new
summary labels. There is no realized-P/L substitution or fabricated history.

The default development profile blocks NH/private storage. The owner-approved
account capability in `accounts-live-connection-plan.md` enables isolated private
reads and reviewed OCR/manual save/restore with `--account-management`. Existing
authentication, revision checking and recovery remain in effect. The earlier
fixed synthetic-only profile is optional, not a restriction on normal account
use. The page displays actual server capabilities and connection diagnostics.
The original full source profile retains its existing private handlers.
Any further permission expansion requires separate authorization.

## Validation and limits

`tests/browser_app_shell.py` exercises all eight routes, account subroutes, direct
entry, reload/history, session/draft preservation, two-image OCR import/dedup,
independent scroll, no duplicate page reads, logout/relogin, error isolation,
344/690/1440 px layouts and a fold/unfold size transition. It uses synthetic
authentication, market data and an in-memory store. Its full-source case checks
the original save/recovery flow; its development cases assert that private scope
remains blocked. This is not a live GAS/NH or physical Fold6 result.

Existing module browser fixtures isolate their original DOM adapters. The new
browser suite tests actual routed integration, without stubbing the router.
Node regressions cover strict route validation, transport boundaries and account
totals/unknown prices/partial queries. Existing NH/OCR/store tests remain present.

Live owner NH read results from before this screen migration are retained as
prior evidence, not rerun or relabeled as a new live integration result. Physical
Fold6, live login/market data on the new routes and real store writes/recovery
must be reported NOT_RUN unless performed in the approved private environment.
No actual orders, actual account writes, paid AI or production deployments are
part of this change. Economic calendar, relative sector strength, detailed stock
fundamentals/watchlist UI and advanced trading-plan UI are visibly unconnected
until their independently supplied Work modules are integrated.

## Persistent relay support

See `persistent-relay.md`. A verified `config/development-relay.json` selects a
fixed isolated Worker and removes address/code entry. Until the existing account
and deployment are verified, the current temporary tunnel remains active.
