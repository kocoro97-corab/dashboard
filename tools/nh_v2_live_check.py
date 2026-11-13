"""Private owner-run fresh-environment NH -> AccountStoreV2 -> readback -> UI verification.
No actual rows, identifiers, tokens, numbers, exceptions, screenshots or traces are reported.
"""
import argparse
import getpass
import json
from pathlib import Path
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading

from build_nh_staging import ROOT, build, source_digest, PRODUCTION_SHEET_HASH
from nh_staging_test import WebApp, fingerprint, ApiFailure, SAFE_REPORT_CODES
from nh_v2_fresh import private_path, target, invoke, pull, logical, revision, OLD_SHEET, OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID


class Stop(Exception):
    pass


def preflight(directory, client=invoke, web=None, allow_same_source_tools=False):
    directory = private_path(directory, False)
    plan = json.loads((directory / 'fresh-plan.json').read_text())
    target(plan['scriptId'])
    current_revision = revision()
    if plan.get('phase') != 'NH_AUTH_APPROVAL_REQUIRED' or (plan.get('revision') != current_revision and not allow_same_source_tools) or plan.get('sourceDigest') != source_digest():
        raise Stop('FRESH_REVIEWED_PLAN_REQUIRED')
    web = web or WebApp(plan['url'])
    import re
    match = re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec', plan['url'])
    if not match or match[1] in (OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID):
        raise Stop('FRESH_TARGET_REQUIRED')
    bundle = directory / 'bundle'
    deployments = json.loads(client(['list-deployments', plan['scriptId']], bundle, plan['scriptId']))
    found = [d for d in deployments if d.get('deploymentId') == match[1] and d.get('versionNumber') == plan.get('activeVersion')]
    if len(found) != 1:
        raise Stop('DEPLOYMENT_IDENTITY_FAILED')
    with tempfile.TemporaryDirectory() as t:
        expected = Path(t) / 'expected'
        build(plan['scriptId'], plan['revision'], expected)
        expected_source = logical(expected)
        if logical(bundle) != expected_source or pull(client, Path(t) / 'head', plan['scriptId']) != expected_source or pull(client, Path(t) / 'immutable', plan['scriptId'], plan['activeVersion']) != expected_source:
            raise Stop('SOURCE_IDENTITY_FAILED')
    m = web.call('appVersion')
    if not (m.get('freshTestEnvironment') is True and m.get('testEnvironment') == 'nh-staging' and m.get('scriptHash') == fingerprint(plan['scriptId'])
            and m.get('sheetHash') == plan.get('sheetHash') and m.get('sheetHash') not in (None, PRODUCTION_SHEET_HASH, fingerprint(OLD_SHEET))
            and m.get('sourceDigest') == source_digest() and m.get('revision') == plan['revision'] and m.get('storeEngine') == 'account-store-v2'
            and m.get('storeVersion') == 2 and m.get('nhTestCredentialsDeclared') is True):
        raise Stop('FRESH_BINDING_FAILED')
    web.binding = m['sheetHash']
    return web


