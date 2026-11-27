"""Cross-page density and name presentation, synthetic services only."""
import argparse,asyncio,json,sys,tempfile,math,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history,history_url,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--pages',nargs='+');p.add_argument('--artifact',type=Path);p.add_argument('--capture-only',action='store_true');p.add_argument('--published',action='store_true');p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--scales',type=float,nargs='+',default=[1,1.25,1.5]);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);rows=[]
PAGES=['home','market','sectors','stocks','news','strategy','accounts','accounts/holdings','accounts/nh','accounts/special','accounts/ocr','accounts/analysis','settings']
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=a.artifact or Path(tmp)/'public'
  if not a.artifact:build(artifact,relay_endpoint=ENDPOINT)
  feeds=synthetic_feeds()
  for sym in ['AAPL','MSFT','GOOG','GOOGL','SPY']:
   d=history(sym);d['chart']['result'][0]['meta'].update(longName={'AAPL':'Apple Inc.','MSFT':'Microsoft Corporation','GOOG':'Alphabet Inc.','GOOGL':'Alphabet Inc.','SPY':'SPDR S&P 500 ETF Trust'}[sym],instrumentType='ETF' if sym=='SPY' else 'EQUITY',exchangeName='PCX' if sym=='SPY' else 'NMS');feeds[history_url(sym)]=json.dumps(d)
  async with async_playwright() as pw:
   b=await pw.chromium.launch(headless=True)
   try:
    for width in a.widths:
     for scale in a.scales:
      # Native browser zoom reduces layout viewport and increases DPR. This
      # viewport/DPR equivalence tests reflow; it is not physical device testing.
      h=await Harness(b,artifact,feeds,math.floor(width/scale),a.published,height=math.floor(1000/scale),device_scale=scale,private_reads=True).start_browser(tmp)
      if a.artifact:h.endpoint=re.search(r'https://[a-z0-9.-]+\.workers\.dev/api',(artifact/'index.html').read_text())[0]
      try:
       await h.page.clock.set_fixed_time('2026-11-18T03:00:00Z');await h.login('accounts');await h.page.wait_for_function('()=>DashboardShell.getStatus().running===0')
       await h.page.evaluate('''()=>{NH_ACCOUNTS=[{accountKey:'a'.repeat(64),domestic:{holdings:[{code:'035720',name:'합성 국내 종목',currency:'KRW',quantity:123,avgPrice:15000,currentPrice:18000,evalAmount:2214000,profit:369000}]},overseas:{holdings:[{code:'AAPL',name:'AAPL',instrumentId:'US:XNAS:AAPL',currency:'USD',quantity:1234,avgPrice:123.45,currentPrice:178.9,evalAmount:300000000,profit:10000000}]},errors:[]}];EXT_ASSETS=[];EXT_SAVED_ROWS=[];NH_ACCOUNT_UPDATED=new Date().toISOString();NH_ACCOUNT_SESSION=LS('invest_session_token');NH_ACCOUNT_FETCHED_AT=Date.now()}''')
       for page in a.pages or PAGES:
        status='PASS';reason=''
        try:
         await h.page.evaluate('(p)=>DashboardShell.navigate("/"+p)',page);await h.page.wait_for_function('(p)=>DashboardShell.getStatus().path==="/"+p',arg=page);await h.page.wait_for_timeout(150)
         if page=='accounts/holdings':assert '합성 국내 종목' in await h.page.locator('.account-report').inner_text()
         if page=='stocks':await h.page.locator('#stockSearch').fill('AAPL');await h.page.get_by_role('button',name='종목 분석',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".sva")?.textContent.includes("분석 완료")')
         metrics=await h.page.evaluate('''()=>{const v=document.getElementById('pageViewport'),box=v.getBoundingClientRect(),visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>box.top&&r.top<box.bottom};return {viewportHeight:Math.round(box.height),documentOverflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:v.scrollWidth>v.clientWidth+1,visibleData:[...v.querySelectorAll('.miv-indicator,.stv2-card,.sva-card,.pv-kpi,table tr,.summary-grid>.card,.news')].filter(visible).length,marketCards:v.querySelectorAll('.miv-indicator').length,details:v.querySelectorAll('details').length}}''')
         if not a.capture_only:
          assert not metrics['documentOverflow'],metrics;assert not metrics['contentOverflow'],metrics
          if page=='market' and width==1440 and scale==1:assert metrics['marketCards']==9;assert await h.page.locator('.miv-grid').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length')==3
          if page=='sectors':assert await h.page.get_by_role('heading',name='내 보유·관심종목 연계',exact=True).count()==0;assert await h.page.get_by_placeholder('국내 6자리 코드 / 미국 티커').count()==0
         path=a.output/(str(width)+'-'+str(scale)+'-'+page.replace('/','-')+'.png');await h.page.screenshot(path=str(path))
        except Exception as e:status='FAIL';reason=(str(e).splitlines() or [type(e).__name__])[0][:250];metrics={}
        row={'page':page,'width':width,'zoom':scale,'status':status,'reason':reason,**metrics};rows.append(row);print(json.dumps(row),flush=True)
       assert not h.errors,h.errors;assert not any(r['action'] in ['saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
      finally:await h.close()
   finally:await b.close()
 a.output.joinpath('results.json').write_text(json.dumps(rows,indent=2));return int(any(r['status']=='FAIL' for r in rows))
raise SystemExit(asyncio.run(main()))
