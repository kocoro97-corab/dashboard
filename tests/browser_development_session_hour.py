"""Development-only hour timer; synthetic login and real local Worker handler."""
import argparse,asyncio,datetime,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'tools')]
from playwright.async_api import async_playwright,expect
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--output',type=Path,default=Path('/tmp/development-session-hour'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,synthetic_feeds(),width,published=args.published).start_browser(tmp);page=h.page
    try:
     await page.clock.install(time=datetime.datetime(2026,11,22,tzinfo=datetime.timezone.utc));await h.login('strategy')
     assert await page.evaluate('sessionLeftMs()>3590000')
     await page.locator('.str4-field input').first.fill('123456')
     baseline=await page.evaluate('()=>{touchActive(true);renderSession();return lastActive()}')
     await expect(page.locator('#sessionTimeTxt')).to_have_text('60:00')
     await page.clock.fast_forward(6*60000)
     await page.wait_for_function('()=>!DevelopmentSession.getStatus().checking&&DevelopmentSession.getStatus().scheduled')
     assert await page.evaluate('SESSION_MS')==3600000
     assert await page.evaluate('lastActive()')==baseline
     assert await page.locator('.str4-field input').first.input_value()=='123456'
     assert any(r['action']=='sessionInfo' for r in h.requests)
     await expect(page.locator('#appContainer')).to_be_visible()
     # No browser activity is manufactured by the successful background check.
     await page.screenshot(path=str(args.output/(str(width)+'-after-six-minutes.png')))
     await page.reload(wait_until='domcontentloaded');await page.wait_for_function('()=>DashboardShell.getStatus().page==="strategy"')
     assert await page.evaluate('lastActive()')==baseline
     # Test exact wall-clock expiry, including reload and background suspension.
     await page.evaluate('()=>{AUTH_STORAGE.setItem("invest_last_active",String(Date.now()-3600000));renderSession()}')
     await page.wait_for_function('()=>!LS("invest_session_token")&&DashboardShell.getStatus().page===null')
     assert not await page.evaluate('DevelopmentSession.getStatus().scheduled')
     assert await page.locator('[data-module=five-minute-reference-v1]').count()==0
     assert not h.errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
     print(json.dumps({'width':width,'status':'PASS','auth':'SYNTHETIC','publishedAssets':args.published,'inactivityMinutes':60,'sixMinuteSession':'PASS','noInputReset':'PASS','reload':'PASS','expiryCleanup':'PASS','actualNhCalls':0}),flush=True)
    finally:await h.close()
   await browser.close()
asyncio.run(main())
