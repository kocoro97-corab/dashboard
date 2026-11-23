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

## Explicit execution states

| State | Display | Meaning |
| --- | --- | --- |
| `NOT_RUN` | 실행 전 | The connected manual check has not started in this session. It is not queued for automatic execution. |
| `RUNNING` | 실행 중 | Capability verification or the data request is in progress. |
| `PASS` | 성공 · 브라우저 관측 | Parsed browser evidence meets the existing reference contract; real-time and signal verification remain false. |
| `PARTIAL` | 일부 성공 | A response was parsed with incomplete coverage or other reference warnings. |
| `BLOCKED` | 실행 불가 | The user attempted a check but the required relay capability was unavailable. |
| `FAIL` | 실행 오류 | A request or data validation failed, or purported positive evidence was invalid. |
| `CANCELLED` | 취소됨 | Closing or route/session cancellation interrupted an in-flight check. |
| `NOT_CONNECTED` | 결과 수집 미연결 | This overview does not yet collect a dedicated result for the check. This is not a verdict on the underlying feature. |

Only the AAPL check currently supplies a dedicated lifecycle result. The other
four rows must not imply they ran, are automatically waiting, or failed merely
because they have no connected collector. General runtime/read errors from their
pages are still collected separately. Retrying replaces old bar evidence with
the running state. Closing a completed reference clears the chart but preserves
its completed diagnostic result until the session ends or the page reloads.

The user supplied a browser report from source `b217c806b683`: HTTP 200,
`REFERENCE_VALIDATED`, 78 AAPL/USD five-minute bars, full provider-window coverage,
and zero scoped NH/account/order calls. This is **user-reported browser-observed
PASS**, not independently verified owner identity, transport provenance, current
market freshness, or a trading signal. It is not preloaded as a PASS in later
login sessions.
