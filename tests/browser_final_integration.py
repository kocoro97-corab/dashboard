"""Final deltas only: industries, news timestamps/layout, public news links.
Synthetic sessions/prices/holdings; no actual NH, orders or external-store writes.
"""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
args=argparse.ArgumentParser();args.add_argument('--published',action='store_true');args.add_argument('--output',type=Path,default=Path(tempfile.gettempdir())/'myinvest-final-integration');ARGS=args.parse_args();OUT=ARGS.output;OUT.mkdir(parents=True,exist_ok=True)
INDUSTRY='https://m.stock.naver.com/api/stocks/industry'
def feeds():
 f=synthetic_feeds();
 for query in ['코스피 OR 증시 OR 나스닥 when:2d','(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d']:
  f['https://news.google.com/rss/search?q='+quote(query,safe="~()*!.'")+'&hl=ko&gl=KR&ceid=KR:ko']='<rss><channel><item><title>삼성전자 실적 기사</title><link>https://example.com/public</link><source>합성 언론</source><pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>'
 groups=[{'no':285,'name':'합성 산업','changeRate':'2','totalCount':2,'riseCount':1,'fallCount':1,'steadyCount':0}];f[INDUSTRY+'?page=1&pageSize=100']=json.dumps({'groups':groups,'totalCount':1});f[INDUSTRY+'/285?page=1&pageSize=100']=json.dumps({'groupInfo':groups[0],'totalCount':2,'stocks':[{'itemCode':code,'stockName':name,'stockExchangeType':{'nameEng':'KOSPI'},'closePriceRaw':'100','localTradedAt':'2026-11-16T15:30:00+09:00','fluctuationsRatio':rate,'accumulatedTradingValueRaw':'123000000','accumulatedTradingVolumeRaw':'1230'} for code,name,rate in [('005930','삼성전자','2'),('000660','SK하이닉스','-1')]]});return f
async def choose_industry(page):
 toggle=page.get_by_role('button',name='분석 범위 전환: 현재 테마',exact=True)
 if await toggle.count():await toggle.click()
 assert await page.get_by_role('button',name='분석 범위 전환: 현재 산업',exact=True).count()==1
