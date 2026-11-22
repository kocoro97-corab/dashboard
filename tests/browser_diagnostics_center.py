"""Central dev diagnostics: synthetic auth/errors, no broker or storage writes."""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'tools')]
from playwright.async_api import async_playwright,expect
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--output',type=Path,default=Path('/tmp/diagnostics-center'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'site';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,synthetic_feeds(),width,published=args.published).start_browser(tmp);page=h.page
    try:
     await h.login('strategy');await expect(page.locator('#dashboardNav a[href="#/diagnostics"]')).to_have_count(1)
     await expect(page.locator('[data-module=five-minute-reference-v1]')).to_have_count(0)
     assert not h.errors,h.errors
     await page.evaluate('''()=>{
      ReadStatus.note({http:502,body:'PRIVATE_VALUE'},{key:'secret-url-PRIVATE_VALUE',scope:'public'});
      ReadStatus.note({code:'AUTH_REQUIRED',http:401,token:'PRIVATE_VALUE'},{key:'account-PRIVATE_VALUE',scope:'account'});
      window.dispatchEvent(new ErrorEvent('error',{message:'PRIVATE_VALUE',filename:'https://host/PRIVATE_VALUE'}));
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:Error('PRIVATE_VALUE')}));
      SafeDiagnostics.message({success:false,code:'STORE_CONFLICT',message:'PRIVATE_VALUE'});
      DevelopmentDiagnostics.quality('sectors',[{symbol:'PRIVATE_VALUE',reason:'DATE_MISMATCH'},{symbol:'PRIVATE_VALUE',reason:'DATE_MISMATCH'}],{market:'KR',category:'theme',period:'5d'});
     }''')
     expected_errors=len(h.errors)
     assert await page.locator('#readConnectionStatus,#errBar').count()==0
     await expect(page.locator('#dashboardNav a[href="#/diagnostics"]')).to_contain_text('검증·진단')
     count=len(h.requests);await h.go('diagnostics');await expect(page.locator('.dv-center')).to_be_visible()
     assert len(h.requests)==count, 'opening diagnostic overview must not call any API'
     text=await page.locator('.dv-center').inner_text()
     assert all(c in text for c in ['READ_NETWORK','AUTH_REQUIRED','SCRIPT_ERROR','ASYNC_ERROR','STORE_CONFLICT','DATE_MISMATCH'])
     assert 'PRIVATE_VALUE' not in text
     snap=await page.evaluate('DevelopmentDiagnostics.snapshot()');assert any(r['status']=='NOT_VISITED' for r in snap['pages']);assert all(r['status']=='NOT_RUN' for r in snap['checks'])
     assert 'PRIVATE_VALUE' not in json.dumps(snap) and 'a'*64 not in json.dumps(snap)
     await page.evaluate('''()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('BLOCKED')}}})''')
     await page.get_by_role('button',name='전체 결과 복사',exact=True).click();await expect(page.get_by_label('통합 검증 결과',exact=True)).to_be_visible()
     exported=json.loads(await page.get_by_label('통합 검증 결과',exact=True).input_value());assert exported['credentialsIncluded'] is False and exported['accountDataIncluded'] is False
     await page.evaluate('ReadStatus.clear("secret-url-PRIVATE_VALUE")')
     await page.wait_for_function('()=>DevelopmentDiagnostics.snapshot().issues.some(r=>r.source==="read"&&r.status==="RECOVERED")')
     await page.get_by_label('오류 상태 필터').select_option('resolved');await expect(page.locator('.dv-issues')).to_contain_text('READ_NETWORK')
     await page.get_by_label('오류 상태 필터').select_option('all')
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     for scale in [1,1.25,1.5]:
      await page.evaluate('(scale)=>document.documentElement.style.zoom=String(scale)',scale)
      await page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
      await page.screenshot(path=str(args.output/(str(width)+'-css-zoom-'+str(scale)+'.png')))
     await page.evaluate('document.documentElement.style.zoom="1"')
     await h.go('strategy');assert await page.locator('[data-module=five-minute-reference-v1]').count()==0
     await h.go('settings');assert await page.locator('.settings-status').count()==0
     await page.get_by_role('button',name='검증·진단 열기',exact=True).click();await page.wait_for_selector('.dv-center')
     assert await page.evaluate('DevelopmentDiagnostics.snapshot().issues.some(r=>r.code==="STORE_CONFLICT")')
     await page.evaluate('logout()');await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
     s=await page.evaluate('DevelopmentDiagnostics.snapshot()');assert not s['authenticated'] and not s['issues'] and not s['checks']
     await page.locator('#authId').fill('synthetic');await page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');await page.locator('#authSubmitBtn').click();await page.wait_for_selector('.dv-center')
     assert not await page.evaluate('DevelopmentDiagnostics.snapshot().issues.some(r=>r.code==="STORE_CONFLICT")')
     assert all(r['status']=='NOT_RUN' for r in (await page.evaluate('DevelopmentDiagnostics.snapshot()'))['checks'])
     assert len(h.errors)==expected_errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','nhExternalQuotes','saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts','order'] for r in h.requests)
     print(json.dumps({'width':width,'status':'PASS','auth':'SYNTHETIC','publishedAssets':args.published,'centralErrorCapture':True,'noAutomaticReads':True,'privacyAndLogout':True,'actualNhCalls':0}),flush=True)
    finally:await h.close()
   await browser.close()
asyncio.run(main())
