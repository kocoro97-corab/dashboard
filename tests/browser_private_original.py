"""Synthetic private original test: no Google, GAS, NH, external secrets or real report text."""
import asyncio,hashlib,json,re,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from playwright.async_api import async_playwright
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT

class PrivateHarness(Harness):
 def __init__(self,*args,capability,**kwargs):
  super().__init__(*args,**kwargs)
  self.capability=capability
  self.private_requests=[]
 async def _route(self,route):
  if route.request.url==self.endpoint and route.request.method=='POST':
   body=json.loads(route.request.post_data or '{}')
   if body.get('action') in ['appVersion','privateMorningBriefing']:
    headers={'Access-Control-Allow-Origin':'https://kocoro97-corab.github.io','Cache-Control':'no-store'}
    if body['action']=='appVersion':
     response={'success':True,'freshTestEnvironment':True,'testEnvironment':'nh-staging',
               'gatewayVersion':2,'storeEngine':'account-store-v2','relayProfile':'persistent',
               'developmentPrivateBriefings':self.capability,'features':['privateMorningBriefing']}
    else:
     self.private_requests.append(body.get('mode'))
     assert self.capability is True,'disabled bootstrap must not request the private archive'
     assert re.fullmatch(r'Bearer [a-fA-F0-9]{64}',route.request.headers.get('authorization',''))
     assert 'token' not in body
     response={'success':True,'schemaVersion':1,'private':True,'cacheable':False,
               'dates':['2026-11-26'],'latestDate':'2026-11-26',
               'report':{'date':'2026-11-26','content':TEXT,'savedAt':int(time.time()*1000),
                         'format':'verbatim-text','origin':'scheduled-task-archive-unverified',
                         'contentSha256':hashlib.sha256(TEXT.encode()).hexdigest()}}
    await route.fulfill(status=200,headers=headers,json=response)
    return
  await super()._route(route)

TEXT='# 2026-11-26 ChatGPT synthetic original\n<Cite ref="example" />\n<script>window.__PRIVILEGE_CANARY=true</script>\n'
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'private-synthetic';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in [1440,344,690]:
     h=await Harness(browser,artifact,synthetic_feeds(),width).start_browser(tmp)
     try:
      await h.login('news')
      assert await h.page.locator('.mipr1').count()==1
      assert '미활성화' in await h.page.locator('.mipr1').inner_text()
      data=await h.page.evaluate('''async data=>{
        const token=LS('invest_session_token');
        const oldCfg=window.MYINVEST_TRANSPORT_CONFIG,oldTransport=window.DashboardTransport;
        const host=document.createElement('div');host.id='syntheticPrivateHost';document.body.append(host);
        const report={date:'2026-11-26',content:data.text,contentSha256:data.hash,
          origin:'scheduled-task-archive-unverified',format:'verbatim-text',savedAt:Date.now()-1000};
        let calls=[];
        window.MYINVEST_TRANSPORT_CONFIG={mode:'relay',devSession:true,privateBriefings:true};
        window.DashboardTransport={isRelay:()=>true,post:async p=>{
          calls.push({action:p.action,mode:p.mode,date:p.date,correctToken:p.token===token});
          return {ok:true,json:async()=>({success:true,schemaVersion:1,private:true,cacheable:false,
            dates:['2026-11-26','2026-11-25'],latestDate:'2026-11-26',
            report:{...report,date:p.date||report.date}})};
        }};
        try{
          const instance=MYInvestPrivateOriginalBriefing.mount(host);
          const first=await instance.refresh();
          const pre=host.querySelector('pre');
          const result={first,originalSame:pre?.textContent===data.text,
            htmlExecuted:window.__PRIVILEGE_CANARY===true,dates:host.querySelectorAll('select option').length,
            calls:JSON.parse(JSON.stringify(calls)),renderedMarkupTags:host.querySelector('script')!==null};
          instance.destroy();
          result.cleared=host.textContent==='';
          host.remove();
          return result;
        }finally{window.MYINVEST_TRANSPORT_CONFIG=oldCfg;window.DashboardTransport=oldTransport;}
      }''',{'text':TEXT,'hash':hashlib.sha256(TEXT.encode()).hexdigest()})
      assert data['first']['ok'] is True,data
      assert data['originalSame'] is True,data
      assert data['htmlExecuted'] is False,data
      assert data['renderedMarkupTags'] is False,data
      assert data['dates']==2,data
      assert data['cleared'] is True,data
      assert data['calls']==[{'action':'privateMorningBriefing','mode':'latest','correctToken':True}],data
      assert not any(r['action']=='privateMorningBriefing' for r in h.requests),'disabled news view may not read private data through a real relay'
      print(json.dumps({'width':width,'privateOriginalSynthetic':'PASS','SHA256':'PASS','noPublicFallback':'PASS','noExecution':'PASS','clearedAfterUnmount':'PASS'}))
     finally:await h.close()
    # News already mounted with the capability disabled, then the handshake
    # finishes. It must fetch without a reload or an admin pressing a button.
    h=await PrivateHarness(browser,artifact,synthetic_feeds(),344,capability=False).start_browser(tmp)
    try:
     await h.login('news')
     host=h.page.locator('[data-news-block="private-original"]')
     assert '미활성화' in await host.inner_text()
     assert not h.private_requests
     h.capability=True
     await h.page.evaluate("MYINVEST_TRANSPORT_CONFIG.privateBriefings=true; dispatchEvent(new Event('myinvest-private-briefing-capability'))")
     await h.page.wait_for_function("(t)=>document.querySelector('[data-news-block=private-original] pre')?.textContent===t",arg=TEXT)
     assert h.private_requests==['latest']
     await h.go('strategy')
     await h.page.evaluate("dispatchEvent(new Event('myinvest-private-briefing-capability'))")
     assert h.private_requests==['latest']
     print(json.dumps({'width':344,'delayedCapabilityReadOnce':'PASS','noReadAfterLeaving':'PASS'}))
    finally:await h.close()
    # The app's normal dev_connect.js bootstrap must unlock the actual News page.
    # Only the relay network response is simulated; no client flag is injected.
    for width,capability in [(344,False),(344,True),(690,True),(1440,True)]:
     h=await PrivateHarness(browser,artifact,synthetic_feeds(),width,capability=capability).start_browser(tmp)
     try:
      await h.login('news')
      host=h.page.locator('[data-news-block="private-original"]')
      await host.wait_for()
      assert await h.page.evaluate('window.MYINVEST_TRANSPORT_CONFIG.privateBriefings') is capability
      if capability:
       await h.page.wait_for_function('(text)=>document.querySelector(\'[data-news-block="private-original"] pre\')?.textContent===text',arg=TEXT)
       assert h.private_requests and set(h.private_requests)=={'latest'}
       assert await h.page.evaluate('window.__PRIVILEGE_CANARY===undefined')
       assert await h.page.evaluate('(text)=>![localStorage,sessionStorage].some(s=>Object.values(s).some(v=>String(v).includes(text)))',TEXT)
       await h.go('strategy')
       assert await host.count()==0
       await h.go('news')
       await h.page.wait_for_function('(text)=>document.querySelector(\'[data-news-block="private-original"] pre\')?.textContent===text',arg=TEXT)
       await h.page.evaluate('logout()')
       await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null')
       assert await host.count()==0
       assert TEXT not in await h.page.locator('body').inner_text()
      else:
       assert '미활성화' in await host.inner_text()
       assert h.private_requests==[]
      print(json.dumps({'width':width,'configured':capability,'privateOriginalNormalBootstrap':'PASS'}))
     finally:await h.close()
   finally:await browser.close()
asyncio.run(main())

