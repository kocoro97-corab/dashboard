"""306d2e05 market / 028b527e sectors: synthetic session, independent UI assertions.
No live owner credentials, NH, storage or paid model operations.
"""
import argparse,json,mimetypes,os,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,quote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--widths',nargs='+',type=int,default=[1440,690,344]);p.add_argument('--area',choices=['both','market','sectors'],default='both');p.add_argument('--output',type=Path,default=Path('/tmp/market-sector-recheck'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
BASE='https://kocoro97-corab.github.io/dashboard-v2-dev/';ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api';LIST='https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100'
def stock(code,name,rate,value):return {'itemCode':code,'stockName':name,'fluctuationsRatio':str(rate),'accumulatedTradingValue':str(value),'accumulatedTradingVolume':'100'}
fixtures={LIST:json.dumps({'groups':[{'no':12,'name':'합성테마 A','changeRate':'4'},{'no':13,'name':'합성테마 B','changeRate':'2'}]}),
 'https://m.stock.naver.com/api/stocks/theme/12?page=1&pageSize=100':json.dumps({'stocks':[stock('005930','삼성전자',2,100),stock('000660','SK하이닉스',-1,300),stock('035720','카카오',0,200)]}),
 'https://m.stock.naver.com/api/stocks/theme/13?page=1&pageSize=100':json.dumps({'stocks':[stock('005930','삼성전자',2,100),stock('344820','KCC글라스',-2,500),stock('352700','씨앤투스',1,400)]})}
for sym in ['^KS11','^KQ11','^GSPC','^IXIC','^DJI','^SOX','^VIX','^TNX','^IRX','KRW=X','GC=F','CL=F','NQ=F','ES=F','YM=F','344820.KS','005930.KS','000660.KS','035720.KS','352700.KQ','SPY','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLC','XLU','XLB','XLRE']:
 values=[100+i for i in range(70)];stamp=int(time.time())-80*86400
 doc={'chart':{'result':[{'meta':{'symbol':sym,'currency':'KRW' if sym.endswith(('.KS','.KQ')) or sym in ['^KS11','^KQ11'] else 'USD','exchangeName':'KSC' if sym.endswith('.KS') or sym=='^KS11' else 'KOE' if sym.endswith('.KQ') or sym=='^KQ11' else 'PCX','regularMarketPrice':169,'chartPreviousClose':168,'regularMarketTime':stamp+69*86400},'timestamp':[stamp+i*86400 for i in range(70)],'indicators':{'quote':[{'open':values,'high':[x+2 for x in values],'low':[x-2 for x in values],'close':values,'volume':[1000]*70}]}}]}}
 for interval,period in [('1d','1d'),('1d','1y'),('1d','3mo')]:fixtures['https://query1.finance.yahoo.com/v8/finance/chart/'+quote(sym,safe="~()*!.'")+'?interval='+interval+'&range='+period]=json.dumps(doc)
