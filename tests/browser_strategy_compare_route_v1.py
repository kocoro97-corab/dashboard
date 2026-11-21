"""Synthetic authenticated app-shell regression for manual risk comparison disclosure.
No real NH, GAS, storage writes, market API calls, orders or production publish.
"""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT

p=argparse.ArgumentParser()
p.add_argument('--widths',nargs='+',type=int,default=[1440,690,344])
args=p.parse_args()

async def exercise():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public'
  build(artifact,relay_endpoint=ENDPOINT)
  feeds=synthetic_feeds()
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in args.widths:
     harness=await Harness(browser,artifact,feeds,width).start_browser(tmp)
     page=harness.page
     try:
      await harness.login('strategy')
      disclosure=page.locator('.str4-compare-disclosure')
      await disclosure.wait_for()
      assert await disclosure.count()==1
      assert await page.locator('.msc1').count()==0
      assert not await disclosure.evaluate('(el)=>el.open')
      assert await page.locator('.str4-output').count()>=2
      before_requests=len(harness.requests)
      before_store=await page.evaluate("""() => ({
       local:JSON.stringify({...localStorage}),
       session:JSON.stringify({...sessionStorage})
      })""")
      await disclosure.locator('summary').click()
      await page.locator('.msc1').wait_for()
      assert '단타·스윙 가상 시나리오 비교' in await page.locator('.msc1').inner_text()
      assert await page.locator('[data-result="day"]').count()==1
      assert await page.locator('[data-result="swing"]').count()==1
      assert await page.get_by_label('day · 진입가',exact=True).input_value()==''
      assert await page.get_by_label('공통 · 가상 총자본',exact=True).input_value()==''
      assert '공개 일봉 연결을 먼저 확인' in await page.locator('[data-result="day"]').inner_text()
      assert 'ENGINE_UNAVAILABLE' not in await page.locator('.msc1').inner_text()
      assert '입력값을 확인' in await page.locator('[data-result="comparison"]').inner_text()
      assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),width
      # Standalone tool does not use API, account snapshot or app storage.
      assert len(harness.requests)==before_requests
      assert await page.evaluate("""() => ({
       local:JSON.stringify({...localStorage}),
       session:JSON.stringify({...sessionStorage})
      })""")==before_store
      await page.get_by_label('day · 손절가').fill('50000')
      await page.get_by_role('button',name='가상 수량·손익 비교').click()
      assert '입력 확인' in await page.locator('[data-result="day"]').inner_text()
      assert '입력 확인' in await page.locator('[data-result="swing"]').inner_text()
      await disclosure.locator('summary').click()
      await page.wait_for_function('()=>document.querySelector(".msc1")===null')
      assert not await disclosure.evaluate('(el)=>el.open')
      await disclosure.locator('summary').click()
      await page.locator('.msc1').wait_for()
      assert await page.get_by_label('day · 손절가').input_value()==''
      await harness.go('home')
      assert await page.locator('.str4-compare-disclosure').count()==0
      await harness.go('strategy')
      await page.locator('.str4-compare-disclosure').wait_for()
      assert await page.locator('.msc1').count()==0
      assert await page.locator('#strategyStockSearch').count()==1
      assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),width
      assert not harness.errors,harness.errors
      print(json.dumps({
       'width':width,'status':'PASS',
       'scenarioDisclosure':'PASS','existingStrategy':'PASS',
       'invalidInputIsolation':'PASS','routeCleanup':'PASS',
       'manualResetOnReopen':'PASS','noAdditionalRelayRequests':True,
       'noAccountTransfer':True,'noOrderCalls':True,
       'realNHCalls':0,'operationalPublishes':0
      },ensure_ascii=False),flush=True)
     finally:
      await harness.close()
   finally:
    await browser.close()

if __name__=='__main__':
 asyncio.run(exercise())
