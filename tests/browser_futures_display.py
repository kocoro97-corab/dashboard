"""Futures UI integration through real Worker with synthetic auth and dated quotes.
No owner credentials, actual NH calls, account queries, writes or orders.
"""
import argparse,asyncio,json,os,sys,tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--output',type=Path,default=Path('/tmp/myinvest-futures-display'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  def quote(price,at):return {'p':price,'prev':1200,'code':'A066C000','name':'코스닥150 선물','expiry':'20261210','contractVerified':True,'observedAt':at,'t':'14:50:44'}
  observed=1794981044000
  fixture=Path(tmp)/'future.json';fixture.write_text(json.dumps([{'data':{'k4':quote(1234.5,observed)}},{'data':{'k4':quote(1240,observed+60000)}},{'errors':{'k4':'NH_OBSERVATION'}},{'data':{'k4':quote(1250,observed+90000)},'delayMs':500}]))
  os.environ['MYINVEST_TEST_FUTURE_FIXTURE']=str(fixture)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,690,344]:
     h=await Harness(browser,artifact,synthetic_feeds(),width,published=args.published).start_browser(tmp)
     try:
      await h.page.clock.set_fixed_time('2026-11-18T05:53:00Z');await h.login('market')
      card=h.page.locator('.miv-indicator').filter(has=h.page.get_by_text('KOSDAQ 150 선물',exact=True));await h.page.wait_for_function('()=>Q.k4?.p===1234.5');assert '1,234.5' in await card.inner_text();assert '+2.88%' in await card.inner_text();await card.click();dialog=h.page.get_by_role('dialog',name='KOSDAQ 150 선물 · 확대 차트',exact=True);await dialog.wait_for();text=await dialog.inner_text();assert 'A066C000' in text and '20261210' in text;assert '14:50:44' in text and 'KST' in text,text;assert '장 상태·지연 여부 미확인' in text;assert 'OHLCV 차트 미연결' in text;assert await dialog.locator('canvas,iframe').count()==0
      before=len([r for r in h.requests if r['action']=='nhQuotes']);await dialog.get_by_role('button',name='코스닥150 선물 조회',exact=True).click();await h.page.wait_for_function('()=>Q.k4?.p===1240');await h.page.wait_for_function('()=>!document.querySelector(".miv-dialog button:nth-of-type(2)")?.disabled');text=await dialog.inner_text();assert '1,234.5' not in text,text;assert '1,240' in text and '14:51:44' in text;assert len([r for r in h.requests if r['action']=='nhQuotes'])==before+1;assert await card.locator('.market-up').count()==1
      await h.page.screenshot(path=str(args.output/(str(width)+'-verified-synthetic.png')))
      await dialog.get_by_role('button',name='코스닥150 선물 조회',exact=True).click();await h.page.wait_for_function('()=>!Q.k4');await h.page.wait_for_function('()=>document.querySelector(".miv-dialog [role=status]")?.textContent.includes("미수신")');text=await dialog.inner_text();assert '현재 시세 미연결' in text and '1,240' not in text;assert '시세 미수신' in await card.inner_text();await dialog.get_by_role('button',name='✕ 닫기',exact=True).click();assert await h.page.get_by_role('dialog').count()==0
      await h.go('sectors');await h.go('market');await card.click();dialog=h.page.get_by_role('dialog',name='KOSDAQ 150 선물 · 확대 차트',exact=True);await dialog.get_by_role('button',name='코스닥150 선물 조회',exact=True).click();await h.page.wait_for_timeout(50);await h.page.evaluate('logout()');await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null');await h.page.wait_for_timeout(650);assert await h.page.get_by_role('dialog').count()==0;assert await h.page.evaluate('typeof Q.k4==="undefined"');assert not h.errors,h.errors;assert not any(r['action'] in ['nhAccounts','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
      row={'width':width,'status':'PASS','scope':'PUBLISHED_ASSETS_SYNTHETIC_SERVICE' if args.published else 'SYNTHETIC_SERVICE','checks':['dated_contract','korean_time_in_UTC_browser','manual_refresh_updates_header_card','missing_observation_clears_stale','route_close','logout_discards_late_reply'],'nhRequests':len([r for r in h.requests if r['action']=='nhQuotes'])}
     except Exception as e:
      row={'width':width,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:600]};await h.page.screenshot(path=str(args.output/(str(width)+'-FAIL.png')))
     finally:await h.close()
     results.append(row);print(json.dumps(row),flush=True)
   finally:await browser.close();os.environ.pop('MYINVEST_TEST_FUTURE_FIXTURE',None)
 args.output.joinpath('results.json').write_text(json.dumps(results,indent=2));return int(any(r['status']=='FAIL' for r in results))
raise SystemExit(asyncio.run(main()))
