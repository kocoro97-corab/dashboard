"""Synthetic public briefing import/history/rendering. Zero real account/AI calls."""
import asyncio,sys,tempfile,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from playwright.async_api import async_playwright
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,344,690]:
     h=await Harness(browser,artifact,synthetic_feeds(),width).start_browser(tmp)
     try:
      await h.login('news');assert await h.page.locator('.mipr1').count()==1;assert '미활성화' in await h.page.locator('.mipr1').inner_text();await h.page.get_by_role('button',name='오늘의 AI 뉴스·투자전략 원문 보기',exact=True).click();assert not any(r['action']=='privateMorningBriefing' for r in h.requests);await h.page.locator('.nev5-management > summary').click();await h.page.locator('.nev5-brief-editor>summary').click();assert await h.page.locator('.nev5-brief').count()==1;assert '자동 전달 미연결' in await h.page.locator('.nev5-brief').inner_text();await h.page.locator('.nev5-brief-editor input[type=date]').fill('2026-11-18');await h.page.locator('.nev5-brief-editor textarea').fill('합성 공개 브리핑 <script>window.BAD=true</script>');await h.page.get_by_role('button',name='보고서 저장',exact=True).click();assert '합성 공개 브리핑' in await h.page.locator('.nev5-brief-scroll').inner_text();assert await h.page.evaluate('window.BAD===undefined');await h.page.locator('.nev5-brief-editor>summary').click();await h.page.locator('.nev5-brief-editor input[type=date]').fill('2026-11-17');await h.page.locator('.nev5-brief-editor textarea').fill('합성 이전 보고서');await h.page.get_by_role('button',name='보고서 저장',exact=True).click();assert await h.page.get_by_label('브리핑 날짜 선택').locator('option').count()==2;await h.page.get_by_label('브리핑 날짜 선택').select_option('2026-11-18');assert '합성 공개 브리핑' in await h.page.locator('.nev5-brief-scroll').inner_text()
      await h.page.evaluate('''()=>{NH_ACCOUNTS=[{accountKey:'a'.repeat(64),domestic:{holdings:[{code:'035720',name:'합성 1',currency:'KRW',quantity:2,avgPrice:100,currentPrice:110,evalAmount:220,profit:20},{code:'005930',name:'합성 2',currency:'KRW',quantity:3,avgPrice:100,currentPrice:110,evalAmount:330,profit:30}]},overseas:{holdings:[]},errors:[]}];NH_ACCOUNT_SESSION=LS('invest_session_token');NH_ACCOUNT_FETCHED_AT=Date.now()}''');await h.page.evaluate('DashboardShell.refresh()');assert await h.page.locator('.nev5-brief').count()==1;await h.go('market');await h.go('news');await h.page.locator('.nev5-management > summary').click();assert await h.page.locator('.nev5-brief').count()==1;assert await h.page.get_by_label('브리핑 날짜 선택').locator('option').count()==2;assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await h.page.screenshot(path=str(Path(tempfile.gettempdir())/(str(width)+'-briefing-integrated.png')));await h.page.get_by_role('button',name='선택 보고서 삭제',exact=True).click();assert await h.page.get_by_label('브리핑 날짜 선택').locator('option').count()==1;assert not h.errors;assert not any(r['action'] in ['saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests);print(json.dumps({'width':width,'publicLocalBriefing':'PASS','singlePanelWithMultipleHoldings':'PASS','literalRendering':'PASS','dateHistory':'PASS','actualAI':False,'actualNH':False,'realStorageWrites':0}))
     finally:await h.close()
   finally:await browser.close()
asyncio.run(main())
