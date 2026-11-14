# V2 development-page usability review

Development URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html

This reuses the existing feature branch, Pages repository, HTTPS relay and isolated
GAS. Publish the current public artifact with the existing owner publisher; no
new project/provider or operating deployment is involved. The relay must remain
running, and the endpoint/access code are entered privately in each browser.

The public artifact now initializes the existing V2 local renderers instead of
only its clock. This adapter is exported only for development; operating index,
authentication, transport, GAS gateway and store implementations are unchanged.
Unqueried tables say "not queried", rather than implying empty accounts or zero
balances. It does not insert sample data. Features that would start NH reads,
read/write saved financial information, load third-party OCR/widgets, or perform
account administration remain unavailable in this profile. The server's existing
auth-only allowlist independently enforces this boundary.

| Feature | Status | Evidence / limit |
|---|---|---|
| Existing isolated login/logout | Normal | Prior actual owner PC and Fold6 success; unchanged authentication |
| Session restoration on refresh | Unverified live | Current synthetic login/reload/session restoration passes |
| PC / Fold6 screen rendering | Normal in simulation | 1440 / 344 / 768 px; new artifact still requires owner publication and real check |
| Index settings tabs and connection diagnostic menu | Normal in simulation | Open, switch and close; proxy editing remains disabled |
| Chart mode controls | Normal in simulation | Line/candle controls operate; chart data has not been fetched |
| Account/holding sections | Unverified live | Existing renderers display explicit unqueried state; no private records fetched |
| NH balances and quotes | Unverified | Separate user approval required; no calls made |
| Public market quotes/themes/news | Unverified | Existing auth-only relay/CSP profile restricts these calls; no live claim |
| Saved holdings/history and save/restore | Unverified | Existing store preserved, no data reads or writes in this task |
| OCR/Drive import | Unverified in this profile | Existing implementation retained; current public artifact excludes external OCR engine and Drive access |
| Definite unimplemented requested features | None established | A restricted or untested feature is not classified as absent |

Related tests: Python public development/relay/tool security 39 PASS; Node
transport/session 16 PASS; synthetic browser checks include rendering, menus,
login/reload/logout, origin/development-code enforcement and unchanged operating
storage. Browser network assertions allow only appVersion/login/sessionInfo/logout
plus public same-origin assets, and reject unexpected hosts/actions. These are
synthetic checks, not a fresh real Pages/GAS or physical Fold6 result.

Actual NH/order calls: zero. Account-store writes: none. Operating Pages/GAS/
Sheets/Properties/main/release-pages changes and PR merge: none. Existing private
history/backups remain intact. The current connector cannot write dashboard-v2-dev
(earlier GitHub 403); the owner's existing Cloud Shell publisher is the remaining
step before reporting the new development artifact as live.
