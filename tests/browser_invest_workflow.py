"""Cross-page public workflow. Synthetic authentication, prices and holdings only."""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history,history_url,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--output',type=Path,default=Path(tempfile.gettempdir())/'myinvest-invest-workflow');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);results=[]
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);feeds=synthetic_feeds()
  for symbol,name,exchange in [('AAPL','Apple Inc.','NMS'),('MSFT','Microsoft Corporation','NMS')]:
   d=history(symbol);d['chart']['result'][0]['meta'].update(longName=name,exchangeName=exchange,instrumentType='EQUITY');feeds[history_url(symbol)]=json.dumps(d)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,690,344]:
     h=await Harness(browser,artifact,feeds,width,a.published).start_browser(tmp)
     async def check(name,fn):
      try:await fn();row={'width':width,'test':name,'status':'PASS'}
      except Exception as e:row={'width':width,'test':name,'status':'FAIL','error':str(e).splitlines()[0][:180]};await h.page.screenshot(path=str(a.output/(str(width)+'-'+name+'-FAIL.png')))
      results.append(row);print(json.dumps(row),flush=True)
     try:
      await h.page.clock.set_fixed_time('2026-11-17T00:00:00Z');await h.login('sectors');await h.page.wait_for_selector('.stv2-ranks button')
      async def kr():
       await h.page.locator('.stv2-ranks button').first.click();await h.page.wait_for_selector('.stv2-kr-members');await h.page.locator('.stv2-kr-members button').first.click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');s=await h.page.evaluate('InvestWorkflow.current()');assert s['market']=='KR' and s['source']=='theme' and s['theme'];assert s['mode']=='day';assert await h.page.get_by_role('button',name='이 종목 투자전략',exact=True).count()==2
       await h.page.get_by_role('button',name='이 종목 투자전략',exact=True).first.click();await h.page.wait_for_function('()=>document.querySelector(".workflow-conditional")?.textContent.includes("일봉만 수신")');assert await h.page.locator('#strategyStockSearch').count()==1;assert (await h.page.evaluate('InvestWorkflow.current().symbol'))==s['symbol'];assert await h.page.get_by_label('가정 진입가',exact=True).input_value()==''
       await h.page.get_by_role('button',name='스윙',exact=True).first.click();await h.page.wait_for_function('()=>document.querySelector(".workflow-conditional")?.textContent.includes("돌파 관찰")');assert float(await h.page.get_by_label('가정 진입가',exact=True).input_value())>0;assert '1R/2R' in await h.page.locator('.workflow-conditional').inner_text();await h.page.get_by_role('button',name='종목분석 보기',exact=True).click();await h.page.wait_for_selector('#stockSearch');assert await h.page.locator('#stockSearch').input_value()==s['symbol'];assert (await h.page.evaluate('InvestWorkflow.current().mode'))=='swing'
      await check('KR_THEME_ANALYSIS_STRATEGY_ROUNDTRIP_AND_DAILY_ONLY_GUARD',kr)
      async def us():
       await h.go('sectors');await h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name='미국',exact=True).click();await h.page.wait_for_selector('.stv2-us-themes button');await h.page.locator('.stv2-us-themes button').first.click();assert await h.page.locator('.stv2-us-members th').count()==14;await h.page.locator('.stv2-us-members').get_by_role('button',name='종목분석',exact=True).first.click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');s=await h.page.evaluate('InvestWorkflow.current()');assert s['market']=='US' and s['theme'];await h.page.get_by_role('button',name='이 종목 투자전략',exact=True).first.click();await h.page.wait_for_selector('.workflow-conditional h3');assert s['symbol'] in await h.page.locator('.str4-nav').inner_text();await h.page.reload();await h.page.wait_for_selector('.str4-nav');assert s['symbol']==await h.page.evaluate('InvestWorkflow.current().symbol');assert s['symbol'] in await h.page.locator('.str4-nav').inner_text()
      await check('US_THEME_ALL_PERIOD_COLUMNS_AND_RELOAD_SELECTION',us)
      async def race():
       await h.go('stocks');slow=history('AAPL');slow['chart']['result'][0]['meta'].update(longName='Apple Inc.',exchangeName='NMS',instrumentType='EQUITY');h.overrides[history_url('AAPL')]={'text':json.dumps(slow),'delayMs':600};await h.page.evaluate('MYInvestStockSelection.open("AAPL",{mode:"swing"})');await h.page.wait_for_timeout(60);await h.page.evaluate('MYInvestStockSelection.open("MSFT",{mode:"swing"})');await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")&&InvestWorkflow.current()?.symbol==="MSFT"');await h.page.wait_for_timeout(750);assert await h.page.locator('#stockSearch').input_value()=='MSFT';assert await h.page.locator('.sva h3[data-x]').count()==0;assert await h.page.locator('.sva [data-instrument-symbol="MSFT"]').count()>0;assert await h.page.locator('.sva [data-instrument-symbol="AAPL"]').count()==0
       await h.page.get_by_role('button',name='테마 종목',exact=True).click();await h.page.locator('.workflow-selector details').first.locator('summary').click();await h.page.locator('.workflow-selector details').first.locator('button').first.click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert await h.page.evaluate('InvestWorkflow.current().source')=='theme'
      await check('RAPID_SELECTION_LAST_RESPONSE_AND_SHARED_THEME_SELECTOR',race)
      async def holding():
       await h.page.evaluate('''()=>{NH_ACCOUNTS=[{accountKey:'a'.repeat(64),domestic:{holdings:[]},overseas:{holdings:[{code:'AAPL',name:'AAPL',instrumentId:'US:XNAS:AAPL',currency:'USD',quantity:2,avgPrice:123.45,currentPrice:178.9,evalAmount:500000,profit:100000}]},errors:[]}];NH_ACCOUNT_SESSION=LS('invest_session_token');NH_ACCOUNT_FETCHED_AT=Date.now();NH_ACCOUNT_UPDATED=new Date().toISOString()}''');await h.page.get_by_role('button',name='내 보유종목',exact=True).click();await h.page.locator('.workflow-selector').get_by_role('button',name='AAPL (AAPL)',exact=False).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert await h.page.evaluate('InvestWorkflow.current().source')=='holding';await h.page.get_by_role('button',name='스윙',exact=True).click();await h.page.get_by_role('button',name='이 종목 투자전략',exact=True).first.click();await h.page.wait_for_function('()=>document.querySelector(".workflow-conditional")?.textContent.includes("기존 보유종목 관리")');assert '123.45' in await h.page.locator('.str4').inner_text();raw=await h.page.evaluate('JSON.stringify([sessionStorage.getItem("myinvest_stock_selection_v2"),sessionStorage.getItem("myinvest_strategy_selection_v2")])');assert '123.45' not in raw and 'quantity' not in raw;assert await h.page.evaluate('NH_ACCOUNTS[0].overseas.holdings[0].avgPrice')==123.45
      await check('VERIFIED_HOLDING_SELECTOR_PER_ACCOUNT_COST_WITHOUT_PERSISTING_FINANCIAL_FIELDS',holding)
      async def errors():
       await h.page.evaluate('''()=>{ReadStatus.note({http:502,body:'PRIVATE_SECRET'},{key:'synthetic-public',scope:'public'});ReadStatus.note({http:401,code:'AUTH_REQUIRED',token:'PRIVATE_SECRET'},{key:'synthetic-account',scope:'account'})}''');assert '원인 미확인' in await h.page.locator('#readConnectionStatus').text_content();assert 'PRIVATE_SECRET' not in await h.page.locator('#readConnectionStatus').text_content();await h.page.evaluate('ReadStatus.clear("synthetic-public")');assert '계좌 읽기' in await h.page.locator('#readConnectionStatus').text_content();s=await h.page.evaluate('InvestWorkflow.current().symbol');await h.page.get_by_role('button',name='재연결',exact=True).click();assert await h.page.evaluate('InvestWorkflow.current().symbol')==s;await h.page.evaluate('ReadStatus.clear()');assert await h.page.locator('#readConnectionStatus').count()==0;assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await h.page.screenshot(path=str(a.output/(str(width)+'-strategy.png')))
       await h.page.evaluate('logout()');await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await h.page.locator('.workflow-selector').count()==0;assert await h.page.evaluate('InvestWorkflow.current()') is None;assert not h.errors;assert not any(r['action'] in ['order','saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'] for r in h.requests)
      await check('SAFE_ERROR_PANEL_RECONNECT_LOGOUT_AND_ZERO_WRITES',errors)
     finally:await h.close()
   finally:await browser.close()
 a.output.joinpath('results.json').write_text(json.dumps(results,indent=2));return int(any(r['status']=='FAIL' for r in results))
raise SystemExit(asyncio.run(main()))
