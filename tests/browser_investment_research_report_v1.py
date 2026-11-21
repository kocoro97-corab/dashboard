"""MY INVEST V2 research report: offline Playwright synthetic-only preview.
No production route, NH/GAS API, accounts, credentials, storage or real orders.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
URL=(ROOT/'preview'/'investment-research-report-v1.html').resolve().as_uri()

async def run():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True)
  try:
   for width in (1440,690,344):
    context=await browser.new_context(viewport={'width':width,'height':900},
                                      timezone_id='Asia/Seoul',service_workers='block')
    page=await context.new_page()
    errors,external=[],[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:external.append(r.url) if
            r.url.startswith(('http://','https://')) else None)
    try:
     await page.goto(URL,wait_until='load')
     main=page.locator('.irr1')
     await main.wait_for()
     assert await page.locator('.hero').count()==1
     assert await page.locator('.metric').count()==4
     assert await page.locator('.sector').count()==2
     assert await page.locator('.stock').count()==2
     assert await page.locator('.history-day').count()==3
     assert '미국' in await main.inner_text()
     assert 'SERV' in await main.inner_text()
     assert 'JOBY' in await main.inner_text()
     assert '원천 미인증' in await main.inner_text()
     assert '실시간' in await main.inner_text()
     assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width

     # Filter buttons are real controls, never hidden inert decorations.
     review=page.get_by_role('button',name='근거 비교 가능',exact=True)
     await review.click()
     assert await page.locator('.stock').count()==2
     assert await review.get_attribute('aria-pressed')=='true'
     blocked=page.get_by_role('button',name='검증 보류',exact=True)
     await blocked.click()
     assert await page.locator('.stock').count()==0
     assert '선택 조건에 맞는 관측 종목' in await page.locator('[data-report-stocks]').inner_text()
     assert await blocked.get_attribute('aria-pressed')=='true'
     await page.get_by_role('button',name='전체 2개',exact=True).click()
     assert await page.locator('.stock').count()==2

     # UK/KR market toggle changes the entire synthetic report, not the broker account.
     await page.locator('[data-demo-market="KR"]').click()
     assert '한국' in await main.inner_text()
     assert '005930' in await main.inner_text()
     assert '000660' in await main.inner_text()
     assert 'SERV' not in await main.inner_text()
     assert await page.locator('.stock').count()==2
     assert await page.locator('.sector').count()==2
     assert await page.locator('.history-day').count()==3
     assert await page.locator('[data-demo-market="KR"]').get_attribute('aria-pressed')=='true'

     # Latest-day source blockage must suppress a stale positive recommendation.
     await page.locator('[data-demo-market="BLOCKED"]').click()
     assert '근거 검증 보류' in await main.inner_text()
     assert '최신 관측일의 입력 근거가 부족' in await main.inner_text()
     assert await page.locator('.stock').count()==0
     assert await page.locator('.metric').count()==0
     assert await page.locator('.history-day').count()==0
     assert await page.locator('[data-demo-market="BLOCKED"]').get_attribute('aria-pressed')=='true'
     assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width

     # Usability after unqualified data: no cached stale report.
     await page.locator('[data-demo-market="US"]').click()
     assert '미국' in await main.inner_text()
     assert 'SERV' in await main.inner_text()
     assert await page.locator('.stock').count()==2
     assert await page.locator('.history-day').count()==3
     assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width
     assert not errors,errors
     assert not external,external
     print(json.dumps({'width':width,'marketToggle':'PASS',
                       'sourceBlockedFailClosed':'PASS',
                       'filters':'PASS','timeline':'PASS',
                       'responsive':'PASS','externalRequests':0,
                       'NHCalls':0,'orderCalls':0,
                       'operationalDeployment':False}),flush=True)
    finally:
     await context.close()
  finally:
   await browser.close()

if __name__=='__main__':
 asyncio.run(run())
