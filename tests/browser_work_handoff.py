"""Runtime verification of supplied Work modules. No live NH/GAS/Calendar writes."""
import argparse,ast,copy,json,mimetypes,sys,tempfile,time
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
from browser_reference_widgets import fulfill_reference_widget
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from browser_review_selectors import stock_heading,watch_code_cell
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request,TOKEN
ns=dict(json=json,urlsplit=urlsplit,unquote=unquote,copy=copy,RelayFault=RelayFault,TOKEN=TOKEN,EXPECTED=EXPECTED,fixture=json.loads((ROOT/'tests/fixtures/isa-ocr.json').read_text()));ns['ns']=ns
for filename in ['browser_public_market.py','browser_app_shell.py']:
 tree=ast.parse((ROOT/'tests'/filename).read_text());exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Gas'],type_ignores=[]),'existing-synthetic-fixture','exec'),ns)
class Gas(ns['Gas']):
 def __init__(self):super().__init__();self.chart_fail=False;self.mismatch=False;self.reads=[]
 def post(self,payload):
  assert payload['action'] not in ['saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts','investCalendarDecision','investCalendarSync']
  result=super().post(payload)
  if payload['action'] in ['login','sessionInfo'] and result.get('success'):result['isAdmin']=True
  return result
 def public(self,url,token):
  self.reads.append(url);u=urlsplit(url)
  if 'theme' in u.path:
   if u.path.endswith('/list'):return json.dumps({'themes':[{'no':1,'name':'합성 테마','changeRate':2}]})
   return json.dumps({'stocks':[{'itemCode':'035720','stockName':'합성 종목','fluctuationsRatio':2,'accumulatedTradingValue':100000,'accumulatedTradingVolume':1000}]})
  if u.hostname=='query1.finance.yahoo.com':
   if self.chart_fail:raise RelayFault('RELAY_UPSTREAM_NETWORK')
   symbol=unquote(u.path.rsplit('/',1)[-1]);stamp=int(time.time())-80*86400;values=[100+i for i in range(70)]
   return json.dumps({'chart':{'result':[{'meta':{'symbol':'WRONG' if self.mismatch else symbol,'currency':'KRW' if symbol.endswith(('.KS','.KQ')) else 'USD','regularMarketPrice':169,'chartPreviousClose':168,'regularMarketTime':stamp+69*86400},'timestamp':[stamp+i*86400 for i in range(70)],'indicators':{'quote':[{'open':[v-1 for v in values],'high':[v+2 for v in values],'low':[v-2 for v in values],'close':values,'volume':[1000]*70}]}}]}})
  return super().public(url,token)
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--evidence-dir',type=Path);args=p.parse_args()
if args.evidence_dir:args.evidence_dir.mkdir(parents=True,exist_ok=True)
ORIGIN='https://kocoro97-corab.github.io';BASE=ORIGIN+'/dashboard-v2-dev/';HOST='synthetic-work.trycloudflare.com';ENDPOINT='https://'+HOST+'/api';CODE='SYNTHETIC_PRIVATE_WORK_CODE'
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,use_public_config=False);browser=pw.chromium.launch(headless=True)
 try:
  for width in [1440,344,690]:
   gas=Gas();app=RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True,account_reads=True),gas);edge=PublicDevelopment(app,BASE,CODE);edge.host=HOST;errors=[];unexpected=[];findings=[]
   context=browser.new_context(viewport={'width':width,'height':900},timezone_id='Asia/Seoul',service_workers='block')
   def route(r):
    if fulfill_reference_widget(r):return
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     if args.published:r.continue_();return
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    # Only the fixed optional public briefing JSON file is absent from this synthetic build.
    # Reject all other unexpected network requests as before.
    if not args.published and r.request.method=='GET' and u.hostname=='kocoro97-corab.github.io' and u.path=='/dashboard-v2-dev/data/myinvest-public-briefings-v1.json':
     r.fulfill(status=404,content_type='application/json',body='');return
    if r.request.url==ENDPOINT:
     h=r.request.headers;result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''));r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
    unexpected.append(u.hostname);r.abort()
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.set_default_timeout(10000)
   page.goto(BASE+'index.html#/accounts',wait_until='domcontentloaded');page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner');page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function('()=>!!EXT_SAVED_REV&&NH_ACCOUNT_SESSION===LS("invest_session_token")')
   def go(path):
    page.locator('#dashboardNav a[href="#/'+path+'"]').click();page.wait_for_function('(p)=>DashboardShell.getStatus().path==="/"+p',arg=path)
   go('market');page.locator('.miv-indicator').first.click();chart=page.get_by_role('dialog');chart.locator('canvas').wait_for();chart.get_by_role('button',name='월',exact=True).click();chart.locator('canvas').wait_for();chart.get_by_role('button',name='✕ 닫기',exact=True).click();assert any('range=3mo' in x for x in gas.reads) and any('range=5y' in x for x in gas.reads)
   # Newly supplied navigation and public-data stock analyzer, preserving account data.
   before=page.evaluate('JSON.stringify(extRows(EXT_ASSETS))');go('sectors');page.wait_for_function('()=>!THM_BUSY');
   assert page.locator('.stv2 input').count()==0
   page.evaluate("MYInvestStockSelection.open('035720',{mode:'swing',name:'카카오'})");page.wait_for_function('()=>DashboardShell.getStatus().path==="/stocks"');stock_heading(page,'035720').wait_for();assert '평균매입가' in page.locator('.sva > section.sva-alert').inner_text()
   page.get_by_role('button',name='이 종목 투자전략',exact=True).first.click();page.wait_for_selector('.str4');assert '035720' in page.locator('.str4-nav').inner_text()
   for label,value in [('가정 진입가','100'),('가정 손절가','90'),('가정 목표가','120')]:page.get_by_label(label,exact=True).fill(value)
   assert '1,000주' in page.locator('.str4-cards').inner_text();assert '평균매입가' in page.locator('.str4-output').filter(has=page.get_by_role('heading',name='계좌별 보유 전략 · 035720',exact=True)).inner_text()
   page.get_by_role('button',name='종목분석 보기',exact=True).click();page.wait_for_selector('#stockSearch');page.locator('#stockSearch').fill('AAPL');page.get_by_role('button',name='종목 분석',exact=True).click();stock_heading(page,'AAPL').wait_for();assert page.locator('#stockSearch').input_value()=='AAPL'
   # Explicit upstream failure produces unavailable state, never fake output.
   gas.chart_fail=True;page.locator('#stockSearch').fill('MSFT');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_selector('.sva-alert:text-is("실제 OHLCV 21봉 이상이 필요합니다. 종목 코드는 상장 종목 원천 확인 후 사용하세요. 가짜 가격이나 점수를 생성하지 않습니다.")');gas.chart_fail=False
   # Probe contract weakness for the ChatGPT owner; no real values or writes.
   gas.mismatch=True;page.locator('#stockSearch').fill('GOOG');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>document.querySelector(".sva").textContent.includes("분석 완료")||document.querySelector(".sva").textContent.includes("분석 불가")');
   if stock_heading(page,'GOOG').count():findings.append('STOCK_RESPONSE_SYMBOL_NOT_VALIDATED')
   gas.mismatch=False
   page.get_by_role('button',name='투자 캘린더',exact=True).click();dialog=page.get_by_role('dialog',name='투자 일정 캘린더');dialog.wait_for();assert '아직 연동되지' in dialog.inner_text();dialog.get_by_role('button',name='닫기',exact=True).click()
   page.get_by_label('이벤트 날짜',exact=True).fill('2026-11-20');page.get_by_label('이벤트 제목',exact=True).fill('합성 일정 테스트');page.get_by_role('button',name='일정 등록',exact=True).click();assert '합성 일정 테스트' in page.locator('.nev5').inner_text();page.get_by_role('button',name='투자 캘린더',exact=True).click();dialog.wait_for();page.keyboard.press('Escape')
   if dialog.is_visible():findings.append('CALENDAR_ESCAPE_AND_FOCUS_NOT_IMPLEMENTED');dialog.get_by_role('button',name='닫기',exact=True).click()
   go('home');page.get_by_role('button',name='투자 캘린더',exact=True).click();dialog.wait_for();dialog.get_by_role('button',name='닫기',exact=True).click();page.locator('.nev5-row').filter(has_text='합성 일정 테스트').get_by_role('button',name='삭제',exact=True).click();assert page.evaluate('JSON.parse(localStorage.getItem("myinvest_events_manual_v1")).length')==0
   for path in ['market','sectors','stocks','strategy','news','accounts']:
    go(path);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),path
    if args.evidence_dir:page.screenshot(path=str(args.evidence_dir/(str(width)+'-'+path+'.png')))
   assert page.evaluate('JSON.stringify(extRows(EXT_ASSETS))')==before
   go('news');page.get_by_role('button',name='투자 캘린더',exact=True).click();dialog.wait_for();page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert page.get_by_role('dialog').count()==0;assert not errors and not unexpected,(errors,unexpected)
   print(json.dumps({'status':'PASS_WITH_FINDINGS' if findings else 'PASS','scope':'PUBLISHED_ASSETS_SYNTHETIC_SERVICES' if args.published else 'LOCAL_ARTIFACT_SYNTHETIC_SERVICES','width':width,'navigationAndAnalysis':'PASS','accountCostBasis':'PASS','upstreamFailure':'PASS','manualCalendar':'PASS_LOCAL_ONLY','logoutCleanup':'PASS','findings':findings,'actualNhCalls':0,'realStorageWrites':0,'calendarApiCalls':0}),flush=True);context.close()
 finally:browser.close()
