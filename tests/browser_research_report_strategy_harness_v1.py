"""Full existing MY INVEST V2 synthetic shell + research report review sidecar.
Uses Codex news/strategy integration baseline, no production deployment or NH.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'tests')]
from build_research_report_review_v1 import build_review
from public_integration_support import Harness,synthetic_feeds,ENDPOINT

async def main():
 with tempfile.TemporaryDirectory() as tmp:
  public=Path(tmp)/'review'
  build_review(public,relay_endpoint=ENDPOINT)
  feeds=synthetic_feeds()
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in (1440,690,344):
     harness=await Harness(browser,public,feeds,width).start_browser(tmp)
     page=harness.page
     try:
      await harness.login('strategy')
      sidecar=page.locator('[data-research-harness="synthetic-only"]')
      await sidecar.wait_for()
      assert await sidecar.count()==1
      assert not await sidecar.evaluate('(el)=>el.open')
      assert await page.locator('.irr1').count()==0
      assert await page.locator('.str4-nav').count()==1
      assert '단타·스윙' in await page.locator('.str4').inner_text()
      state=await page.evaluate('MYInvestResearchReportHarnessV1.getStatus()')
      assert state['kind']=='SYNTHETIC_REVIEW_ONLY'
      assert state['marketCalls']==0 and state['orderCalls']==0
      assert state['realAccountDataRead'] is False

      # Opening a separate opt-in report must not fetch holdings or mutate the
      # existing orderless strategy planner.
      baseline=len(harness.requests)
      await sidecar.locator('summary').click()
      await page.locator('.irr1 .stock').first.wait_for()
      assert await page.locator('.irr1 .stock').count()==2
      assert await page.locator('.irr1 .sector').count()==2
      assert await page.locator('.irr1 .history-day').count()==3
      audit=page.locator('[data-native-contract-audit] .native-contract-panel')
      await audit.wait_for()
      assert '실제 리포트 실데이터 연결: 보류' in await audit.inner_text()
      assert '미충족 확인항목' in await audit.inner_text()
      assert await audit.locator('.gate-card').count()>=7
      assert await audit.locator('[data-contract-reasons]').count()==1
      assert await page.locator('.irr1 .stock').count()==2
      assert '미국' in await page.locator('.irr1 .hero').inner_text()
      assert 'SERV' in await page.locator('.irr1').inner_text()
      assert await page.locator('.str4-nav').count()==1
      assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
      assert not any(r['action'] in ('nhAccounts','nhQuotes','nhExternalQuotes',
             'saveExternalHoldings','restoreExternalHoldings','order')
             for r in harness.requests[baseline:])

      await page.locator('.irr1 [data-filter="insufficient-evidence"]').click()
      assert await page.locator('.irr1 .stock').count()==0
      assert '선택 조건에 맞는 관측 종목' in await page.locator('.irr1').inner_text()
      await page.get_by_role('button',name='전체 2개',exact=True).click()
      assert await page.locator('.irr1 .stock').count()==2

      # Report switch is synthetic only. Original strategy symbol selection is
      # neither observed nor sent to the panel.
      await page.locator('[data-research-sample="KR"]').click()
      await page.locator('.irr1 .stock').first.wait_for()
      assert '005930' in await page.locator('.irr1').inner_text()
      assert '000660' in await page.locator('.irr1').inner_text()
      assert 'SERV' not in await page.locator('.irr1').inner_text()
      assert '한국' in await audit.inner_text()
      assert '산업 구성종목 표본' in await audit.inner_text()
      assert await page.locator('[data-research-sample="KR"]').get_attribute('aria-pressed')=='true'

      # The latest date is invalid; no previous positive classification reused.
      await page.locator('[data-research-sample="BLOCKED"]').click()
      await page.wait_for_function('()=>document.querySelectorAll(".irr1 .stock").length===0')
      assert '근거 검증 보류' in await page.locator('.irr1').inner_text()
      assert await page.locator('.irr1 .history-day').count()==0
      assert await page.locator('.irr1 .metric').count()==0
      assert '검증 보류' in await audit.inner_text()
      await page.locator('[data-research-sample="US"]').click()
      assert await page.locator('.irr1 .stock').count()==2
      assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width

      # On close and routing away all mounted report data and listeners disappear.
      await sidecar.locator('summary').click()
      await page.wait_for_function('()=>!document.querySelector(".irr1")')
      assert not await sidecar.evaluate('(el)=>el.open')
      await harness.go('news')
      assert await page.locator('[data-research-harness]').count()==0
      assert await page.locator('[data-native-contract-audit]').count()==0
      assert await page.locator('.irr1').count()==0
      assert await page.locator('.mifv1').count()>=1
      await harness.go('home')
      assert await page.locator('[data-research-harness]').count()==0
      await harness.go('strategy')
      await page.locator('[data-research-harness]').wait_for()
      assert await page.locator('[data-research-harness]').count()==1
      assert await page.locator('.irr1').count()==0

      await page.evaluate('logout()')
      await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
      assert await page.locator('.irr1').count()==0
      assert await page.locator('[data-research-harness]').count()==0
      state=await page.evaluate('MYInvestResearchReportHarnessV1.getStatus()')
      assert state['attached'] is False and state['panelMounted'] is False
      assert not harness.errors,harness.errors
      assert not any(r['action'] in ('nhAccounts','nhQuotes','nhExternalQuotes',
            'saveExternalHoldings','restoreExternalHoldings','order')
            for r in harness.requests)
      print(json.dumps({
       'width':width,'status':'PASS',
       'fullCodexStrategyPage':'PASS',
       'existingNewsPage':'PASS',
       'syntheticReportNavigation':'PASS',
       'lastDateFailClosed':'PASS',
       'logoutCleanup':'PASS',
       'responsive':'PASS',
       'realNhCalls':0,'orderCalls':0,'operationalPublishes':0
      },ensure_ascii=False),flush=True)
     finally:
      await harness.close()
   finally:
    await browser.close()

if __name__=='__main__':
 asyncio.run(main())
