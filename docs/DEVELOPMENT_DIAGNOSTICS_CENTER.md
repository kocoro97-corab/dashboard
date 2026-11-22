# Development diagnostics center

The generated development frontend adds **검증·진단** at `#/diagnostics`.
The source/production index does not enable or load this development-only menu.

## Consolidated information

- Read failures, browser script/rejection errors, route failures and supported
  analysis/storage diagnostic codes appear in one session-scoped overview.
- Sector series exclusions are grouped by reason and country/category/period;
  individual stock identifiers are not copied into the diagnostic record.
- The manual AAPL five-minute reference probe moved from Strategy to Diagnostics.
- The duplicate shell development status, business-page connection-error panel
  and settings diagnostic summary are suppressed only in the development build.
  Useful missing-data, observation-time and partial-coverage notices stay with
  the affected financial data.
- Menu coverage and explicitly executed connection checks are separate tables.
  A mounted/ready screen is not a successful API verification.

Opening or refreshing this overview does not run APIs, account inquiries,
storage/recovery operations or the AAPL probe. The probe still requires its
existing explicit button. Existing authorization and transport restrictions
remain in force.

## Evidence and privacy limits

This is an observed-event collector, not an exhaustive automatic audit. Unvisited
menus are marked untested; unexecuted checks remain `NOT_RUN`. Browser-observed
AAPL evidence is labelled separately from independent transport verification.
The overview never claims real-time status from reception time alone.

Records are in memory for the current login, bounded to 100 diagnostic items,
and cleared at logout or session-identity change. Successful follow-up reads
resolve their exact originating diagnostic slot while preserving safe history.
No raw response, error message, URL, token, account identifier, holding, price or
balance is exported. Copies contain allowlisted codes, menu, known error layer,
HTTP status, counts and observation timestamps. Unknown layers stay unknown.

## Verification

- `node tests/development-diagnostics.test.cjs`
- `python3 -m unittest tests.test_strategy_comparison_dev_bundle`
- `python tests/browser_diagnostics_center.py`
- `python tests/browser_five_minute_reference.py`
- `python tests/browser_invest_workflow.py`
- `python tests/browser_integration_958.py`
- `python tests/browser_sector_followup.py`

Browser fixtures use synthetic authentication and data. The center test checks
1440/690/344 CSS-pixel viewports and CSS zoom simulation at 100/125/150 percent;
this does not establish native browser zoom or physical Fold6 verification.
Published-asset tests are likewise distinct from owner-authenticated live API
verification. No NH, order, operating GAS or account-store calls are required.

The existing development-only sliding one-hour session transformation remains
unchanged. No Worker, GAS, authentication source, operating storage or order
code is changed by this consolidation.
