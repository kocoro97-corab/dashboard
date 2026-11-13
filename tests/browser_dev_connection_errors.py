"""Synthetic development-connection diagnostics; no real endpoint or credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build,PAGE

ENDPOINT='https://synthetic-only.trycloudflare.com/api'
CANARY='SYNTHETIC_PRIVATE_INPUT_NEVER_DISPLAY'
VALID={'success':True,'freshTestEnvironment':True,'testEnvironment':'nh-staging','gatewayVersion':2,'storeEngine':'account-store-v2'}
CASES=[
    ('DEV_ACCESS_REQUIRED',403,{'success':False,'code':'DEV_ACCESS_REQUIRED','message':CANARY}),
    ('DEV_PAGE_REQUIRED',403,{'success':False,'code':'DEV_PAGE_REQUIRED'}),
    ('DEV_ACCESS_CLOSED',503,{'success':False,'code':'DEV_ACCESS_CLOSED'}),
    ('DEV_RATE_LIMIT',429,{'success':False,'code':'DEV_RATE_LIMIT'}),
    ('RELAY_TARGET_MISMATCH',503,{'success':False,'code':'RELAY_TARGET_MISMATCH'}),
    ('DEV_REJECTED',403,{'success':False,'code':CANARY,'message':CANARY}),
    ('DEV_REJECTED',403,{'success':False,'code':'__proto__','message':CANARY}),
    ('DEV_RESPONSE_NOT_JSON',502,'<html>'+CANARY+'</html>'),
    ('DEV_METADATA_MISMATCH',200,{'success':True,'freshTestEnvironment':False}),
    ('DEV_NETWORK',0,None),
    ('DEV_STORAGE',200,VALID),
]

with tempfile.TemporaryDirectory() as tmp:
    artifact=Path(tmp)/'public';build(artifact)
    with sync_playwright() as p:
        args={'headless':True}
        if os.environ.get('CHROMIUM_EXECUTABLE'):args['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
        browser=p.chromium.launch(**args)
        try:
            for expected,http,data in CASES:
                context=browser.new_context(viewport={'width':344,'height':882},service_workers='block')
                if expected=='DEV_STORAGE':
                    context.add_init_script("""(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage&&k==='myinvest_v2_dev:connection')throw Error('SYNTHETIC_PRIVATE_INPUT_NEVER_DISPLAY');return set.call(this,k,v)}})()""")
                calls=[]
                def route(r):
                    u=urlsplit(r.request.url)
                    if r.request.url==ENDPOINT:
                        calls.append(json.loads(r.request.post_data or '{}').get('action'))
                        if http==0:r.abort('failed');return
                        r.fulfill(status=http,headers={'Access-Control-Allow-Origin':'https://kocoro97-corab.github.io'},
                                  content_type='application/json' if isinstance(data,dict) else 'text/html',
                                  body=json.dumps(data) if isinstance(data,dict) else data);return
                    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
                        name=u.path.removeprefix('/dashboard-v2-dev/') or 'index.html';file=artifact/name
                        if file.is_file() and artifact in file.resolve().parents:
                            mime='application/javascript' if file.suffix=='.js' else 'text/css' if file.suffix=='.css' else 'text/html'
                            r.fulfill(status=200,content_type=mime,body=file.read_bytes());return
                    r.abort()
                context.route('**/*',route)
                page=context.new_page();page.goto(PAGE,wait_until='domcontentloaded')
                page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CANARY)
                assert page.locator('#devCode').get_attribute('autocapitalize')=='none'
                page.locator('#devConnectSubmit').click()
                page.wait_for_function("code=>document.getElementById('devConnectStatus').textContent.includes('('+code)",arg=expected)
                message=page.locator('#devConnectStatus').inner_text()
                assert CANARY not in message and '<html>' not in message and 'https://' not in message
                assert calls==['appVersion']
                assert page.locator('#devConnect').is_visible()
                context.close()
                print('PASS: synthetic safe development diagnostic '+expected)
        finally:browser.close()
