"""Synthetic private original test: no Google, GAS, NH, external secrets or real report text."""
import asyncio,hashlib,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from playwright.async_api import async_playwright
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT

TEXT='# 2026-11-26 ChatGPT synthetic original\\n<Cite ref="example" />\\n<script>window.__PRIVILEGE_CANARY=true</script>\\n'
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
      assert data['dates']==2,data
      assert data['cleared'] is True,data
      assert data['calls']==[{'action':'privateMorningBriefing','mode':'latest','correctToken':True}],data
      assert not any(r['action']=='privateMorningBriefing' for r in h.requests),'disabled news view may not read private data through a real relay'
      print(json.dumps({'width':width,'privateOriginalSynthetic':'PASS','SHA256':'PASS','noPublicFallback':'PASS','noExecution':'PASS','clearedAfterUnmount':'PASS'}))
     finally:await h.close()
   finally:await browser.close()
asyncio.run(main())
