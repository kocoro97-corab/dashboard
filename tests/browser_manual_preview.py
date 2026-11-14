"""Changed local-draft UI only. Synthetic authentication; zero account/store calls."""
import json
import base64
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build,PAGE
from relay.app import RelayApp
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request

ORIGIN='https://kocoro97-corab.github.io';HOST='synthetic-preview.trycloudflare.com';ENDPOINT='https://'+HOST+'/api'
CODE='SYNTHETIC_PRIVATE_PREVIEW_CODE'

class Auth:
    def __init__(self):self.calls=[];self.number=0
    def verify(self):pass
    def post(self,body):
        action=body['action'];self.calls.append(action)
        if action=='appVersion':return dict(EXPECTED,success=True)
        if action=='login':
            self.number+=1;return {'success':True,'token':('a' if self.number==1 else 'b')*64,'isAdmin':False}
        if action in ('sessionInfo','logout'):return {'success':True,'isAdmin':False}
        raise AssertionError('FINANCIAL_ACTION_FORBIDDEN')

with tempfile.TemporaryDirectory() as tmp:
    public=Path(tmp)/'public';build(public)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            for width in (344,1440):
                gas=Auth();edge=PublicDevelopment(RelayApp(configuration(origins=frozenset({ORIGIN})),gas),PAGE,CODE);edge.host=HOST
                context=browser.new_context(viewport={'width':width,'height':882},service_workers='block')
                unexpected=[];errors=[]
                def route(r):
                    u=urlsplit(r.request.url)
                    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
                        file=public/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
                        if file.is_file() and public in file.resolve().parents:
                            mime='application/javascript' if file.suffix=='.js' else 'text/css' if file.suffix=='.css' else 'application/json' if file.suffix=='.json' else 'text/html'
                            r.fulfill(status=200,content_type=mime,body=file.read_bytes());return
                    if r.request.url==ENDPOINT:
                        h=r.request.headers
                        result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,
                          REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),
                          HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''))
                        r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
                    unexpected.append('EXTERNAL_REQUEST');r.abort()
                context.route('**/*',route)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__));page.on('dialog',lambda d:d.accept())
                page.goto(PAGE,wait_until='domcontentloaded')
                page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner')
                def login():
                    page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click()
                    page.wait_for_function("()=>$('appContainer').style.display==='block'")
                login();page.wait_for_function('()=>!!EXT_MASTER')
                baseline=len(gas.calls)
                for kind in ('ISA','PENSION','IRP'):
                    page.select_option('#externalAccountType',kind)
                    for field,value in {'Code':'035720','Name':'카카오','Qty':'2','Avg':'1000'}.items():page.locator('#externalManual'+field).fill(value)
                    page.locator('button[onclick="addExternalManual()"]').click()
                assert page.locator('#externalAssetRows tr').count()==3
                assert page.locator('#externalSaveBtn').is_disabled()
                assert page.locator('#externalSummaryCards').evaluate('e=>e.childElementCount')==0
                quantity=page.locator('#externalAssetRows tr').first.locator('input[type="number"]').first
                quantity.fill('3');quantity.press('Tab')
                assert page.evaluate('EXT_ASSETS[0].quantity')==3
                page.locator('#externalUndoBtn').click();assert page.evaluate('EXT_ASSETS[0].quantity')==2
                assert len(gas.calls)==baseline  # Add/edit/undo do not call GAS, NH or storage.
                assert page.locator('#externalUploadBtn').is_enabled() and page.locator('#externalDriveFolder').is_disabled()
                assert page.locator('#nhAccountBtn').is_disabled() and page.locator('#externalAutoRefresh').is_disabled()
                page.locator('#externalManualName').fill('SYNTHETIC_PRIVATE_UNSAVED_INPUT')
                page.evaluate('logout()');page.wait_for_selector('#authGuard',state='visible')
                assert page.evaluate('EXT_ASSETS.length')==0
                for name in ('Code','Name','Qty','Avg'):assert page.locator('#externalManual'+name).input_value()==''
                login();assert page.evaluate('EXT_ASSETS.length')==0
                assert '미조회' in page.locator('#externalAssetRows').inner_text()
                if '--real-ocr' in sys.argv:
                    # Synthetic image only; execute the actual pinned worker/core/kor+eng.
                    image=page.evaluate("""async()=>{
                      await document.fonts.ready;
                      const c=document.createElement('canvas');c.width=1150;c.height=260;
                      const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);
                      x.fillStyle='black';x.font='36px "Noto Sans CJK KR"';
                      [['종목명',40,70],['수량',520,70],['평균매입가',800,70],
                       ['카카오',40,160],['2',540,160],['1,000',840,160]].forEach(v=>x.fillText(...v));
                      return c.toDataURL('image/png').split(',')[1];
                    }""")
                    baseline=len(gas.calls)
                    page.locator('#externalImageFiles').set_input_files({'name':'synthetic-only.png','mimeType':'image/png','buffer':base64.b64decode(image)})
                    page.locator('#externalUploadBtn').click()
                    page.wait_for_function("()=>!$('externalUploadBtn').disabled",timeout=120000)
                    assert page.evaluate('EXT_ASSETS.length')==1,page.locator('#externalOcrProgress').inner_text()
                    assert page.evaluate("EXT_ASSETS[0].quantity===2 && EXT_ASSETS[0].avgPrice===1000")
                    assert page.locator('#externalSaveBtn').is_disabled() and page.locator('#externalDriveFolder').is_disabled()
                    assert len(gas.calls)==baseline
                    assert page.locator('#externalOcrRaw').input_value()
                    # Controlled first-pass errors + actual crop workers. Values
                    # are synthetic; no real holdings/image fixture is retained.
                    crop_image=page.evaluate("""()=>{
                      EXT_ASSETS=[];EXT_UNDO=[];renderExternalAssets();
                      const c=document.createElement('canvas');c.width=1100;c.height=480;
                      const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);
                      x.fillStyle='black';x.font='40px "Noto Sans CJK KR"';
                      [['종목명',20,104],['수량',450,104],['매입가',700,104],
                       ['KCC글라스',20,224],['7',450,248],['1,300',700,248],
                       ['씨앤투스',20,384],['8',450,408],['2,400',700,408]].forEach(v=>x.fillText(...v));
                      const w=(text,x,y,width=80)=>({text,bbox:{x0:x,x1:x+width,y0:y,y1:y+44}});
                      window.originalOcrRecognize=Tesseract.recognize;
                      Tesseract.recognize=async()=>({data:{text:'SYNTHETIC_FIRST_PASS',words:[
                        w('종목명',20,60),w('수량',450,60),w('매입가',700,60),
                        w('MIXEDUNKNOWN',20,180,220),w('7',450,204),w('1,300',700,204),
                        w('한글오독',20,340,180),w('8',450,364),w('2,400',700,364)]}});
                      return c.toDataURL('image/png').split(',')[1];
                    }""")
                    page.locator('#externalImageFiles').set_input_files({'name':'synthetic-crop-only.png','mimeType':'image/png','buffer':base64.b64decode(crop_image)})
                    page.locator('#externalUploadBtn').click()
                    page.wait_for_function("()=>!$('externalUploadBtn').disabled",timeout=120000)
                    assert page.evaluate('EXT_ASSETS.length')==2
                    assert page.evaluate("EXT_ASSETS[0].quantity===7 && EXT_ASSETS[0].avgPrice===1300 && EXT_ASSETS[1].quantity===8 && EXT_ASSETS[1].avgPrice===2400")
                    assert page.evaluate("EXT_ASSETS[0].name==='KCC글라스' && EXT_ASSETS[1].name==='씨앤투스'")
                    page.evaluate('Tesseract.recognize=window.originalOcrRecognize;delete window.originalOcrRecognize')
                    assert len(gas.calls)==baseline
                    page.evaluate('logout()');page.wait_for_selector('#authGuard',state='visible')
                    assert page.locator('#externalImageFiles').input_value()==''
                    assert page.locator('#externalOcrRaw').count()==0
                    print('PASS: actual local kor+eng OCR engine on synthetic image; review/quantity/price; no financial HTTP/storage; '+str(width)+'px')
                assert set(gas.calls)<={'appVersion','login','sessionInfo','logout'}
                assert not unexpected and not errors,(unexpected,errors)
                context.close()
                print('PASS: synthetic manual preview add/edit/undo/logout isolation; '+str(width)+'px; financial requests 0')
        finally:browser.close()
