"""Read-budget, bounded busy retry and route cleanup through actual Worker code.
Synthetic authentication, providers and fault injection only; actual NH calls 0.
"""
import argparse,asyncio,json,sys,tempfile,time
from pathlib import Path
from urllib.parse import unquote
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history_url,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--output',type=Path,default=Path('/tmp/relay-busy-browser'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
class BusyHarness(Harness):
 async def _route(self,r):
  if r.request.url==self.endpoint and r.request.method=='POST':
   body=json.loads(r.request.post_data or '{}');action=body.get('action');url=body.get('url','');self.readActive+=int(action=='publicFetch');self.maxRead=max(self.maxRead,self.readActive)
   try:
    if action=='publicFetch' and url==self.faultUrl and self.remaining:
     self.remaining-=1;now=round((time.perf_counter()-self.start)*1000);self.faultTimes.append(now);self.requests.append({'action':action,'url':url,'startMs':now,'endMs':now,'http':503,'phase':self.phase,'injected':True})
     return await r.fulfill(status=503,headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'https://kocoro97-corab.github.io','Access-Control-Expose-Headers':'Retry-After','Retry-After':'1'},body=json.dumps({'success':False,'code':'RELAY_BUSY','layer':'relay'}))
    index=len(self.requests);await super()._route(r)
    if index<len(self.requests):self.requests[index]['phase']=self.phase
   finally:self.readActive-=int(action=='publicFetch')
   return
  return await super()._route(r)
