# Remaining V2 development connections

Existing public-market/login results remain valid and were not rerun. The owner
requested proceeding without another chart-cache check. This stage reuses the
same branch, dev Pages and active relay; no GAS or authentication settings change.

| Feature | Existing path | Current boundary |
|---|---|---|
| Manual entry | addExternalManual → validate/merge/confirm → local EXT_ASSETS → edit/undo | Development UI now enables in-memory preview only |
| Save | reviewed draft + revision → saveExternalHoldings → AccountStoreV2 | Existing implementation preserved; button disabled and relay denies the action |
| OCR | Tesseract → parseExternalOcr → review → local draft | Parser/review implemented; exported dev artifact omits the external engine and workers |
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
or server permission rule is rewritten. Other account/Drive/OCR/settings controls
remain disabled. The server independently rejects account/store/NH operations.

Synthetic browser checks at 344/1440 px add ISA/PENSION/IRP rows, edit quantity,
undo, confirm save/Drive/OCR/NH controls remain blocked, and confirm logout/new
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

Next: publish this frontend together with the pending chart cache if desired,
keeping the active relay alive. Real OCR needs a reviewed/pinned local engine and
worker/model asset/CSP connection; Drive needs a defined test handler and existing
Google permissions review. Neither is implemented or opened here. Actual account
reads, persistence and NH remain separately unauthorized.
