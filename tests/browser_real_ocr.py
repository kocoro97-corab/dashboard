"""Opt-in REAL browser OCR. Private inputs stay outside Git; GAS storage is mocked.

Use --images <private image> <private image> --expected <private JSON array>.
Expected rows: name, code, quantity, avgPrice. Never emits financial values,
OCR text, screenshots, traces, or network logs. This is NOT live GAS/NH testing.
"""
import argparse
import copy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--images', nargs=2, type=Path, required=True)
    parser.add_argument('--expected', type=Path, required=True)
    args = parser.parse_args()
    if any(p.resolve().is_relative_to(ROOT) for p in args.images + [args.expected]):
        raise RuntimeError('PRIVATE_INPUTS_MUST_STAY_OUTSIDE_REPOSITORY')
    expected = json.loads(args.expected.read_text())
    if len(expected) != 7:
        raise RuntimeError('SEVEN_PRIVATE_EXPECTATIONS_REQUIRED')

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = {'rows': [], 'revision': 1, 'saves': 0}
    checks = []
    try:
        with sync_playwright() as playwright:
            options = {'headless': True}
            if os.environ.get('CHROMIUM_EXECUTABLE'):
                options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
            browser = playwright.chromium.launch(**options)
            page = browser.new_page(viewport={'width': 344, 'height': 882}, is_mobile=True)
            page.on('dialog', lambda dialog: dialog.accept())

            def route_request(route):
                host = urlparse(route.request.url).hostname
                if host == '127.0.0.1':
                    if '/js/init.js' in route.request.url:
                        route.fulfill(content_type='application/javascript', body=(ROOT / 'js/init.js').read_text().replace('async function initDashboard(', 'async function disabledInitDashboard('))
                    else:
                        route.continue_()
                elif host in {'cdn.jsdelivr.net', 'tessdata.projectnaptha.com'}:
                    # Only download OCR scripts/models. No private image POSTs.
                    if route.request.method != 'GET':
                        route.abort()
                    else:
                        route.continue_()
                elif host == 'script.google.com':
                    body = json.loads(route.request.post_data or '{}')
                    action = body.get('action')
                    result = {'success': True}
                    if action == 'externalHoldings':
                        result.update(holdings=state['rows'], revision=str(state['revision']), storeVersion=2)
                    elif action == 'saveExternalHoldings':
                        if body.get('expectedRevision') != str(state['revision']) or body.get('confirmReplace') is not True:
                            raise RuntimeError('MOCK_SAVE_CONFIRMATION_FAILED')
                        state['rows'] = copy.deepcopy(body['holdings'])
                        state['revision'] += 1
                        state['saves'] += 1
                        result.update(revision=str(state['revision']), storeVersion=2)
                    route.fulfill(content_type='application/json', body=json.dumps(result))
                else:
                    route.abort()

            page.route('**/*', route_request)
            page.goto('http://127.0.0.1:' + str(server.server_port), wait_until='load')
            page.evaluate("()=>{LS('invest_session_token','synthetic-real-ocr-session');$('authGuard').style.display='none';$('appContainer').style.display='block'}")
            page.evaluate('loadExternalAssets()')
            page.select_option('#externalAccountType', 'ISA')
            page.locator('#externalImageFiles').set_input_files([str(p) for p in args.images])
            page.click('#externalUploadBtn')
            page.wait_for_function("!$('externalUploadBtn').disabled", timeout=240000)
            rows = page.evaluate('extRows(EXT_ASSETS)')
            normalize = lambda items: sorted((x['name'], x['code'], x['quantity'], x['avgPrice']) for x in items)
            if normalize(rows) != normalize(expected):
                raise RuntimeError('REAL_IMAGE_SEVEN_ROWS_OR_VALUES_MISMATCH')
            checks.append('seven_names_codes_quantities_and_average_prices_match_originals')
            if len({x['code'] for x in rows}) != 7 or any(x['name'] == '현금' for x in rows):
                raise RuntimeError('DUPLICATE_OR_CASH_ROW')
            checks.append('no_cash_noise_or_duplicate_rows')
            # Edit a quantity in the real mobile form; storage below is MOCK ONLY.
            field = page.locator('#externalAssetRows input[type=number]').first
            field.fill('123')
            field.press('Tab')
            if page.evaluate('EXT_ASSETS[0].quantity') != 123:
                raise RuntimeError('MOBILE_EDIT_FAILED')
            page.click('#externalSaveBtn')
            page.wait_for_function("$('externalStatus').textContent.includes('저장 완료')")
            if state['saves'] != 1 or state['rows'][0]['quantity'] != 123:
                raise RuntimeError('MOCK_SAVE_FAILED')
            checks.append('mobile_edit_and_confirmed_mock_save')
            # A failed OCR import must retain the saved/current list.
            before = page.evaluate('extRows(EXT_ASSETS)')
            page.evaluate("()=>{window.__realOcr=ocrImage;ocrImage=async()=>({text:'',words:[]})}")
            page.click('#externalUploadBtn')
            page.wait_for_function("!$('externalUploadBtn').disabled")
            if page.evaluate('extRows(EXT_ASSETS)') != before:
                raise RuntimeError('FAILED_IMPORT_CHANGED_EXISTING_ROWS')
            checks.append('separate_mock_failure_preserves_existing_rows')
            browser.close()
    finally:
        server.shutdown()
    print(json.dumps({'status': 'PASS', 'mode': 'REAL_IMAGE_OCR', 'engine': 'Tesseract.js 5.1.1', 'browser': 'Chromium mobile 344px', 'images': 2, 'holdings': 7, 'checks': checks, 'storage': 'MOCK', 'nhApi': 'NOT_CALLED', 'privateDataLogged': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Exception repr/Playwright traces can contain private DOM and request data.
        print(json.dumps({'status': 'FAIL', 'mode': 'REAL_IMAGE_OCR', 'reason': 'PRIVATE_CHECK_FAILED', 'privateDataLogged': False}))
        raise SystemExit(1)
