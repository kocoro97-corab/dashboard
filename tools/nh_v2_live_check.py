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

from build_nh_staging import ROOT, source_digest, PRODUCTION_SHEET_HASH
from nh_staging_test import WebApp, fingerprint, ApiFailure, SAFE_REPORT_CODES
from nh_v2_fresh import private_path, target, invoke, pull, logical, revision, OLD_SHEET, OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID


class Stop(Exception):
    pass


def preflight(directory, client=invoke, web=None):
    directory = private_path(directory, False)
    plan = json.loads((directory / 'fresh-plan.json').read_text())
    target(plan['scriptId'])
    if plan.get('phase') != 'NH_AUTH_APPROVAL_REQUIRED' or plan.get('revision') != revision() or plan.get('sourceDigest') != source_digest():
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
        if pull(client, Path(t) / 'head', plan['scriptId']) != logical(bundle) or pull(client, Path(t) / 'immutable', plan['scriptId'], plan['activeVersion']) != logical(bundle):
            raise Stop('SOURCE_IDENTITY_FAILED')
    m = web.call('appVersion')
    if not (m.get('freshTestEnvironment') is True and m.get('testEnvironment') == 'nh-staging' and m.get('scriptHash') == fingerprint(plan['scriptId'])
            and m.get('sheetHash') == plan.get('sheetHash') and m.get('sheetHash') not in (None, PRODUCTION_SHEET_HASH, fingerprint(OLD_SHEET))
            and m.get('sourceDigest') == source_digest() and m.get('revision') == plan['revision'] and m.get('storeEngine') == 'account-store-v2'
            and m.get('storeVersion') == 2 and m.get('nhTestCredentialsDeclared') is True):
        raise Stop('FRESH_BINDING_FAILED')
    web.binding = m['sheetHash']
    return web


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


def checks(web, username, password, display=False):
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
        if baseline.get('accounts') or baseline.get('history'):
            raise Stop('NEW_EMPTY_SNAPSHOT_REQUIRED')
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
        report['privateHistoryRetained'] = True
        for market, kind in [('domestic', 'DOMESTIC'), ('overseas', 'OVERSEAS')]:
            rows = [h for a in current['accounts'] for h in a[market]['holdings']]
            import re
            pattern = r'[A-Z0-9]{6}' if market == 'domestic' else r'[A-Z0-9][A-Z0-9.-]{0,14}'
            selected = next((h for h in rows if re.fullmatch(pattern, h['code'])), None)
            if selected is None:
                record(market + '_quote', 'NOT_RUN', 'LIVE_NH');continue
            quote = web.call('nhStockQuotes', items=[{'market': kind, 'code': selected['code']}])
            price = quote.get('prices', {}).get(kind + ':' + selected['code'], {})
            if not isinstance(price.get('price'), (float, int)) or isinstance(price.get('price'), bool) or price['price'] <= 0 or price.get('currency') != selected.get('currency'):
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
        record('restore_active_baseline', 'PASS', 'LIVE_GAS')
        report['status'] = 'PASS' if all(c['status'] == 'PASS' for c in report['checks']) else 'NOT_RUN'
    except Exception as e:
        safe = {'DEDICATED_FRESH_ADMIN_REQUIRED','NEW_EMPTY_SNAPSHOT_REQUIRED','NATIVE_SNAPSHOT_MISMATCH','LIVE_QUOTE_NOT_CONFIRMED','PRIVATE_UI_READBACK_FAILED','PRIVATE_SNAPSHOT_RESTORE_FAILED'}
        code = e.code if isinstance(e, ApiFailure) and e.code in SAFE_REPORT_CODES else str(e) if isinstance(e, Stop) and str(e) in safe else 'PRIVATE_LIVE_CHECK_FAILED'
        report.update(status='FAIL', code=code, ownerRecoveryRequired=capture_attempted)
    finally:
        if web.token:
            try:
                web.call('logout')
            except Exception:
                report.update(status='FAIL', code='LOGOUT_FAILED')
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--environment', type=Path, required=True)
    p.add_argument('--approve-nh-read-and-private-snapshot', action='store_true')
    p.add_argument('--browser', action='store_true')
    a = p.parse_args()
    try:
        web = preflight(a.environment)
        if not a.approve_nh_read_and_private_snapshot:
            print(json.dumps({'status': 'NOT_RUN', 'code': 'OWNER_NH_APPROVAL_REQUIRED', 'nhRequested': False}));return 2
        if not sys.stdin.isatty():
            raise Stop('OWNER_PRIVATE_TERMINAL_REQUIRED')
        username = getpass.getpass('Fresh staging user (hidden): ')
        password = getpass.getpass('Fresh staging password (hidden): ')
        if not username or len(password) < 16:
            raise Stop('STRONG_PRIVATE_CREDENTIALS_REQUIRED')
        result = checks(web, username, password, a.browser)
    except Exception:
        result = {'status': 'NOT_RUN', 'code': 'FRESH_PREFLIGHT_OR_OWNER_AUTH_REQUIRED', 'orderCalls': 0, 'rawFinancialDataIncluded': False}
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
