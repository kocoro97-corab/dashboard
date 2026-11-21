"""Strategy data connection; synthetic auth. Optional captured public API replay."""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'tools')]
from playwright.async_api import async_playwright
import public_integration_support as support
from public_integration_support import Harness,synthetic_feeds,history_url,history,ENDPOINT
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--actual-dir',type=Path);p.add_argument('--published',action='store_true');p.add_argument('--output',type=Path,default=Path('/tmp/strategy-market-link'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
async def main():
 rows=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'site';build(artifact,relay_endpoint=ENDPOINT)
  support.LAST=1794787200 # Nov 16 UTC; within fixed test clock's four-day window.
  feeds=synthetic_feeds()
  if a.actual_dir:
   feeds[history_url('005930.KS')]=(a.actual_dir/'kr.json').read_text();feeds[history_url('AAPL')]=(a.actual_dir/'us.json').read_text()
  else:
   payload=history('AAPL');payload['chart']['result'][0]['meta'].update(exchangeName='NMS',instrumentType='EQUITY');feeds[history_url('AAPL')]=json.dumps(payload)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,feeds,width,published=a.published).start_browser(tmp);page=h.page
    try:
     if not a.actual_dir:await page.clock.set_fixed_time('2026-11-17T03:00:00Z')
     await h.login('strategy');await page.locator('.str4-compare-disclosure > summary').click();await page.locator('.msc1').wait_for()
     assert await page.get_by_label('day · 진입가',exact=True).input_value()==''
     assert await page.get_by_label('공통 · 가상 총자본',exact=True).input_value()==''
     async def choose(symbol):
      await page.locator('#strategyStockSearch').fill(symbol)
      await page.locator('.workflow-selector form').get_by_role('button',name='종목 분석',exact=True).click()
      await page.wait_for_function('(symbol)=>document.querySelector("[data-market-link=ready]")?.textContent.includes("("+symbol+")")',arg=symbol)
     for symbol in ['005930','AAPL']:
      await choose(symbol)
      data=await page.evaluate('()=>InvestWorkflow.ensure(InvestWorkflow.current())')
      link=await page.locator('[data-market-link=ready]').inner_text();assert data['source'] in link and '실시간 현재가 아님' in link and '봉 기준' in link
      assert float(await page.get_by_label('day · 진입가',exact=True).input_value())==data['metrics']['last']
      assert await page.get_by_label('day · 손절가',exact=True).input_value()==''
      assert await page.get_by_label('day · 목표가',exact=True).input_value()==''
      assert await page.get_by_label('공통 · 가상 총자본',exact=True).input_value()==''
      assert await page.get_by_label('시장 · 통화',exact=True).input_value()==('KR' if symbol=='005930' else 'US')
      assert await page.get_by_label('시장 · 통화',exact=True).is_disabled()
      cases=await page.evaluate('async()=>InvestWorkflow.scenarios(await InvestWorkflow.ensure(InvestWorkflow.current()),{...InvestWorkflow.current(),mode:"swing"})')
      if cases:assert float(await page.get_by_label('swing · 진입가',exact=True).input_value())==cases[0]['entry']
      for label,value in [('가상 총자본','10000000'),('가용 현금','5000000'),('이미 배분된 금액','0'),('기존 미청산 위험','0')]:await page.get_by_label('공통 · '+label,exact=True).fill(value)
      count=len(h.requests);await page.get_by_role('button',name='가상 수량·손익 비교',exact=True).click();assert len(h.requests)==count
      assert '가상 수량' in await page.locator('[data-result=swing]').inner_text()
      await page.get_by_label('swing · 진입가',exact=True).fill('999')
      await page.get_by_role('button',name='수신 일봉 조건 다시 적용',exact=True).click()
      if cases:assert float(await page.get_by_label('swing · 진입가',exact=True).input_value())==cases[0]['entry']
     if not a.actual_dir:
      # Out-of-order public analyses cannot replace the newer selected symbol.
      slow=history('MSFT');slow['chart']['result'][0]['meta'].update(exchangeName='NMS',instrumentType='EQUITY')
      h.overrides[history_url('MSFT')]={'text':json.dumps(slow),'delayMs':700}
      await page.locator('#strategyStockSearch').fill('MSFT');await page.locator('.workflow-selector form button').click();await page.wait_for_timeout(80)
      await choose('005930');await page.wait_for_timeout(800)
      assert '(005930)' in await page.locator('[data-market-link=ready]').inner_text()
      # A bad fresh response clears the link and old prices, never fallback data.
      bad=history('005930.KS');bad['chart']['result'][0]['meta']['currency']='USD';h.overrides[history_url('005930.KS')]={'text':json.dumps(bad)}
      await page.evaluate('DashboardShell.refresh(true)');await page.wait_for_selector('[data-market-link=error]')
      assert await page.get_by_label('day · 진입가',exact=True).input_value()==''
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await page.screenshot(path=str(a.output/(str(width)+'-linked.png')))
     await h.go('news');assert await page.locator('.msc1').count()==0
     await h.go('strategy');await page.locator('.str4-compare-disclosure > summary').click();await page.locator('.msc1').wait_for()
     assert await page.get_by_label('공통 · 가상 총자본',exact=True).input_value()==''
     await page.evaluate('logout()');await page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await page.locator('.msc1').count()==0
     assert not h.errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','nhExternalQuotes','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
     row={'width':width,'status':'PASS','prices':'ACTUAL_PUBLIC_CAPTURE_REPLAY' if a.actual_dir else 'SYNTHETIC','auth':'SYNTHETIC','publishedAssets':a.published,'identityCurrencyTimes':True,'currencyChangeClearsBudgets':True,'daySignalGenerated':False,'actualNhCalls':0};rows.append(row);print(json.dumps(row),flush=True)
    finally:await h.close()
   await browser.close()
 (a.output/'results.json').write_text(json.dumps(rows,indent=2))
asyncio.run(main())
