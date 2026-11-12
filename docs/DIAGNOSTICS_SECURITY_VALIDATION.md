# Issue #4 — GAS / frontend diagnostic privacy

Baseline: main `30bd0968a2dac441f660b2a0a1af26c61de33d10`.
Work is confined to a feature branch. No production deploy, publishing, account write, Sheet or Script Properties change is part of this work.

## Changes

- NH token/transport failures are rebuilt as local diagnostic codes with validated HTTP status only. Raw exceptions, credential-bearing URLs, response messages and malformed bodies are never echoed from these paths.
- All repository GAS log calls flow through one allowlisted code sink. Editor probes no longer print account suffixes, holdings, amounts, token metadata, quote values or upstream/specification text.
- General-account failures preserve the successful domestic/overseas side. Diagnostic strings contain local codes; raw `rsp_msg` is not returned. Normal authenticated holdings output, including the existing masked account label, is preserved.
- External quote errors constrain HTTP status, response codes and field names. Unknown response codes become `UNRECOGNIZED`; malformed symbol inputs use positional error keys.
- Storage errors use exact known codes rather than accepting every `STORE_` prefix.
- Legacy response boundaries replace unsuccessful JSON/error objects and POST non-JSON output with fixed errors. Proxy transport exceptions are caught. Successful responses and legitimate public proxy text remain unchanged.
- Frontend diagnostics accept only local messages/codes, bounded HTTP statuses and selected response-code categories. Login, password-change/admin errors, general/external accounts, OCR failures, protected holdings and theme debug paths cannot display arbitrary exception/response text.
- Global error/rejection handlers show fixed codes and prevent default raw error reporting. Modified script URLs have new cache versions; the diagnostics module loads first.
- CI runs the new synthetic browser privacy tests. This feature branch explicitly excludes the optional live-NH job, irrespective of repository variables.

## Validation

- Node **85** tests + Python **34** tests = **119 PASS**, including **17** new diagnostic privacy tests.
- Existing ISA/PENSION/IRP mock browser regression: mobile + desktop = **6 flows PASS**.
- New privacy browser regression: 344px + 1440px = **2 flows PASS**. Poisoned login HTML, application errors, partial account failures, failed external reads and unhandled errors do not expose synthetic canaries; existing holdings remain visible.
- JavaScript/GAS syntax and diff checks PASS.
- All new privacy inputs are invented canaries. No real account/credential/financial input or actual NH API call was used. No original OCR image was used in this work. Existing OCR fixtures and browser regressions remain synthetic.
- CI results and final feature SHA are recorded in the PR and Issue #4 after completion. Optional live job `skipped` is not counted as real API verification.

## Failure investigation

- Two initial quote regressions expected old raw errors or wording. The HTTP fixture now supplies a structured diagnostic and the network test checks the fixed failure code; price-clearing/partial-total assertions remain intact.
- The new diagnostic tests found a valid-code second-pass formatting loss; the canonical fixed-code grammar was made idempotent. Two new test-harness setup errors (source boundary and missing master metadata) were corrected without weakening application validation.

## Limits and release requirements

- The repository-owned GAS and frontend diagnostic paths were reviewed. The private production legacy `Code.gs` was not fetched or independently audited; its internal logging and third-party/platform logging are not proven by this PR. Its failure response boundary is covered by synthetic tests. An owner-side private review remains required before claiming that every production component has no sensitive logs.
- No actual NH/GAS execution or Fold6 hardware test was run for this security patch. The previous real staging results predate this patch and are not presented as its live validation.
- Old tabs keep old scripts until refreshed. On a future approved release, refresh/relogin and check fixed diagnostics with synthetic faults in isolation before production publication.
- Operational diagnostic detail is intentionally reduced: use local error categories and HTTP status, not upstream original text. If a new vendor response code needs support, add an explicit reviewed category rather than restoring raw logging.
- Do not publish private source, old logs, account suffixes, tokens or raw vendor responses in Issue/PR/CI. Production GAS/Pages deployment and main merge require separate approval.