from public_integration_support import US_STOCKS,history,history_url
for symbol in US_STOCKS:fixtures[history_url(symbol)]=json.dumps(history(symbol))
results=[]
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);fixture=Path(tmp)/'feeds.json';fixture.write_text(json.dumps(fixtures));browser=pw.chromium.launch(headless=True)
 try:
  for width in args.widths:
   for area in (['market','sectors'] if args.area=='both' else [args.area]):
    bridge=subprocess.Popen(['node','tests/worker_browser_bridge.mjs'],cwd=ROOT,env=dict(os.environ,MYINVEST_TEST_PUBLIC_FIXTURE=str(fixture)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);port=json.loads(bridge.stdout.readline())['port'];ctx=browser.new_context(viewport={'width':width,'height':1000},timezone_id='Asia/Seoul',service_workers='block');page=ctx.new_page();errors=[];requests=[]
    def route(r):
     u=urlsplit(r.request.url)
     if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
      file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
      if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
     if r.request.url==ENDPOINT:
      body=json.loads(r.request.post_data or '{}');requests.append({'action':body.get('action'),'url':body.get('url')})
      req=urllib.request.Request('http://127.0.0.1:'+str(port),data=json.dumps({'headers':r.request.headers,'method':r.request.method,'body':r.request.post_data}).encode(),headers={'Content-Type':'application/json'})
      with urllib.request.urlopen(req,timeout=20) as response:res=json.load(response)
      r.fulfill(status=res['status'],headers=res['headers'],body=res['body']);return
     r.abort()
    ctx.route('**/*',route);page.on('pageerror',lambda e:errors.append(type(e).__name__));page.set_default_timeout(10000)
    def check(name,fn):
     try:fn();row={'area':area,'width':width,'test':name,'status':'PASS','scope':'SYNTHETIC_SESSION_AND_FEEDS'}
     except Exception as e:
      row={'area':area,'width':width,'test':name,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:220],'scope':'SYNTHETIC_SESSION_AND_FEEDS'}
      page.screenshot(path=str(args.output/(str(width)+'-'+area+'-'+name+'-FAIL.png')))
      closer=page.locator('.miv-overlay button',has_text='닫기')
      if closer.count():closer.first.click()
     results.append(row);print(json.dumps(row),flush=True)
    def settled():page.wait_for_function('()=>document.getElementById("pageStatus")?.textContent.startsWith("연결됨")')
    def go(name):page.locator('#dashboardNav a[href="#/'+name+'"]').click();page.wait_for_function('(n)=>DashboardShell.getStatus().page===n',arg=name);settled()
    def close():page.locator('.miv-overlay button',has_text='닫기').click()
    try:
     page.clock.set_fixed_time('2026-11-17T03:00:00Z');page.goto(BASE+'index.html#/'+area,wait_until='domcontentloaded');page.wait_for_selector('#devBanner');page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_selector('#dashboardNav');settled()
     if area=='market':
      def region():
       page.locator('.miv-top button',has_text='미국장 전환').click();page.wait_for_function('()=>!!Q["NQ=F"]');go('sectors');go('market');assert page.locator('.miv-top .miv-controls button').first.inner_text()=='한국장 표시 · 미국장 전환';assert page.locator('.miv-indicator strong').first.inner_text()=='KOSPI'
      check('REGION_DEFAULT_REAPPLIED_AFTER_VISIT',region)
      observed=1794805200000;received=1794808800000
      def provenance():
       page.evaluate('([a,b])=>{Q["^KS11"]={p:100,prev:99,observedAt:a};SRC["^KS11"]="Y";QT["^KS11"]=b}',[observed,received]);page.locator('.miv-market button',has_text='시장 국면').click();row=page.locator('.miv-observation-row').filter(has=page.locator('span',has_text='KOSPI'));text=row.locator('small').inner_text();times=page.evaluate('([a,b])=>[new Date(a).toLocaleString("ko-KR"),new Date(b).toLocaleString("ko-KR")]',[observed,received]);assert '출처: Yahoo' in text and '관측: '+times[0] in text and '수신: '+times[1] in text;page.screenshot(path=str(args.output/(str(width)+'-market-provenance.png')));close()
      check('SOURCE_OBSERVED_AND_RECEIVED_ARE_DISTINCT',provenance)
      def missing():
       for value in [None,'invalid-time']:
        page.evaluate('(v)=>{Q["^KS11"].observedAt=v}',value);page.locator('.miv-market button',has_text='시장 국면').click();row=page.locator('.miv-observation-row').filter(has=page.locator('span',has_text='KOSPI'));assert '관측시각 미확인' in row.inner_text();assert '수신시각 미확인' not in row.inner_text();close()
      check('MISSING_OR_INVALID_OBSERVATION_STAYS_UNKNOWN',missing)
      def units():
       page.locator('.miv-market button',has_text='지표 편집').click();labels=page.locator('.miv-edit-row input').evaluate_all('(a)=>a.map(x=>x.getAttribute("aria-label"))')
       for label in labels:page.get_by_label(label,exact=True).check()
       page.locator('.miv-dialog button',has_text='순서 저장').click();page.wait_for_function('()=>!MK_BUSY');page.evaluate('()=>{for(const id of ["^TNX","^IRX","GC=F","CL=F","NQ=F","ES=F","YM=F","k3","k4"]){Q[id]={p:100,prev:99};SRC[id]="Y";QT[id]=Date.now()}}');page.locator('.miv-market button',has_text='시장 국면').click()
       expected={'미국 10년물':'% (공급자 수익률 표기)','미국 단기금리':'% (공급자 수익률 표기)','금 선물':'USD/트로이온스','WTI 원유':'USD/배럴','NASDAQ 선물':'지수 포인트 · 공급자 연속선물','S&P 500 선물':'지수 포인트 · 공급자 연속선물','DOW 선물':'지수 포인트 · 공급자 연속선물','KOSPI 200 선물':'지수 포인트 · 계약/만기 미확인','KOSDAQ 150 선물':'지수 포인트 · 계약/만기 미확인'}
       for name,unit in expected.items():
        row=page.locator('.miv-observation-row').filter(has=page.locator('span',has_text=name));assert unit in row.inner_text(),name
        if '선물' in name:assert ('롤 조정 방식 미확인' if name in ['금 선물','WTI 원유','NASDAQ 선물','S&P 500 선물','DOW 선물'] else '계약/만기 식별 미확인') in row.inner_text()
       page.screenshot(path=str(args.output/(str(width)+'-market-units.png')));close()
      check('YIELDS_METALS_OIL_US_AND_KR_FUTURES_UNITS',units)
      def layout():
       assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors;page.screenshot(path=str(args.output/(str(width)+'-market.png')))
      check('MARKET_LAYOUT_AND_NO_SCRIPT_ERRORS',layout)
     else:
      def loaded():
       page.wait_for_function('()=>!THM_BUSY&&THM.length===2');assert sum(r['url']==LIST for r in requests)==1;assert page.locator('.stv2-overview .stv2-card').count()==2
      check('FIRST_ENTRY_LOADS_DOMESTIC_THEMES_ONCE',loaded)
      def metrics():
       for name,text in [('합성테마 A','상승 1 / 하락 1 / 보합 1'),('합성테마 B','상승 2 / 하락 1 / 보합 0')]:
        card=page.locator('.stv2-overview .stv2-card').filter(has=page.locator('strong',has_text=name));assert text in card.inner_text();assert ('33.3%' if name.endswith('A') else '66.7%') in card.inner_text()
       values=page.evaluate('THM.map(t=>({name:t.name,sc:t.sc}))');assert values==[{'name':'합성테마 B','sc':45},{'name':'합성테마 A','sc':35}]
      check('BREADTH_COUNTS_RATIO_AND_STRENGTH',metrics)
      def leaders():
       rows=page.locator('.stv2-overview table tr').all()[1:];codes=[r.locator('td').first.inner_text() for r in rows];assert codes==['KCC글라스 (344820)','씨앤투스 (352700)','SK하이닉스 (000660)','카카오 (035720)','삼성전자 (005930)'];assert [r.locator('td').nth(3).inner_text() for r in rows]==['500','400','300','200','100'];page.screenshot(path=str(args.output/(str(width)+'-sectors-leaders.png')))
      check('LEADERS_TURNOVER_ORDER_DEDUP_AND_NAMES',leaders)
      def refresh():
       page.get_by_role('button',name='테마 데이터 새로고침',exact=True).click();page.wait_for_function('()=>!THM_BUSY');page.wait_for_selector('.stv2-heading button:not([disabled])');assert sum(r['url']==LIST for r in requests)==2
      check('EXPLICIT_REFRESH_FETCHES_ONCE',refresh)
      def modes():
       page.get_by_role('button',name='시장 전환: 현재 한국',exact=True).click();page.wait_for_function('()=>document.querySelector(".stv2").textContent.includes("미국 11개 섹터 ETF 상대강도")');assert '개별 미국 테마' in page.locator('.stv2').text_content();assert page.locator('.stv2-overview').count()==0
       page.get_by_role('button',name='시장 전환: 현재 미국',exact=True).click();page.locator('.stv2-tabs button',has_text='스윙').click();page.locator('.stv2-tabs button',has_text='5일').click();page.wait_for_function('()=>document.querySelector(".stv2").textContent.includes("국내 상위 테마 구성종목 표본 분석")');assert '전체 테마 수익률' in page.locator('.stv2').inner_text();assert page.locator('.stv2-overview').count()==0
       page.wait_for_function('()=>document.querySelector(".stv2").textContent.includes("매수 추천이 아닙니다")');page.locator('.stv2-tabs button',has_text='단타').click()
      check('US_AND_KR_HISTORY_SCOPES_AND_SWING_DISCLOSURES',modes)
      def selection():
       page.locator('.stv2-overview table tr').nth(1).get_by_role('button',name='종목분석',exact=True).click();page.wait_for_function('()=>DashboardShell.getStatus().page==="stocks"');assert page.locator('#stockSearch').input_value()=='344820';page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert 'KCC글라스 (344820)' in page.locator('.sva').inner_text();assert any(r['url'] and '344820.KS' in r['url'] for r in requests);go('sectors')
      check('LEADER_CLICK_TO_VERIFIED_STOCK_ANALYSIS',selection)
      def layout():
       assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors;page.screenshot(path=str(args.output/(str(width)+'-sectors.png')))
      check('SECTORS_LAYOUT_AND_NO_SCRIPT_ERRORS',layout)
     def cleanup():
      page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert page.locator('.miv-overlay,.stv2,.miv-market').count()==0;assert not any(r['action'] in ['order','saveExternalHoldings','restoreExternalHoldings','nhQuotes','nhAccounts'] for r in requests)
     check('CLEANUP_AND_NO_PRIVATE_OR_WRITE_REQUESTS',cleanup)
    finally:ctx.close();bridge.terminate();bridge.wait(timeout=5)
 finally:browser.close()
(args.output/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps({'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)}));raise SystemExit(1 if any(x['status']=='FAIL' for x in results) else 0)
