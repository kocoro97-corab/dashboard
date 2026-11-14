"""Changed public-market path only: synthetic GAS/data through the real relay.
This is not a live GAS/source/CORS result. No account or storage action is allowed.
"""
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build,PAGE
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from nh_v2_https_browser import market_screen_check
from test_relay import configuration,EXPECTED,request,TOKEN

ORIGIN='https://kocoro97-corab.github.io'
HOST='synthetic-market.trycloudflare.com';ENDPOINT='https://'+HOST+'/api'
CODE='SYNTHETIC_PRIVATE_DEVELOPMENT_CODE'

class Gas:
    def __init__(self):self.live=False;self.calls=[];self.reads=[];self.news_fail=False
    def verify(self):pass
    def post(self,body):
        action=body['action'];self.calls.append(action)
        if action=='appVersion':return dict(EXPECTED,success=True)
        if action=='login':self.live=True;return {'success':True,'token':TOKEN,'isAdmin':False}
        if action=='logout':self.live=False;return {'success':True}
        if action=='sessionInfo':return {'success':self.live and body.get('token')==TOKEN,'isAdmin':False}
        raise AssertionError('NON_PUBLIC_ACTION_ATTEMPTED')
    def public(self,url,token):
        if not self.live or token!=TOKEN:raise RelayFault('AUTH_REQUIRED',401)
        self.reads.append(url);u=urlsplit(url)
        if u.hostname=='news.google.com':
            if self.news_fail:raise RelayFault('RELAY_UPSTREAM_NETWORK')
            return '<rss><channel><item><title>SYNTHETIC NEWS ONLY</title><link>https://news.google.com/articles/synthetic</link><source>Synthetic</source><pubDate>Fri, 13 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>'
        if u.path.endswith('/price'):
            if 'page=2' in u.query.split('&'):return '[]'
            return json.dumps([{'localTradedAt':'2026-11-12','closePrice':'100','openPrice':'98','highPrice':'101','lowPrice':'97'},
                               {'localTradedAt':'2026-11-13','closePrice':'102','openPrice':'100','highPrice':'103','lowPrice':'99'}])
        if u.hostname=='query1.finance.yahoo.com':
            return json.dumps({'chart':{'result':[{'meta':{'regularMarketPrice':102,'chartPreviousClose':100},
                'timestamp':[1794441600,1794528000],'indicators':{'quote':[{'open':[98,100],'high':[101,103],'low':[97,99],'close':[100,102]}]}}]}})
        if u.hostname=='finance.daum.net':return '{"tradePrice":102,"prevClosingPrice":100}'
        codes=['KOSPI','.INX','.IXIC','.DJI','.SOX','.VIX','FX_USDKRW','.DXY','US10YT=RR','CLcv1']
        return json.dumps({'datas':[{'reutersCode':c,'closePrice':'102','compareToPreviousClosePrice':'2','compareToPreviousPrice':{'code':'2'}} for c in codes]})

with tempfile.TemporaryDirectory() as tmp:
    artifact=Path(tmp)/'public';build(artifact)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            for width in (344,1440):
                gas=Gas();relay=RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True),gas)
                boundary=PublicDevelopment(relay,PAGE,CODE);boundary.host=HOST
                context=browser.new_context(viewport={'width':width,'height':882},timezone_id='Asia/Seoul',service_workers='block')
                errors=[];unexpected=[]
                def route(r):
                    u=urlsplit(r.request.url)
                    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
                        path=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
                        if path.is_file() and artifact in path.resolve().parents:
                            mime='application/javascript' if path.suffix=='.js' else 'text/css' if path.suffix=='.css' else 'application/json' if path.suffix=='.json' else 'text/html'
                            r.fulfill(status=200,content_type=mime,body=path.read_bytes());return
                    if r.request.url==ENDPOINT:
                        h=r.request.headers
                        result=request(boundary,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),
                            method=r.request.method,authorization=h.get('authorization'),REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,
                            HTTP_X_FORWARDED_PROTO='https',HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),
                            HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''),HTTP_REFERER=h.get('referer',''))
                        r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
                    unexpected.append('UNEXPECTED_EXTERNAL_REQUEST');r.abort()
                context.route('**/*',route)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__))
                page.goto(PAGE,wait_until='domcontentloaded')
                page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click()
                page.wait_for_selector('#devBanner')
                page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>$('nl_mk').textContent.includes('SYNTHETIC NEWS ONLY')&&$('nl_hd').textContent.includes('SYNTHETIC NEWS ONLY')",timeout=20000)
                page.wait_for_function('()=>QD.length===2')
                assert page.locator('#mkBtn').is_enabled()
                assert page.locator('#nhAccountBtn').is_disabled() and page.locator('#externalUploadBtn').is_disabled()
                assert page.locator('button[onclick="saveSettings()"]').is_disabled()
                assert page.evaluate('()=>Object.keys(Q).length>0')
                assert '미조회' in page.locator('#nhAccountRows').inner_text()
                page.evaluate('showQ("^GSPC","Synthetic Index","",1)')
                page.wait_for_function("()=>$('qi').textContent.includes('Yahoo')")
                assert any('finance.yahoo.com' in url for url in gas.reads)
                assert any('news.google.com' in url for url in gas.reads)
                summary=market_screen_check(page)
                assert summary['quoteSymbols']>0 and summary['chartRows']>1
                # A revoked GAS session cannot read even public market data.
                gas.live=False
                denied=page.evaluate("async()=>{const r=await post({action:'publicFetch',url:'https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI',token:LS('invest_session_token')});return r.status}")
                assert denied==401
                gas.live=True;gas.news_fail=True
                page.evaluate('loadNews()')
                page.wait_for_function("()=>$('nst_mk').textContent==='뉴스 수신 실패 · 미확인'&&$('nst_hd').textContent==='뉴스 수신 실패 · 미확인'")
                assert not errors and not unexpected,(errors,unexpected)
                assert set(gas.calls)<={'appVersion','login','sessionInfo','logout'}
                assert set(relay.metrics['upstreamAttempts'])<={'appVersion','login','sessionInfo','logout','publicFetch'}
                context.close()
                print('PASS: synthetic public-market relay/UI/expired-session/source-failure; '+str(width)+'px; NH/store calls 0')
        finally:browser.close()