def diagnose_overseas_quote(web, username, password):
    """Read existing snapshot and retry exactly one quote. Never capture, restore or edit."""
    import math
    import re
    report = {'mode': 'READ_ONLY_OVERSEAS_QUOTE_DIAGNOSTIC', 'status': 'NOT_RUN',
              'storageWrites': False, 'orderCalls': 0, 'nhQuoteRequested': False,
              'rawFinancialDataIncluded': False}
    allowed = {'login', 'logout', 'nhSnapshotRead', 'nhStockQuotes'}
    def call(action, **fields):
        if action not in allowed:
            raise Stop('READ_ONLY_DIAGNOSTIC_REQUIRED')
        return web.call(action, **fields)
    try:
        login = call('login', **{'user': username, 'pass': password})
        web.token = login.get('token')
        if not web.token or not login.get('isAdmin') or login.get('mustChangePassword'):
            raise Stop('DEDICATED_FRESH_ADMIN_REQUIRED')
        before = call('nhSnapshotRead')
        accounts = before.get('accounts', [])
        report['activeSnapshotPresent'] = bool(accounts)
        report['emptyBaselineRecoverable'] = any(x.get('holdings') == [] for x in before.get('history', []))
        rows = [h for a in accounts for h in (a.get('overseas') or {}).get('holdings', [])]
        selected = next((h for h in rows if isinstance(h.get('code'), str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,14}', h['code'])), None)
        if selected is None:
            report['code'] = 'NO_ELIGIBLE_OVERSEAS_SYMBOL'
        else:
            report['nhQuoteRequested'] = True
            result = call('nhStockQuotes', items=[{'market': 'OVERSEAS', 'code': selected['code'], 'currency': selected.get('currency')}])
            key = 'OVERSEAS:' + selected['code']
            price = result.get('prices', {}).get(key, {})
            diagnostic = result.get('diagnostics', {}).get(key, {})
            positive = type(price.get('price')) in (int, float) and math.isfinite(price['price']) and price['price'] > 0
            balance_currency = isinstance(selected.get('currency'), str) and bool(re.fullmatch(r'[A-Z]{3}', selected['currency']))
            quote_currency = isinstance(price.get('currency'), str) and bool(re.fullmatch(r'[A-Z]{3}', price['currency']))
            match = balance_currency and quote_currency and selected['currency'] == price['currency']
            verified = price.get('identity', {}).get('verified') is True
            report.update(quoteReturned=bool(price), positivePriceConfirmed=positive,
                          balanceCurrencyConfirmed=balance_currency, quoteCurrencyConfirmed=quote_currency,
                          currencyMatches=match, referenceIdentityVerified=verified)
            code = diagnostic.get('code')
            if code in SAFE_REPORT_CODES:
                report['quoteDiagnosticCode'] = code
            http = diagnostic.get('http')
            if type(http) is int and 100 <= http <= 599:
                report['quoteHttp'] = http
            report['status'] = 'PASS' if positive and match and verified else 'FAIL'
            if report['status'] == 'FAIL':
                report['code'] = 'PRICE_NOT_CONFIRMED' if not positive else 'BALANCE_CURRENCY_NOT_CONFIRMED' if not balance_currency else 'QUOTE_CURRENCY_NOT_CONFIRMED' if not quote_currency else 'QUOTE_CURRENCY_MISMATCH' if not match else 'QUOTE_IDENTITY_NOT_VERIFIED'
        after = call('nhSnapshotRead')
        unchanged = after.get('revision') == before.get('revision') and after.get('accounts') == accounts
        report['storedSnapshotUnchanged'] = unchanged
        if not unchanged:
            report.update(status='FAIL', code='CONCURRENT_SNAPSHOT_CHANGE')
    except Exception as e:
        code = e.code if isinstance(e, ApiFailure) and e.code in SAFE_REPORT_CODES else 'READ_ONLY_DIAGNOSTIC_FAILED'
        report.update(status='FAIL', code=code)
    finally:
        if web.token:
            try:
                call('logout')
            except Exception:
                report.update(status='FAIL', code='LOGOUT_FAILED')
    return report


def browser_readback(web):
    # All browser network traffic is intercepted. Only local app assets and the
    # approved server-side nhSnapshotRead adapter can supply data. No browser login,
    # production request, screenshots, trace or financial output is produced.
    from playwright.sync_api import sync_playwright
    import os
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)
        def log_message(self, *a):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            options = {'headless': True}
            if os.environ.get('CHROMIUM_EXECUTABLE'):
                options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
            browser = p.chromium.launch(**options)
            for width in (1440, 344):
                page = browser.new_page(viewport={'width': width, 'height': 882}, is_mobile=width < 1000)
                failures = []
                page.on('pageerror', lambda _e: failures.append(True))
                snapshot = web.call('nhSnapshotRead')['accounts']
                def route(r):
                    if r.request.url.startswith('http://127.0.0.1:' + str(server.server_port) + '/'):
                        if '/js/init.js' in r.request.url:
                            r.fulfill(content_type='application/javascript', body=(ROOT / 'js/init.js').read_text().replace('async function initDashboard(', 'async function isolatedInitDashboard('))
                        else:
                            r.continue_()
                    elif 'script.google.com/macros/' in r.request.url:
                        body = json.loads(r.request.post_data or '{}')
                        if body.get('action') != 'nhAccounts':
                            r.fulfill(content_type='application/json', body='{"success":false}')
                        else:
                            r.fulfill(content_type='application/json', body=json.dumps({'success': True, 'gatewayVersion': 2, 'accounts': snapshot, 'updatedAt': 'private verification'}), headers={'Access-Control-Allow-Origin': '*'})
                    else:
                        r.fulfill(status=200, content_type='application/javascript' if r.request.resource_type=='script' else 'text/plain', body='')
                page.route('**/*', route)
                page.goto('http://127.0.0.1:' + str(server.server_port), wait_until='networkidle')
                page.evaluate("()=>{LS('invest_session_token','synthetic-local-display');$('authGuard').style.display='none';$('appContainer').style.display='block'}")
                page.evaluate('loadNHAccounts()')
                correct = page.evaluate("""expected=>{
                  const holdings=expected.flatMap(a=>['domestic','overseas'].flatMap(k=>a[k]?a[k].holdings:[]));
                  const displayed=[...document.querySelectorAll('#nhAccountRows tr')];
                  if(!holdings.length)return displayed.length===1;
                  return displayed.length===holdings.length&&holdings.every((h,i)=>{
                    const cells=displayed[i].querySelectorAll('td');
                    return cells[2].textContent===h.name&&cells[3].textContent===h.code&&cells[4].textContent===nhMoney(h.quantity)
                      &&cells[5].textContent===nhMoney(h.avgPrice)+' '+(h.currency||'')&&cells[6].textContent===nhMoney(h.currentPrice)+' '+(h.currency||'');
                  });
                }""", snapshot)
                if not correct or failures:
                    raise Stop('PRIVATE_UI_READBACK_FAILED')
                page.close()
            browser.close()
    finally:
        server.shutdown();server.server_close()


def verify_existing_snapshot_ui(web, username, password):
    """Display existing private readback only. No capture, NH request or restore."""
    report = {'mode': 'READ_ONLY_EXISTING_SNAPSHOT_UI', 'status': 'NOT_RUN',
              'storageWrites': False, 'nhRequested': False, 'orderCalls': 0,
              'rawFinancialDataIncluded': False, 'scope': 'LIVE_SNAPSHOT_UI_ADAPTER',
              'desktop': 'NOT_RUN', 'mobile': 'NOT_RUN'}
    before = None
    class ReadOnlySnapshot:
        def call(self, action, **fields):
            if action != 'nhSnapshotRead' or fields:
                raise Stop('READ_ONLY_SNAPSHOT_REQUIRED')
            return web.call(action)
    reader = ReadOnlySnapshot()
    try:
        login = web.call('login', **{'user': username, 'pass': password})
        web.token = login.get('token')
        if not web.token or not login.get('isAdmin') or login.get('mustChangePassword'):
            raise Stop('DEDICATED_FRESH_ADMIN_REQUIRED')
        before = reader.call('nhSnapshotRead')
        if not before.get('accounts') or not before.get('revision'):
            raise Stop('EXISTING_SNAPSHOT_REQUIRED')
        report['activeSnapshotPresent'] = True
        report['emptyBaselineRecoverable'] = any(h.get('holdings') == [] for h in before.get('history', []))
        browser_readback(reader)
        report.update(status='PASS', desktop='PASS', mobile='PASS')
    except Exception as e:
        safe = {'DEDICATED_FRESH_ADMIN_REQUIRED', 'EXISTING_SNAPSHOT_REQUIRED', 'PRIVATE_UI_READBACK_FAILED'}
        code = e.code if isinstance(e, ApiFailure) and e.code in SAFE_REPORT_CODES else str(e) if isinstance(e, Stop) and str(e) in safe else 'PRIVATE_UI_VERIFICATION_FAILED'
        report.update(status='FAIL', code=code)
    finally:
        if before is not None:
            try:
                after = reader.call('nhSnapshotRead')
                unchanged = all(after.get(k) == before.get(k) for k in ('revision', 'accounts', 'history'))
                report['storedSnapshotUnchanged'] = unchanged
                if not unchanged:
                    report.update(status='FAIL', code='CONCURRENT_SNAPSHOT_CHANGE')
            except Exception:
                report.update(status='FAIL', code='SNAPSHOT_UNCHANGED_NOT_CONFIRMED')
        if web.token:
            try:
                web.call('logout')
            except Exception:
                report.update(status='FAIL', code='LOGOUT_FAILED')
    return report


def checks(web, username, password, display=False, repeat_environment=None):
    report = {'status': 'NOT_RUN', 'checks': [], 'specialAccounts': {'ISA': 'NOT_RUN', 'PENSION': 'NOT_RUN', 'IRP': 'NOT_RUN'},
              'orderCalls': 0, 'existingResourcesChanged': False, 'privateHistoryRetained': False, 'rawFinancialDataIncluded': False}
    def record(name, status, scope):
        report['checks'].append({'name': name, 'status': status, 'scope': scope})
    captured = None
    capture_attempted = False
    try:
        login = web.call('login', **{'user': username, 'pass': password})
        web.token = login.get('token')
        if not web.token or not login.get('isAdmin') or login.get('mustChangePassword'):
            raise Stop('DEDICATED_FRESH_ADMIN_REQUIRED')
        record('dashboard_authentication', 'PASS', 'LIVE_GAS')
        baseline = web.call('nhSnapshotRead')
        if baseline.get('accounts'):
            raise Stop('NEW_EMPTY_SNAPSHOT_REQUIRED')
        if repeat_environment is None and baseline.get('history'):
            raise Stop('NEW_EMPTY_SNAPSHOT_REQUIRED')
        if repeat_environment is not None:
            # Preserve the last-five history view through capture and restore.
            history = baseline.get('history')
            if not isinstance(history, list) or len(history) > 3:
                raise Stop('HISTORY_PRESERVATION_LIMIT')
            if history:
                latest = history[0]
                if latest.get('reason') != 'restore' or baseline.get('revision') != 'v2:' + str(latest.get('snapshotId')):
                    raise Stop('VERIFIED_EMPTY_BASELINE_REQUIRED')
            from nh_v2_restore import backup_snapshot
            backup_snapshot(repeat_environment, baseline)
            record('private_baseline_backup', 'PASS', 'OWNER_PRIVATE_BACKUP')
            again = web.call('nhSnapshotRead')
            if any(again.get(k) != baseline.get(k) for k in ('revision', 'accounts', 'history')):
                raise Stop('CONCURRENT_SNAPSHOT_CHANGE')
        # Capture performs the actual read-only NH query, then persists canonical
        # native accounts. It rejects partial responses without modifying a snapshot.
        capture_attempted = True
        report['privateHistoryRetained'] = 'NOT_CONFIRMED'
        captured = web.call('nhSnapshotCapture', expectedRevision=baseline['revision'], confirmReplace=True)
        record('nh_authentication_and_domestic_overseas_inquiry', 'PASS', 'LIVE_NH')
        current = web.call('nhSnapshotRead')
        if current.get('accounts') != captured.get('accounts') or current.get('revision') != captured.get('revision'):
            raise Stop('NATIVE_SNAPSHOT_MISMATCH')
        record('native_store_readback_integrity', 'PASS', 'LIVE_GAS')
        import re
        if not current['accounts'] or not all(
            re.fullmatch(r'[a-f0-9]{64}', a.get('accountKey', '')) and a.get('acctType') in ('01', '02')
            and not a.get('errors') and all(
                isinstance(a.get(market), dict) and not a[market].get('partial')
                and all(isinstance(h.get('code'), str) and bool(h['code'])
                        and isinstance(h.get('currency'), str) and bool(re.fullmatch(r'[A-Z]{3}', h['currency']))
                        and (market != 'domestic' or h['currency'] == 'KRW')
                        for h in a[market].get('holdings', []))
                for market in ('domestic', 'overseas')) for a in current['accounts']):
            raise Stop('NATIVE_IDENTITY_OR_CURRENCY_UNCONFIRMED')
        record('native_identity_and_currency', 'PASS', 'LIVE_GAS')
        report['privateHistoryRetained'] = True
        for market, kind in [('domestic', 'DOMESTIC'), ('overseas', 'OVERSEAS')]:
            rows = [h for a in current['accounts'] for h in a[market]['holdings']]
            import re
            pattern = r'[A-Z0-9]{6}' if market == 'domestic' else r'[A-Za-z0-9][A-Za-z0-9._-]{0,14}'
            selected = next((h for h in rows if re.fullmatch(pattern, h['code'])), None)
            if selected is None:
                record(market + '_quote', 'NOT_RUN', 'LIVE_NH');continue
            quote = web.call('nhStockQuotes', items=[{'market': kind, 'code': selected['code'], 'currency': selected.get('currency')}])
            price = quote.get('prices', {}).get(kind + ':' + selected['code'], {})
            if not isinstance(price.get('price'), (float, int)) or isinstance(price.get('price'), bool) or price['price'] <= 0 or price.get('currency') != selected.get('currency') or kind=='OVERSEAS' and price.get('identity',{}).get('verified') is not True:
                raise Stop('LIVE_QUOTE_NOT_CONFIRMED')
            record(market + '_quote', 'PASS', 'LIVE_NH')
        if display:
            browser_readback(web)
            record('desktop_mobile_display_from_gas_readback', 'PASS', 'LIVE_SNAPSHOT_UI_ADAPTER')
        else:
            record('desktop_mobile_display_from_gas_readback', 'NOT_RUN', 'LIVE_SNAPSHOT_UI_ADAPTER')
        # Restore only the before-state of this run. No deletion of journal/history.
        result = web.call('nhSnapshotRestore', snapshotId=captured['snapshotId'], expectedRevision=current['revision'], confirmReplace=True)
        restored = web.call('nhSnapshotRead')
        if restored['accounts'] or restored['revision'] != result['revision']:
            raise Stop('PRIVATE_SNAPSHOT_RESTORE_FAILED')
        if repeat_environment is not None:
            if not all(item in restored.get('history', []) for item in baseline.get('history', [])):
                raise Stop('ORIGINAL_HISTORY_NOT_RETAINED')
            if not any(h.get('holdings') == current['accounts'] and h.get('reason') == 'restore' for h in restored.get('history', [])):
                raise Stop('CAPTURED_SNAPSHOT_NOT_RETAINED')
            record('original_and_new_snapshot_history_retained', 'PASS', 'LIVE_GAS')
        record('restore_active_baseline', 'PASS', 'LIVE_GAS')
        report['status'] = 'PASS' if all(c['status'] == 'PASS' for c in report['checks']) else 'NOT_RUN'
    except Exception as e:
        safe = {'HISTORY_PRESERVATION_LIMIT','VERIFIED_EMPTY_BASELINE_REQUIRED','CONCURRENT_SNAPSHOT_CHANGE','NATIVE_IDENTITY_OR_CURRENCY_UNCONFIRMED','ORIGINAL_HISTORY_NOT_RETAINED','CAPTURED_SNAPSHOT_NOT_RETAINED','DEDICATED_FRESH_ADMIN_REQUIRED','NEW_EMPTY_SNAPSHOT_REQUIRED','NATIVE_SNAPSHOT_MISMATCH','LIVE_QUOTE_NOT_CONFIRMED','PRIVATE_UI_READBACK_FAILED','PRIVATE_SNAPSHOT_RESTORE_FAILED'}
        code = e.code if isinstance(e, ApiFailure) and e.code in SAFE_REPORT_CODES else str(e) if isinstance(e, Stop) and str(e) in safe else 'PRIVATE_LIVE_CHECK_FAILED'
        report.update(status='FAIL', code=code, ownerRecoveryRequired=capture_attempted)
    finally:
        if web.token:
            try:
                web.call('logout')
            except Exception:
                report.update(status='FAIL', code='LOGOUT_FAILED')
    return report


def representative_quotes(web, username, password):
    """Three public, non-portfolio samples; no storage or unknown API routes."""
    import math
    groups = [('NASDAQ_STOCK', 'AAPL'), ('NYSE_STOCK', 'KO'), ('ETF', 'SPY')]
    report = {'status': 'NOT_RUN', 'scope': 'LIVE_NH_PUBLIC_REPRESENTATIVES', 'groups': [],
              'storageWrites': False, 'orderCalls': 0, 'marketSession': 'NOT_RUN', 'quoteDelay': 'NOT_RUN',
              'rawFinancialDataIncluded': False}
    try:
        login = web.call('login', **{'user': username, 'pass': password});web.token = login.get('token')
        if not web.token or not login.get('isAdmin') or login.get('mustChangePassword'):
            raise Stop('DEDICATED_FRESH_ADMIN_REQUIRED')
        before = web.call('nhSnapshotRead')
        data = web.call('nhStockQuotes', items=[{'market': 'OVERSEAS', 'code': code, 'currency': 'USD'} for _, code in groups])
        for label, code in groups:
            key = 'OVERSEAS:' + code;p = data.get('prices', {}).get(key, {})
            valid = type(p.get('price')) in (int, float) and math.isfinite(p['price']) and p['price'] > 0 and p.get('currency') == 'USD' and p.get('identity', {}).get('verified') is True
            row = {'group': label, 'status': 'PASS' if valid else 'FAIL'}
            error = data.get('diagnostics', {}).get(key, {}).get('code')
            if error in SAFE_REPORT_CODES:row['code'] = error
            report['groups'].append(row)
        after = web.call('nhSnapshotRead')
        report['storedSnapshotUnchanged'] = all(before.get(k) == after.get(k) for k in ('accounts', 'revision', 'history'))
        report['status'] = 'PASS' if all(g['status'] == 'PASS' for g in report['groups']) and report['storedSnapshotUnchanged'] else 'FAIL'
    except Exception:
        report.update(status='FAIL', code='REPRESENTATIVE_QUOTES_NOT_CONFIRMED')
    finally:
        if web.token:
            try:web.call('logout')
            except Exception:report.update(status='FAIL', code='LOGOUT_FAILED')
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--environment', type=Path, required=True)
    p.add_argument('--approve-nh-read-and-private-snapshot', action='store_true')
    p.add_argument('--browser', action='store_true')
    p.add_argument('--repeat-empty-baseline', action='store_true', help='Back up and reuse a verified empty fresh baseline without deleting prior history')
    p.add_argument('--real-browser', action='store_true', help='After full-flow PASS, test native browser login/GAS and natural five-minute inactivity logout')
    p.add_argument('--representative-quotes', action='store_true', help='After full-flow/browser PASS, check three public representative overseas instruments')
    modes = p.add_mutually_exclusive_group()
    modes.add_argument('--native-browser-only', action='store_true', help='Run native browser login/session only; skip capture/storage/restore, optionally then public representative quotes')
    modes.add_argument('--diagnose-browser-cors', action='store_true', help='Anonymous browser header/redirect evidence only; no credentials, NH or storage writes')
    modes.add_argument('--verify-existing-snapshot-ui', action='store_true', help='Display existing saved snapshot on desktop/mobile; no NH, capture or restore')
    modes.add_argument('--diagnose-overseas-quote', action='store_true', help='Read existing snapshot and request one overseas quote; no capture, restore or storage writes')
    a = p.parse_args()
    try:
        if (a.repeat_empty_baseline or a.real_browser or a.representative_quotes) and (a.diagnose_overseas_quote or a.verify_existing_snapshot_ui or a.diagnose_browser_cors):
            raise Stop('INCOMPATIBLE_CHECK_MODES')
        if a.native_browser_only and (a.repeat_empty_baseline or a.real_browser or a.browser):
            raise Stop('INCOMPATIBLE_CHECK_MODES')
        web = preflight(a.environment, allow_same_source_tools=a.diagnose_overseas_quote or a.verify_existing_snapshot_ui or a.repeat_empty_baseline or a.diagnose_browser_cors or a.native_browser_only)
        if a.diagnose_browser_cors:
            from nh_v2_browser_check import diagnose_browser_cors
            result = diagnose_browser_cors(web.url, web.binding)
            print(json.dumps(result));return 0 if result['status']=='PASS' else 2
        if not a.approve_nh_read_and_private_snapshot and not a.diagnose_overseas_quote and not a.verify_existing_snapshot_ui and not a.native_browser_only:
            print(json.dumps({'status': 'NOT_RUN', 'code': 'OWNER_NH_APPROVAL_REQUIRED', 'nhRequested': False}));return 2
        if not sys.stdin.isatty():
            raise Stop('OWNER_PRIVATE_TERMINAL_REQUIRED')
        username = input('Fresh staging user (visible): ').strip()
        password = getpass.getpass('Fresh staging password (hidden): ')
        if not username or len(password) < 16:
            raise Stop('STRONG_PRIVATE_CREDENTIALS_REQUIRED')
        if a.native_browser_only:
            from nh_v2_browser_check import native_browser_check
            print(json.dumps({'progress':'NATIVE_BROWSER_ONLY_NO_CAPTURE_OR_RESTORE'}),flush=True)
            result = native_browser_check(web.url, username, password, web.binding)
            result['mode'] = 'NATIVE_BROWSER_ONLY'
            if result['status'] == 'PASS' and a.representative_quotes:
                print(json.dumps({'progress':'READ_ONLY_PUBLIC_REPRESENTATIVE_QUOTES'}),flush=True)
                result['representativeQuotes'] = representative_quotes(web, username, password)
        elif a.verify_existing_snapshot_ui:
            result = verify_existing_snapshot_ui(web, username, password)
        elif a.diagnose_overseas_quote:
            result = diagnose_overseas_quote(web, username, password)
        else:
            print(json.dumps({'progress':'LATEST_BUILD_FULL_FLOW'}),flush=True)
            result = checks(web, username, password, a.browser, a.environment if a.repeat_empty_baseline else None)
            if result['status'] == 'PASS' and a.real_browser:
                print(json.dumps({'progress':'NATIVE_BROWSER_LOGIN_AND_REAL_FIVE_MINUTE_INACTIVITY'}),flush=True)
                from nh_v2_browser_check import native_browser_check
                result['nativeBrowser'] = native_browser_check(web.url, username, password, web.binding)
                if result['nativeBrowser']['status'] != 'PASS':
                    result.update(status='FAIL', code='NATIVE_BROWSER_CHECK_FAILED')
            if result['status'] == 'PASS' and a.representative_quotes:
                print(json.dumps({'progress':'READ_ONLY_PUBLIC_REPRESENTATIVE_QUOTES'}),flush=True)
                result['representativeQuotes'] = representative_quotes(web, username, password)
    except Exception:
        result = {'status': 'NOT_RUN', 'code': 'FRESH_PREFLIGHT_OR_OWNER_AUTH_REQUIRED', 'orderCalls': 0, 'rawFinancialDataIncluded': False}
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
