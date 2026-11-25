"""Calendar/public snapshot replay through real local Worker, synthetic authentication.
No live user login, Google credentials, NH calls, account storage or orders.
"""
import argparse,asyncio,datetime,hashlib,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'tests')]
from playwright.async_api import async_playwright,expect
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
from build_dev_pages import build
parser=argparse.ArgumentParser();parser.add_argument('--published',action='store_true');parser.add_argument('--output',type=Path,default=Path('/tmp/calendar-final'));args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  snapshots=[json.loads((ROOT/'data'/f).read_text()) for f in ['economic-events.json','bea-events.json','bok-stats-events.json','earnings-events.json','policy-events.json']]
  checktime=max(datetime.datetime.fromisoformat(d['retrievedAt'].replace('Z','+00:00')) for d in snapshots)+datetime.timedelta(minutes=1)
  if args.published:checktime=datetime.datetime.now(datetime.timezone.utc)
  else:
   # Replay original captured bytes at capture time, even after their live TTL expires.
   # This temporary synthetic fixture is never published or re-dated.
   manifest=json.loads((artifact/'asset-manifest.json').read_text())
   for name in ['economic-events.json','bea-events.json','bok-stats-events.json','earnings-events.json','policy-events.json']:
    raw=(ROOT/'data'/name).read_bytes();(artifact/'data'/name).write_bytes(raw);manifest['data/'+name]=hashlib.sha256(raw).hexdigest()
   (artifact/'asset-manifest.json').write_text(json.dumps(manifest))

  async with async_playwright() as p:
   browser=await p.chromium.launch()
   direct=await Harness(browser,artifact,synthetic_feeds(),1440,published=args.published).start_browser(tmp)
   try:
    await direct.page.clock.install(time=checktime);await direct.login('strategy')
    await direct.page.wait_for_function("()=>MYInvestOfficialPolicyCalendar.current().status==='ready'")
    assert await direct.page.evaluate('MYInvestBokPolicySchedule.list(2026).length===8&&MYInvestFomcSchedule.list(2027).length===8')
    assert not direct.errors
    print(json.dumps({'width':1440,'status':'PASS','case':'DIRECT_STRATEGY_POLICY_FIRST_LOAD','authentication':'SYNTHETIC','publishedAssets':args.published,'actualNhCalls':0}),flush=True)
   finally:await direct.close()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,synthetic_feeds(),width,published=args.published).start_browser(tmp);page=h.page;reads=[]
    page.on('request',lambda r:reads.append(r.url.split('?')[0]) if '/data/' in r.url else None)
    try:
     await page.clock.install(time=checktime);await h.login('market')
     assert not any(any(n in r for n in ['economic-events','bea-events','bok-stats-events','earnings-events']) for r in reads)
     await page.get_by_role('button',name='투자 캘린더',exact=True).click()
     dialog=page.get_by_role('dialog',name='투자 일정 캘린더');await dialog.wait_for()
     await page.wait_for_function("()=>MYInvestEconomicCalendar.current().status==='ready'&&MYInvestBeaCalendar.current().status==='ready'&&MYInvestBokStatsCalendar.current().status==='ready'&&MYInvestEarningsCalendar.current().status==='ready'&&MYInvestOfficialPolicyCalendar.current().status==='ready'")
     count=await page.evaluate('MYInvestEconomicCalendar.current().events.length');await expect(dialog).to_contain_text('BLS '+str(count)+'건')
     assert await dialog.locator('a[href="https://www.bls.gov/schedule/news_release/bls.ics"]').count()>=1
     assert await dialog.locator('.nev5-day').count()>=28
     assert await dialog.evaluate('e=>e.querySelector(".nev5-modal").scrollWidth<=e.querySelector(".nev5-modal").clientWidth+1')
     await dialog.get_by_role('button',name='닫기',exact=True).focus();await page.keyboard.press('Shift+Tab');assert await dialog.evaluate('e=>e.contains(document.activeElement)')
     before=len(reads);await page.keyboard.press('Escape');assert await dialog.count()==0
     await page.get_by_role('button',name='투자 캘린더',exact=True).click();await dialog.wait_for();await page.wait_for_timeout(80);assert len(reads)==before
     await dialog.get_by_role('button',name='공식 일정 확인',exact=True).click();await page.wait_for_timeout(200);assert len(reads)==before+4
     await dialog.get_by_label('Google 캘린더 ICS 파일 선택').set_input_files({'name':'synthetic-private.ics','mimeType':'text/calendar','buffer':b'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:private-canary\nDTSTART;VALUE=DATE:20261123\nSUMMARY:PRIVATE_CALENDAR_CANARY\nEND:VEVENT\nEND:VCALENDAR'})
     await page.wait_for_function('()=>MYInvestIcsCalendar.list().length===1')
     assert not await page.evaluate("MYInvestEventContext.collect().events.some(e=>e.title.includes('PRIVATE_CALENDAR_CANARY'))")
     await page.screenshot(path=str(args.output/(str(width)+'-calendar.png')))
     await page.keyboard.press('Escape');await h.go('sectors');await h.go('strategy');await expect(page.get_by_label('공식 경제지표 발표 일정 위험 점검')).to_be_visible()
     assert await page.locator('[data-module="strategy-scenario-compare-v1"]').count()==1
     await h.go('news');await expect(page.locator('[data-news-block="briefing"]')).to_be_visible();await expect(page.locator('.nev5')).to_contain_text('공용 메모')
     await page.evaluate('logout()');await page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await page.get_by_role('dialog').count()==0
     assert await page.evaluate('MYInvestIcsCalendar.list().length===0&&!MYInvestGoogleCalendarSync.status().connected&&!MYInvestGoogleCalendarAuth.state().available')
     assert not h.errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','saveExternalHoldings','restoreExternalHoldings','order'] or str(r['action']).startswith('googleCalendar') for r in h.requests)
     print(json.dumps({'width':width,'status':'PASS','authentication':'SYNTHETIC','scheduleData':'OFFICIAL_PUBLIC_CAPTURE_REPLAY','publishedAssets':args.published,'cacheReuse':True,'forceRefreshRequests':4,'privateCalendarExcluded':True,'logoutCleanup':True,'consoleErrors':0,'actualNhCalls':0,'googleAccountCalls':0}),flush=True)
    finally:await h.close()
   await browser.close()
asyncio.run(main())
