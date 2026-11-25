"""Real browser POST/cookie/navigation with offline synthetic OAuth pages.
HTTP 303 responses are verified separately by calendar-session-authority.test.cjs."""
import asyncio
import json
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_dev_pages import build
from playwright.async_api import async_playwright
BASE = 'https://kocoro97-corab.github.io/dashboard-v2-dev/'
HOST = 'https://myinvest-v2-dev-relay.kocoro97.workers.dev'


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        artifact = Path(tmp) / 'public'
        build(artifact)
        policy = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]+>', (artifact / 'index.html').read_text()).group()
        html = '<!doctype html><head>' + policy + '</head><body><button id="connect">Connect synthetic calendar</button><script>window.MYINVEST_TRANSPORT_CONFIG={mode:"relay",googleCalendarReadOnly:false};window.LS=()=>"SYNTHETIC_MYINVEST_SESSION";</script><script src="js/calendar-google-auth.js"></script><script src="js/calendar-google-transport.js"></script><script>document.getElementById("connect").onclick=()=>{const tab=open("about:blank","_blank");MYInvestGoogleCalendarAuth.openAuthorization(tab).catch(()=>{window.syntheticFailure=true})};</script></body>'
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            for width in [1440, 690, 344]:
                context = await browser.new_context(viewport={'width': width, 'height': 900}, has_touch=True)
                await context.set_offline(True)
                requests, errors = [], []
                async def route(r):
                    u = urlsplit(r.request.url)
                    if u.hostname == 'kocoro97-corab.github.io':
                        if u.path.endswith('/oauth-test.html'):
                            await r.fulfill(content_type='text/html', body=html)
                        elif u.path.endswith('/oauth-done.html'):
                            await r.fulfill(content_type='text/html', body='<p>Synthetic connection complete</p>')
                        elif u.path.startswith('/dashboard-v2-dev/js/'):
                            await r.fulfill(content_type='application/javascript', body=(artifact / 'js' / Path(u.path).name).read_text())
                        else:
                            await r.abort()
                        return
                    requests.append(r.request)
                    if r.request.url == HOST + '/oauth/google/start':
                        assert r.request.method == 'POST'
                        assert parse_qs(r.request.post_data) == {'token': ['SYNTHETIC_MYINVEST_SESSION']}
                        assert r.request.headers.get('origin') == 'https://kocoro97-corab.github.io'
                        await r.fulfill(content_type='text/html', body='<script>location.replace("https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state")</script>', headers={'Set-Cookie': '__Host-myInvestCalendarCallback=SYNTHETIC_ENCRYPTED_COOKIE; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600', 'Referrer-Policy': 'no-referrer'})
                    elif u.hostname == 'accounts.google.com':
                        assert r.request.method == 'GET'
                        assert 'SYNTHETIC_MYINVEST_SESSION' not in r.request.url
                        assert 'SYNTHETIC_ENCRYPTED_COOKIE' not in r.request.headers.get('cookie', '')
                        await r.fulfill(content_type='text/html', body='<script>location.replace("'+HOST+'/oauth/google/callback?state=synthetic-state&code=synthetic-code")</script>')
                    elif u.hostname == 'myinvest-v2-dev-relay.kocoro97.workers.dev' and u.path == '/oauth/google/callback':
                        assert '__Host-myInvestCalendarCallback=SYNTHETIC_ENCRYPTED_COOKIE' in r.request.headers.get('cookie', '')
                        await r.fulfill(content_type='text/html', body='<script>location.replace("'+BASE+'oauth-done.html")</script>', headers={'Set-Cookie': '__Host-myInvestCalendarCallback=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0', 'Referrer-Policy': 'no-referrer'})
                    else:
                        raise AssertionError('Unexpected synthetic endpoint: '+str((u.hostname,u.path,r.request.method)))
                await context.route('**/*', route)
                page = await context.new_page()
                page.on('pageerror', lambda e: errors.append(type(e).__name__))
                await page.goto(BASE + 'oauth-test.html')
                assert await page.evaluate('MYInvestGoogleCalendarTransport.initialize()') is False
                assert not requests
                await page.evaluate('MYINVEST_TRANSPORT_CONFIG.googleCalendarReadOnly=true;MYInvestGoogleCalendarTransport.initialize()')
                async with context.expect_page() as popup:
                    await page.locator('#connect').click()
                tab = await popup.value
                await tab.wait_for_url(BASE + 'oauth-done.html', timeout=12000)
                assert not errors and not await page.evaluate('window.syntheticFailure===true')
                assert len(requests) == 3
                assert not any(c['name'] == '__Host-myInvestCalendarCallback' for c in await context.cookies())
                print(json.dumps({'status': 'PASS', 'width': width, 'mode': 'SYNTHETIC_OAUTH_BOOTSTRAP', 'topLevelPost': True, 'callbackCookieRoundTrip': True, 'cookieCleared': True, 'sessionTokenInUrl': False, 'actualGoogleCalls': 0, 'actualNhCalls': 0}), flush=True)
                await context.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
