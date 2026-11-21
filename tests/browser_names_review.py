"""Name search/display integration; no real accounts or financial writes."""
import asyncio,json,sys,tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history,history_url,ENDPOINT
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);feeds=synthetic_feeds()
  for sym in ['AAPL','MSFT','GOOG','GOOGL','SPY']:
   d=history(sym);d['chart']['result'][0]['meta'].update(longName={'AAPL':'Apple Inc.','MSFT':'Microsoft Corporation','GOOG':'Alphabet Inc.','GOOGL':'Alphabet Inc.','SPY':'SPDR S&P 500 ETF Trust'}[sym],instrumentType='ETF' if sym=='SPY' else 'EQUITY',exchangeName='PCX' if sym=='SPY' else 'NMS');feeds[history_url(sym)]=json.dumps(d)
  async with async_playwright() as pw:
   b=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,344]:
     h=await Harness(b,artifact,feeds,width).start_browser(tmp)
     try:
      await h.login('stocks');await h.page.wait_for_function('()=>InstrumentNames.lookup("AAPL")?.nameKo==="애플"')
      await h.page.locator('#stockSearch').fill('애플');await h.page.get_by_role('button',name='종목 분석',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert await h.page.locator('#stockSearch').input_value()=='AAPL';assert '애플' in await h.page.locator('.sva h3').filter(has=h.page.locator('[data-instrument-symbol="AAPL"]')).inner_text();assert 'Apple Inc.' in await h.page.locator('.sva').inner_text()
      await h.page.locator('#stockSearch').fill('Alphabet');await h.page.get_by_role('button',name='종목 분석',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("겹칩니다")');assert '겹칩니다' in await h.page.locator('.sva').inner_text();buttons=h.page.locator('.dense-search-results button');assert await buttons.count()>=2
      chosen=h.page.locator('.dense-search-results button').filter(has=h.page.locator('[data-instrument-symbol="GOOGL"]'));await chosen.click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert await h.page.locator('#stockSearch').input_value()=='GOOGL'
      await h.page.locator('#stockSearch').fill('SPY');await h.page.get_by_role('button',name='종목 분석',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")');assert 'ETF' in await h.page.locator('.sva h3').filter(has=h.page.locator('[data-instrument-symbol="SPY"]')).inner_text()
      await h.page.locator('#stockSearch').fill('ZZZZZ');await h.page.get_by_role('button',name='종목 분석',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 불가")');assert await h.page.evaluate('InstrumentNames.label("ZZZZZ")')=='ZZZZZ'
      await h.go('accounts');await h.page.wait_for_timeout(100);await h.page.evaluate('''()=>{NH_ACCOUNTS=[{accountKey:'a'.repeat(64),domestic:{holdings:[]},overseas:{holdings:[{code:'AAPL',name:'AAPL',instrumentId:'US:XNAS:AAPL',currency:'USD',quantity:2,avgPrice:123.45,currentPrice:178.9,evalAmount:500000,profit:100000}]},errors:[]}];NH_ACCOUNT_UPDATED=new Date().toISOString()}''');await h.page.evaluate('DashboardShell.navigate("/accounts/holdings")');await h.page.wait_for_selector('[data-instrument-symbol="AAPL"]');assert '애플' in await h.page.locator('[data-instrument-symbol="AAPL"]').first.inner_text();assert await h.page.evaluate('NH_ACCOUNTS[0].overseas.holdings[0].avgPrice')==123.45;assert await h.page.evaluate('NH_ACCOUNTS[0].overseas.holdings[0].instrumentId')=='US:XNAS:AAPL';assert not h.errors
      print(json.dumps({'width':width,'status':'PASS','koreanAndEnglishSearch':'PASS','ambiguousListingSelection':'PASS','etfName':'PASS','unknownTickerFallback':'PASS','accountIdentityAndCostPreserved':'PASS','scope':'SYNTHETIC_PRICES_AND_AUTH_PUBLIC_NAME_DIRECTORY'}))
     finally:await h.close()
   finally:await b.close()
asyncio.run(main())