async def main():
 rows=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in a.widths:
    h=BusyHarness(browser,artifact,synthetic_feeds(),width);h.readActive=0;h.maxRead=0;h.phase='home';h.faultUrl='';h.remaining=0;h.faultTimes=[];await h.start_browser(tmp)
    async def check(name,fn):
     try:await fn();row={'width':width,'test':name,'status':'PASS'}
     except Exception as e:row={'width':width,'test':name,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:300]};await h.page.screenshot(path=str(a.output/(str(width)+'-'+name+'-FAIL.png')))
     rows.append(row);print(json.dumps(row),flush=True)
    try:
     await h.page.clock.set_fixed_time('2026-11-17T03:00:00Z');await h.login('home')
     async def native():
      h.phase='market';await h.go('market');await h.page.wait_for_function('()=>!MK_BUSY');assert await h.page.locator('.miv-indicator').count()==9
      h.phase='sectors';await h.go('sectors');await h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name='미국',exact=True).click();await h.page.wait_for_selector('.stv2-us-themes .stv2-card');await h.page.get_by_role('button',name='스윙',exact=True).click();await h.page.get_by_role('button',name='20일',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".stv2")?.textContent.includes("기간 20거래일")');assert h.maxRead<=2;assert not any(r.get('http')==503 for r in h.requests)
     await check('NATIVE_HOME_MARKET_US_THEME_READ_BUDGET',native)
     async def recovery():
      h.phase='retry-recovery';h.faultUrl=history_url('SPY');h.remaining=2;before=len(h.faultTimes)
      result=await h.page.evaluate('''async url=>{const result=await Promise.all(Array.from({length:12},()=>DashboardTransport.publicRead(url)));return {count:result.length,errors:ReadStatus.snapshot().length}}''',h.faultUrl)
      assert result['count']==12;attempts=[r for r in h.requests if r.get('phase')==h.phase and r.get('url')==h.faultUrl];assert len(attempts)==3,attempts;assert len(h.faultTimes)==before+2;assert attempts[1]['startMs']-attempts[0]['startMs']>=900;assert attempts[2]['startMs']-attempts[1]['startMs']>=1800;assert not any(x['code']=='RELAY_BUSY' for x in await h.page.evaluate('ReadStatus.snapshot()'))
     await check('BUSY_BACKOFF_AND_DUPLICATE_JOIN_RECOVER',recovery)
     async def stale():
      h.phase='retained-quote';await h.go('market');await h.page.wait_for_function('()=>!MK_BUSY&&!!Q["^KS11"]');prior=await h.page.evaluate('({price:Q["^KS11"].p,received:QT["^KS11"]})');await h.page.clock.set_fixed_time('2026-11-17T03:00:05Z');h.faultUrl=history_url('^KS11','1d','1d');h.remaining=10
      await h.page.get_by_role('button',name='현재 페이지 갱신',exact=True).click();await h.page.wait_for_function('()=>!MK_BUSY&&Q["^KS11"]?.refreshFailed===true');assert await h.page.evaluate('Q["^KS11"].p')==prior['price'];assert await h.page.evaluate('QT["^KS11"]')==prior['received'];assert '이전 자료' in await h.page.locator('.miv-indicator').filter(has=h.page.get_by_text('KOSPI',exact=True)).inner_text();attempts=[r for r in h.requests if r.get('phase')==h.phase and r.get('url')==h.faultUrl];assert len(attempts)==3;await h.page.screenshot(path=str(a.output/(str(width)+'-retained-observation.png')))
      h.remaining=0;await h.page.get_by_role('button',name='현재 페이지 갱신',exact=True).click();await h.page.wait_for_function('()=>!MK_BUSY&&Q["^KS11"]?.refreshFailed!==true');assert '이전 자료' not in await h.page.locator('.miv-indicator').filter(has=h.page.get_by_text('KOSPI',exact=True)).inner_text()
     await check('THREE_ATTEMPTS_SAFE_FAILURE_RETAINED_TIME_RECOVERY',stale)
     async def cleanup():
      h.phase='cancel';urls=[history_url(s) for s in ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLC','XLU','XLB','XLRE']]
      for url in urls:h.overrides[url]={'text':synthetic_feeds()[url],'delayMs':250}
      await h.page.evaluate('''urls=>{window.__busyOld=Promise.allSettled(urls.map(u=>DashboardTransport.publicRead(u)))}''',urls);await h.page.wait_for_timeout(40);await h.go('news');old=await h.page.evaluate('window.__busyOld.then(x=>x.filter(r=>r.status==="rejected").length)');assert old>0
      await h.page.evaluate('logout()');await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null');await h.page.wait_for_timeout(400);stats=await h.page.evaluate('DashboardTransport.readState()');assert stats['queued']==0 and stats['active']==0,stats;assert not h.errors,h.errors;assert not any(r['action'] in ['nhQuotes','nhAccounts','nhExternalQuotes','order','saveExternalHoldings','restoreExternalHoldings'] for r in h.requests)
      safe=await h.page.evaluate('JSON.stringify(ReadStatus.snapshot())');assert 'SYNTHETIC_PRIVATE_PASSWORD' not in safe and 'a'*64 not in safe;assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await check('ROUTE_LOGOUT_CANCEL_PENDING_ZERO_NH_WRITES',cleanup)
     counts={phase:{'requests':sum(r.get('phase')==phase for r in h.requests),'public':sum(r.get('phase')==phase and r['action']=='publicFetch' for r in h.requests),'maxPublicConcurrency':h.maxRead} for phase in sorted({r.get('phase','other') for r in h.requests})};a.output.joinpath(str(width)+'-requests.json').write_text(json.dumps({'scope':'SYNTHETIC_WORKER_GAS_AND_FEEDS','counts':counts,'requests':h.requests},indent=2))
    finally:await h.close()
   # A queued country switch must start its own history after the old country
   # finishes. Capture the visible key, including MIX, rather than comparing
   # only the local requested-country key in the completed operation.
   feeds=synthetic_feeds();feeds[history_url('SPY')]={'text':feeds[history_url('SPY')],'delayMs':1500}
   h=await Harness(browser,artifact,feeds,1440).start_browser(tmp)
   try:
    await h.ctx.add_init_script('localStorage.setItem("myinvest_sectors_display_v3",JSON.stringify({market:"US",mode:"swing",period:"5d",category:"theme"}))')
    await h.page.clock.set_fixed_time('2026-11-17T03:00:00Z');await h.login('sectors')
    await h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name='한국',exact=True).click()
    await h.page.wait_for_function('()=>document.querySelector(".stv2 .stv2-table")?.rows.length===3')
    assert any(r.get('url')==history_url('005930.KS') for r in h.requests)
    assert await h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name='한국',exact=True).get_attribute('aria-pressed')=='true'
    assert not h.errors;assert not any(r['action'] in ['nhQuotes','nhAccounts','order'] for r in h.requests)
    rows.append({'width':1440,'test':'IN_FLIGHT_US_TO_KR_SWING_STARTS_CURRENT_COUNTRY','status':'PASS'})
   except Exception as e:
    rows.append({'width':1440,'test':'IN_FLIGHT_US_TO_KR_SWING_STARTS_CURRENT_COUNTRY','status':'FAIL','reason':str(e)[:250]})
   finally:await h.close()
   await browser.close()
 a.output.joinpath('results.json').write_text(json.dumps(rows,indent=2));return int(any(x['status']=='FAIL' for x in rows))
raise SystemExit(asyncio.run(main()))
