"""AAPL five-minute development reference: synthetic auth/prices, real Worker handler."""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'tools')]
from playwright.async_api import async_playwright,expect
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
from build_dev_pages import build
URL='https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m&range=1d'
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--actual',type=Path);p.add_argument('--output',type=Path,default=Path('/tmp/five-minute-browser'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
def fixture():
 start=1795185000 # 2026-11-20 14:30 UTC
 return {'chart':{'error':None,'result':[{'meta':{'symbol':'AAPL','currency':'USD','exchangeName':'NMS','exchangeTimezoneName':'America/New_York','instrumentType':'EQUITY','dataGranularity':'5m','currentTradingPeriod':{'regular':{'start':start,'end':start+900}}},'timestamp':[start,start+300,start+600,start+900],'indicators':{'quote':[{'open':[10,11,12,13],'high':[12,13,14,13],'low':[9,10,11,13],'close':[11,12,13,13],'volume':[100,200,300,0]}]}}]}}
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'site';build(artifact,relay_endpoint=ENDPOINT);feeds=synthetic_feeds();payload=json.loads(args.actual.read_text()) if args.actual else fixture();feeds[URL]=json.dumps(payload)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,feeds,width,published=args.published).start_browser(tmp);page=h.page
    try:
     await page.clock.set_fixed_time('2026-11-22T01:00:00Z');await h.login('strategy')
     panel=page.locator('[data-module=five-minute-reference-v1]');await expect(panel).to_have_count(1)
     reads=lambda:sum(r.get('url')==URL for r in h.requests)
     assert reads()==0
     await panel.locator('summary').click();assert reads()==0
     await panel.get_by_role('button',name='AAPL 5분봉 조회',exact=True).click()
     await expect(panel.locator('[data-five-minute-result=ready]')).to_be_visible()
     assert reads()==1;await expect(panel).to_contain_text('Yahoo Finance');await expect(panel).to_contain_text('원천 수집시각 미확인');await expect(panel).to_contain_text('단타 신호 및 계산기 입력값으로 사용하지 않습니다')
     assert await panel.locator('svg polyline').get_attribute('points')
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(args.output/(str(width)+'-reference.png')))
     await panel.get_by_role('button',name='닫기',exact=True).click();await expect(panel.locator('svg')).to_have_count(0)
     if not args.actual:
      await panel.locator('summary').click()
      bad=fixture();bad['chart']['result'][0]['meta']['currency']='KRW';h.overrides[URL]={'text':json.dumps(bad)}
      await panel.get_by_role('button',name='AAPL 5분봉 조회',exact=True).click();await expect(panel.locator('[data-five-minute-result]')).to_have_attribute('data-five-minute-result','error');assert await panel.locator('svg').count()==0
      # A missing server capability cannot cause a public read.
      await page.evaluate('''()=>{window.__fiveTransport=DashboardTransport;window.DashboardTransport=Object.freeze({...DashboardTransport,post:async body=>body.action==='appVersion'?new Response(JSON.stringify({success:true,freshTestEnvironment:true,testEnvironment:'nh-staging',developmentPublicMarket:true}),{status:200}):__fiveTransport.post(body)})}''')
      # Panel captures its transport at mount; remount to exercise the old server contract.
      await h.go('news');await h.go('strategy')
      panel=page.locator('[data-module=five-minute-reference-v1]');await panel.locator('summary').click()
      n=reads();await panel.get_by_role('button',name='AAPL 5분봉 조회',exact=True).click()
      await expect(panel).to_contain_text('개발 중계의 AAPL 5분봉 연결이 아직 활성화되지 않았습니다.');assert reads()==n
      await page.evaluate('()=>{window.DashboardTransport=window.__fiveTransport;delete window.__fiveTransport}')
      await h.go('news');await h.go('strategy');panel=page.locator('[data-module=five-minute-reference-v1]');await panel.locator('summary').click()
      h.overrides[URL]={'text':json.dumps(fixture()),'delayMs':700};n=reads();await panel.get_by_role('button',name='AAPL 5분봉 조회',exact=True).click();await expect(panel).to_contain_text('AAPL 5분봉 수신 중')
      await h.go('news');await expect(page.locator('[data-module=five-minute-reference-v1]')).to_have_count(0)
      await h.go('strategy');panel=page.locator('[data-module=five-minute-reference-v1]');await panel.locator('summary').click();await expect(panel.locator('svg')).to_have_count(0)
      await page.wait_for_timeout(800) # Allow the deliberately late old response to settle.
      await expect(panel.locator('svg')).to_have_count(0)
      await panel.get_by_role('button',name='AAPL 5분봉 조회',exact=True).click();await expect(panel).to_contain_text('AAPL 5분봉 수신 중')
     await page.evaluate('logout()');await page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await page.locator('[data-module=five-minute-reference-v1]').count()==0
     assert not h.errors,h.errors;assert not any(r['action'] in ['nhAccounts','nhQuotes','nhExternalQuotes','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
     print(json.dumps({'width':width,'status':'PASS','auth':'SYNTHETIC','prices':'ACTUAL_CAPTURE_REPLAY' if args.actual else 'SYNTHETIC','publishedAssets':args.published,'actualNhCalls':0}),flush=True)
    finally:await h.close()
   await browser.close()
asyncio.run(main())
