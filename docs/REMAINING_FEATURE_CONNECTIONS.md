# Remaining V2 development connections

Existing public-market/login results remain valid and were not rerun. The owner
requested proceeding without another chart-cache check. This stage reuses the
same branch, dev Pages and active relay; no GAS or authentication settings change.

| Feature | Existing path | Current boundary |
|---|---|---|
| Manual entry | addExternalManual → validate/merge/confirm → local EXT_ASSETS → edit/undo | Development UI now enables in-memory preview only |
| Save | reviewed draft + revision → saveExternalHoldings → AccountStoreV2 | Existing implementation preserved; button disabled and relay denies the action |
| OCR | Local Tesseract → existing parseExternalOcr → review → local draft | Connected in development artifact; actual engine tested with synthetic images; real user captures not yet tested |
| NH account inquiry | Existing nhAccounts → domestic/overseas balance | Owner-private inquiry-only command prepared; public relay still blocks accounts; live check awaits owner authentication |
| Drive | frontend externalDriveImages → OCR/review | Current isolated GAS bridge has no handler; relay also denies the action |
| Index settings | local LS invest_cfg_v4 + refresh | Implemented but save remains disabled; not executed |
| External settings | local LS + optional NH refresh timer | Implemented but controls remain disabled; not executed |

## Applied manual-preview wiring

Only dev_inspection.js is changed in product code. It reuses existing manual
validation, merge, rendering and undo. Name/code/quantity/average price and the
account-type input are enabled; the existing save control is explicitly disabled
and labeled preview-only. The draft never populates storage revision or reads
saved rows. Unqueried account summaries are hidden rather than implying zero
balances. Price fields remain unconfirmed because NH requests are not enabled.

Existing UI cleanup is extended in this development adapter to clear manual
inputs and autocomplete suggestions on logout. Every login starts empty inputs;
no private values persist through a new session. No token/authentication logic
or server permission rule is rewritten. Other account/Drive/settings controls
remain disabled. The server independently rejects account/store/NH operations.

Synthetic browser checks at 344/1440 px add ISA/PENSION/IRP rows, edit quantity,
undo, confirm save/Drive/NH controls remain blocked, and confirm logout/new
login removes the local draft and inputs. The add/edit/undo portion makes zero GAS
requests; the complete fake gateway sees auth actions only. No real data was
entered, saved, changed or transmitted. No actual NH or order request was made.

## Existing results reused

CI 43557201396, regression job 132332625504, already passed six synthetic
ISA/PENSION/IRP mobile/desktop import/review/save/reload/restore flows. Its OCR
recognizer and API are mocked: these are not live OCR or actual store results.
The successful module and full suites were not manually rerun for this stage.

Drive is not merely an unopened CORS route: StagingBridge.securityLegacyDoPost_
currently dispatches only its existing NH actions, and Security.gs has no Drive
handler. Widening the relay alone cannot connect it. Production private source
was not read; no claim is made about the operating Drive implementation.

## Account inquiry and OCR connection

The owner authorized account inquiry and OCR testing, deferring Drive to the last
development phase. No GAS source, Properties, Sheet, auth or relay allowlist is
changed. `nh_v2_live_check.py --account-inquiry-only --browser` reuses existing
source/deployment/binding preflight, requires the existing dedicated admin, calls
nhAccounts once, validates identity/currency/partial results and logs out. It does
not capture/read/restore snapshots, request extra quotes, or write holdings. The
existing PC/mobile adapter compares that one response in an intercepted private
local browser; it does not send financial data through Cloudflare. Report fields
are status flags only. Live NH validation remains NOT_RUN here without the owner
Cloud Shell authentication. The public developer account button remains blocked;
financial data transport through a public relay has not been opened.

The development artifact includes official Tesseract.js/core 5.1.1 and pinned
eng/kor 1.0.0 best_int models (about 12.6 MB). Package SHA-512 and file SHA-256 are
recorded in `vendor/ocr/manifest.json`; build verifies every exported runtime file.
The engine and worker licenses are included. Only those allowlisted files ship;
no package install scripts run. All OCR assets come from the same Pages origin,
with no CDN scripts or image upload. CSP permits same-origin workers and WASM
compilation; ordinary eval and cross-origin workers remain disallowed. Embedded
WASM uses data: fetch. No browser flags or CORS/security bypasses are used.

`DevelopmentOCR` supplies the same fixed worker/core/language options to existing
recognition and crop refinement; models use no IndexedDB cache. Development UI
enables file selection/recognition only, capped at five images/10 MB each. Existing
review/merge/undo is reused, with save/Drive/NH price controls blocked. Logout
clears file selection, review/raw text, draft and warnings. No OCR values are
stored by this integration. Static asset browser caching contains models only.

Changed-scope results: account-inquiry unit cases 4 PASS; development security /
artifact cases 14 PASS; existing OCR matching cases PASS. Actual local kor+eng
engine recognized a generated Korean table into review/quantity/average price at
344 and 1440 px, without financial HTTP/store requests. Synthetic domestic and
overseas balances matched both display adapters with one fake inquiry. These are
not live NH, real capture, or physical Fold6 results.

Next: publish the existing development artifact from the owner Cloud Shell in a
second terminal, keeping a working HTTPS relay open. Run the inquiry-only owner
command once, and try OCR with one local capture on PC/Fold6 without sharing the
image or raw results in chat. Drive, persistence and public financial transport
remain closed; no new project, production deployment or merge is needed.

## OCR row omission repair

The owner's private OCR preview showed misread names and text line separation;
the preview does not contain the underlying word boxes, so exact original pixel
alignment is not established. A related parser failure was reproduced with
synthetic boxes: vertically overlapping name/quantity boxes whose centers differ
more than the old median-height threshold became separate groups. An unmatched
name with no numeric values in its group was discarded before crop refinement.
Also, the previous crop helper handled mixed Latin/Hangul names only.

The parser now permits a shared group only when the extra vertical overlap is
measurable and the candidate group is unique. Disjoint numeric/cash lines cannot
supply missing values. Existing center matching remains unchanged. Crop workers
reuse the same local engines; high-confidence full-name readings from either
language can now match the exact listing master. Disagreeing exact readings,
partial names and low confidence remain uncorrected review candidates. No alias,
stock-specific substitution or code guessing was added.

Changed-scope verification: OCR matching cases, plus 344/1440px browser checks
with actual local crop workers and synthetic initial OCR errors. Mixed-script
and Korean names were recovered while synthetic quantities/average prices were
preserved; no financial HTTP/storage calls occurred. The owner's original
captures, raw text and numeric holdings were not stored in the repository.
Confirmation against those captures remains pending development publication.