async def main():
 results=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   b=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,690,344]:
     h=await Harness(b,artifact,feeds(),width,published=ARGS.published).start_browser(tmp)
     async def check(name,fn):
      try:await fn();row={'width':width,'test':name,'status':'PASS'}
      except Exception as e:row={'width':width,'test':name,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:200]};await h.page.screenshot(path=str(OUT/(str(width)+'-'+name+'-FAIL.png')))
      results.append(row);print(json.dumps(row),flush=True)
     try:
      await h.page.clock.set_fixed_time('2026-11-17T03:00:00Z');await h.login('sectors')
      async def industries():
       await choose_industry(h.page);await h.page.wait_for_selector('.stv2-industries');assert '50.00%' in await h.page.locator('.stv2-industries').inner_text();await h.page.get_by_role('button',name='합성 산업',exact=True).click();await h.page.wait_for_selector('.stv2-kr-members');assert '123,000,000' in await h.page.locator('.stv2-kr-members').inner_text();await h.page.locator('.stv2-kr-members button').first.click();await h.page.wait_for_selector('#stockSearch');assert await h.page.evaluate('InvestWorkflow.current().industry')=='합성 산업';assert await h.page.evaluate('InvestWorkflow.current().source')=='industry';assert await h.page.evaluate('InvestWorkflow.current().dataScope')=='kr_industry_sample';assert await h.page.evaluate('InvestWorkflow.current().benchmark')=='^KS11';await h.go('sectors');await choose_industry(h.page);await h.page.get_by_role('button',name='스윙',exact=True).click();await h.page.wait_for_selector('.stv2-insights');await h.page.locator('.stv2-insights summary').first.click();assert '60일' in await h.page.locator('.stv2-insights').inner_text() or '60' in await h.page.locator('.stv2-insights').inner_text();assert '수신 또는 검증 실패' not in await h.page.locator('.stv2').inner_text();await h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name='미국',exact=True).click();await h.page.wait_for_selector('.stv2-insights');await h.page.locator('.stv2-insights summary').first.click();assert '통계적 동행' in await h.page.locator('.stv2-insights').inner_text();assert await h.page.locator('.stv2-insights table').count()==2;await h.page.screenshot(path=str(OUT/(str(width)+'-industries.png')));assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
      await check('INDUSTRY_BREADTH_RAW_AMOUNTS_ANALYSIS_LINK_AND_MOMENTUM',industries)
      async def briefing():
       await h.go('news');assert await h.page.locator('.nev5-brief').count()==1;assert await h.page.locator('.nev5-news-top #newsSection').count()==1
       if width==1440:
        brief=await h.page.locator('.nev5-brief').bounding_box();news=await h.page.locator('#newsSection').bounding_box();assert news['x']>brief['x'];assert abs(news['y']-brief['y'])<35
       scroll=await h.page.locator('.nev5-brief-scroll').bounding_box();assert (350<=scroll['height']<=480) if width==1440 else (220<=scroll['height']<=350)
       await h.page.locator('.nev5-brief-editor summary').first.click();await h.page.locator('.nev5-brief-editor input[type=date]').fill('2026-11-17');await h.page.locator('.nev5-brief-editor textarea').fill('공개 합성 브리핑\n'*150);await h.page.get_by_text('생성·관측·조회 시각 (선택 · 한국시간)',exact=True).click();await h.page.get_by_label('브리핑 생성시각',exact=True).fill('2026-11-17T09:00');await h.page.get_by_label('시장 데이터 관측시각',exact=True).fill('2026-11-17T08:50');await h.page.get_by_label('자료 조회시각',exact=True).fill('2026-11-17T08:55');await h.page.get_by_role('button',name='보고서 저장',exact=True).click();stored=await h.page.evaluate('JSON.parse(localStorage.getItem("myinvest_public_ai_briefings_v1"))[0]');assert stored['generatedAt']==1794873600000;assert stored['generatedAt']!=stored['at'];assert '시장 관측' in await h.page.locator('.nev5-brief').inner_text();assert await h.page.locator('.nev5-brief-scroll').evaluate('e=>e.scrollHeight>e.clientHeight');await h.page.locator('.nev5-brief-body>summary').click();assert not await h.page.locator('.nev5-brief-scroll').is_visible();await h.page.locator('.nev5-brief-body>summary').click();assert await h.page.locator('.nev5-brief-scroll').is_visible();await h.page.get_by_role('button',name='투자 캘린더',exact=True).click();dialog=h.page.get_by_role('dialog');await dialog.wait_for();await h.page.keyboard.press('Escape');assert await dialog.count()==0;assert await h.page.get_by_role('button',name='투자 캘린더',exact=True).evaluate('e=>e===document.activeElement');await h.go('market');await h.go('news');assert await h.page.locator('#newsSection').count()==1;assert await h.page.locator('.nev5-brief').count()==1;assert await h.page.locator('.news').first.get_attribute('data-news-published')=='2026-11-17T00:00:00.000Z';await h.page.get_by_role('button',name='삼성전자 (005930) 분석',exact=True).first.click();await h.page.wait_for_selector('#stockSearch');assert await h.page.evaluate('InvestWorkflow.current().source')=='news';assert await h.page.locator('#stockSearch').input_value()=='005930';await h.go('news');await h.page.screenshot(path=str(OUT/(str(width)+'-news.png')));assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not h.errors
      await check('BRIEF_TIMESTAMPS_COLLAPSE_FEED_LAYOUT_AND_CALENDAR_FOCUS',briefing)
      async def home_p1():
       await h.go('home');assert await h.page.locator('.homev4-main .homev4-quote').count()==7
       await h.page.get_by_role('button',name='지수 편집',exact=True).click()
       assert await h.page.locator('.homev4-editrow').count()==7
       await h.page.get_by_role('button',name='KOSDAQ ▲',exact=True).click()
       await h.page.get_by_role('button',name='KOSPI 200 선물 제외',exact=True).click()
       await h.page.get_by_role('button',name='VIX 추가',exact=True).click()
       assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
       await h.page.locator('.homev4-editor-actions').get_by_role('button',name='저장',exact=True).click()
       await h.page.wait_for_function('()=>document.querySelector(".homev4-main .homev4-quote dt")?.textContent==="KOSDAQ"')
       saved=await h.page.evaluate('JSON.parse(localStorage.getItem("myinvest_home_priorities_v1"))')
       assert saved['KR'][0]=='^KQ11' and 'k3' not in saved['KR'] and '^VIX' in saved['KR']
       assert saved['US'][0]=='^GSPC'
       await h.go('market');await h.go('home')
       assert await h.page.locator('.homev4-main dt').first.inner_text()=='KOSDAQ'
       await h.page.get_by_role('button',name='미국',exact=True).click()
       assert await h.page.locator('.homev4-main dt').first.inner_text()=='S&P 500'
       await h.page.get_by_role('button',name='자동',exact=True).click()
       assert await h.page.locator('.homev4-main dt').first.inner_text()=='KOSDAQ'
       assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
       await h.page.screenshot(path=str(OUT/(str(width)+'-home-p1.png')))
      await check('HOME_PERSONAL_PRIORITIES_SAVE_REENTRY_AND_MARKET_SWITCH',home_p1)
      assert not any(r['action'] in ['nhAccounts','order','saveExternalHoldings','restoreExternalHoldings'] for r in h.requests)
     finally:await h.close()
   finally:await b.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));return int(any(r['status']=='FAIL' for r in results))
raise SystemExit(asyncio.run(main()))
