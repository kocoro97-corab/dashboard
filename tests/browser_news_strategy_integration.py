"""News + strategy integration. Synthetic authentication/data; no real services."""
import argparse,asyncio,json,sys,tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
import public_integration_support as support
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('/tmp/news-strategy-integration'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)

async def main():
 results=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  now=int(datetime.fromisoformat('2026-11-17T03:00:00+00:00').timestamp()*1000)
  record={'schemaVersion':1,'date':'2026-11-17','origin':'dashboard-pipeline',
   'title':'합성 뉴스·전략 통합 보고서','visibility':'public-market-only','timeZone':'Asia/Seoul',
   'scheduleLocal':'07:00','generatedAt':now-1000,'observedAt':now-60000,'retrievedAt':now-2000,
   'rawText':None,'sections':[{'kind':'us-market','heading':'합성 미국장','body':'합성 테스트 자료','sourceIds':[]}],'sources':[]}
  (artifact/'data/myinvest-public-briefings-v1.json').write_text(json.dumps({'type':'public-briefing-feed-v1','schemaVersion':1,'records':[record]}))
  support.LAST=int(datetime.fromisoformat('2026-11-16T00:00:00+00:00').timestamp())
  feeds=synthetic_feeds()
  for q in ['코스피 OR 증시 OR 나스닥 when:2d','(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d']:
   feeds['https://news.google.com/rss/search?q='+quote(q,safe="~()*!.'")+'&hl=ko&gl=KR&ceid=KR:ko']='<rss><channel><item><title>삼성전자 합성 기사</title><link>https://example.com/public</link><source>합성 언론</source><pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>'
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,feeds,width).start_browser(tmp);page=h.page
    try:
     await page.clock.set_fixed_time('2026-11-17T03:00:00Z');await h.login('news')
     await page.locator('.mifv1 h4').first.wait_for();assert record['title'] in await page.locator('.mifv1').inner_text()
     archive=json.dumps({'type':'myinvest-public-briefing-backup-v1','schemaVersion':1,'exportedAt':now,'records':[record]})
     imported=await page.evaluate('(text)=>MYInvestBriefingPanelV1.importBackup(text,localStorage)',archive);assert imported['ok']
     before=await page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')
     await page.get_by_role('button',name='삼성전자 (005930) 분석',exact=True).first.click()
     await page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")')
     assert await page.locator('#stockSearch').input_value()=='005930'
     assert await page.evaluate('InvestWorkflow.current().source')=='news'
     await page.get_by_role('button',name='이 종목 투자전략',exact=True).first.click()
     await page.wait_for_selector('.workflow-conditional h3')
     assert await page.evaluate('InvestWorkflow.current().symbol')=='005930'
     assert '005930' in await page.locator('.str4-nav').inner_text()
     await page.get_by_role('button',name='종목분석 보기',exact=True).click();await page.wait_for_selector('#stockSearch')
     assert await page.locator('#stockSearch').input_value()=='005930'
     await h.go('strategy');await page.wait_for_selector('.workflow-conditional h3')
     # The comparison panel must not receive the app's account or selection context.
     count=len(h.requests);disclosure=page.locator('.str4-compare-disclosure')
     assert await page.locator('.msc1').count()==0;await disclosure.locator('summary').click();await page.locator('.msc1').wait_for()
     title=page.locator('.msc1 header h1');heading=page.locator('.msc1 header')
     await heading.screenshot(path=str(a.output/(str(width)+'-comparison-heading.png')))
     box=await heading.bounding_box();text_box=await title.bounding_box()
     assert text_box['width']>=box['width']*.8,{'headingWidth':box['width'],'titleWidth':text_box['width']}
     assert await page.locator('[data-market-link=ready]').count()==1
     for label,value in [('가상 총자본','10000000'),('가용 현금','5000000'),('이미 배분된 금액','0'),('기존 미청산 위험','0')]:await page.get_by_label('공통 · '+label,exact=True).fill(value)
     await page.get_by_label('day · 손절가',exact=True).fill('190');await page.get_by_label('day · 목표가',exact=True).fill('230')
     for bad in ['0','-10','']:
      await page.get_by_label('day · 진입가',exact=True).fill(bad)
      await page.get_by_role('button',name='가상 수량·손익 비교',exact=True).click()
      assert '입력 확인' in await page.locator('[data-result=day]').inner_text()
      assert '가상 수량' in await page.locator('[data-result=swing]').inner_text()
     await page.get_by_role('button',name='입력 초기화',exact=True).click()
     await page.get_by_label('공통 · 거래단위',exact=True).fill('1.5')
     await page.get_by_role('button',name='가상 수량·손익 비교',exact=True).click()
     assert '입력 확인' in await page.locator('[data-result=day]').inner_text()
     await page.get_by_role('button',name='입력 초기화',exact=True).click()
     # Explicit market/currency mismatch is rejected by the loaded browser model.
     rejected=await page.evaluate('''()=>MYInvestStrategyRiskCapacityV1.evaluate({mode:'day',market:'US',currency:'KRW',now:Date.now()})''')
     assert rejected['code']=='INVALID_MODE_MARKET_CURRENCY' and rejected['canPlaceOrder'] is False
     assert await page.get_by_label('시장 · 통화',exact=True).is_disabled()
     assert len(h.requests)==count
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(a.output/(str(width)+'-strategy.png')))
     await disclosure.locator('summary').click();await page.wait_for_function('()=>!document.querySelector(".msc1")')
     for area in ['home','market','sectors','stocks','strategy','news']:
      await h.go(area);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.locator('.mifv1 h4').first.wait_for();assert record['title'] in await page.locator('.mifv1').inner_text()
     assert await page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')==before
     assert await page.locator('.msc1').count()==0
     await page.screenshot(path=str(a.output/(str(width)+'-news.png')))
     await page.evaluate('logout()');await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
     assert await page.locator('.msc1,.mifv1,.str4').count()==0
     assert await page.evaluate('InvestWorkflow.current()') is None
     assert await page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')==before
     await h.login('news');await page.locator('.mifv1 h4').first.wait_for();await h.go('strategy')
     assert await page.locator('.msc1').count()==0
     await page.locator('.str4-compare-disclosure > summary').click();await page.locator('.msc1').wait_for()
     assert await page.get_by_label('day · 진입가',exact=True).input_value()==''
     assert await page.get_by_label('시장 · 통화',exact=True).input_value()=='KR'
     assert not h.errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','nhExternalQuotes','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
     row={'width':width,'status':'PASS','newsStockStrategyRoundTrip':True,'sixMenus':True,'invalidPriceLotCurrency':True,'localArchivePreserved':True,'logoutReloginCleanup':True,'realAuthentication':False,'actualNhCalls':0,'orderCalls':0};results.append(row);print(json.dumps(row),flush=True)
    finally:await h.close()
   await browser.close()
 (a.output/'results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
