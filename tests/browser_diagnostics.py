"""Synthetic privacy browser regression. No Google/NH requests or private inputs."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CANARY = 'SYNTHETIC_SECRET_CANARY SYNTHETIC_ACCOUNT_8642 SYNTHETIC_TOKEN_CANARY'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass


def private_free(text):
    assert not any(x in text for x in CANARY.split()), 'SYNTHETIC_CANARY_ESCAPED'
    assert '8642' not in text, 'SYNTHETIC_SUFFIX_ESCAPED'


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        launch = {'headless': True}
        if os.environ.get('CHROMIUM_EXECUTABLE'):
            launch['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
        browser = p.chromium.launch(**launch)
        for width in (344, 1440):
            page = browser.new_page(viewport={'width': width, 'height': 882})
            console, errors = [], []
            page.on('console', lambda message: console.append(message.text))
            page.on('pageerror', lambda error: errors.append(str(error)))
            state = {'mode': 'partial'}

            def route_request(route):
                if route.request.url.startswith('http://127.0.0.1:'):
                    if '/js/init.js' in route.request.url:
                        route.fulfill(content_type='application/javascript', body=(ROOT / 'js/init.js').read_text().replace('async function initDashboard(', 'async function disabledInitDashboard('))
                    else:
                        route.continue_()
                    return
                if 'script.google.com/macros/' not in route.request.url:
                    route.fulfill(content_type='application/javascript', body='')
                    return
                body = json.loads(route.request.post_data or '{}')
                if body.get('action') == 'login':
                    route.fulfill(content_type='text/html', body='<html>'+CANARY+'</html>')
                    return
                result = {'success': False, 'message': CANARY, 'code': CANARY}
                if body.get('action') == 'nhAccounts' and state['mode'] == 'partial':
                    result = {'success': True, 'accounts': [{'acctType': '01', 'errors': [CANARY], 'domestic': {'summary': {'evalAmount': 20, 'profit': 0}, 'holdings': [{'code': '000001', 'name': 'Synthetic', 'quantity': 2, 'avgPrice': 10, 'currentPrice': 10, 'evalAmount': 20, 'profit': 0, 'currency': 'KRW'}]}, 'overseas': None}]}
                route.fulfill(content_type='application/json', body=json.dumps(result))

            page.route('**/*', route_request)
            page.goto('http://127.0.0.1:'+str(server.server_port), wait_until='load')
            page.fill('#authId', 'synthetic-user')
            page.fill('#authPw', 'synthetic-password')
            page.click('#authSubmitBtn')
            page.wait_for_function("$('authMsg').textContent.includes('GAS_NON_JSON')")
            private_free(page.locator('#authMsg').inner_text())
            page.evaluate("()=>{LS('invest_session_token','synthetic-session');$('authGuard').style.display='none';$('appContainer').style.display='block'}")
            page.evaluate('loadNHAccounts()')
            assert page.locator('#nhAccountRows tr').count() == 1
            assert page.locator('#nhAccountRows tr td').nth(4).inner_text() == '2'
            private_free(page.locator('#nhAccountCards').inner_text())
            state['mode'] = 'failure'
            page.evaluate('loadNHAccounts()')
            assert page.locator('#nhAccountRows tr td').nth(4).inner_text() == '2'
            private_free(page.locator('#nhAccountStatus').inner_text())
            page.evaluate('loadExternalAssets()')
            private_free(page.locator('#externalStatus').inner_text())
            page.evaluate('(raw)=>{window.dispatchEvent(new ErrorEvent("error",{message:raw,cancelable:true}));Promise.reject(new Error(raw))}', CANARY)
            page.wait_for_timeout(150)
            private_free(page.locator('#errBar').inner_text())
            private_free('\n'.join(console+errors))
            page.close()
            print('PASS: synthetic privacy browser '+str(width)+'px, login non-JSON, account partial/failure preservation, external failure, global diagnostics')
        browser.close()
finally:
    server.shutdown()
