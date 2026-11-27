"""Owner-terminal real dev-news browser verification. No keys, screenshots or original files.
Only fixed dev assets and auth/private-reader API actions may leave the browser.
"""
import argparse,asyncio,getpass,hashlib,json,re,sys
PRIMARY='https://myinvest-v2-dev-relay.kocoro97.workers.dev/api'
READER='https://myinvest-v2-private-original-preview.kocoro97.workers.dev/api'
PAGE='https://kocoro97-corab.github.io/dashboard-v2-dev/'
class Stop(Exception):pass
def progress(phase):print("[news-browser] "+phase,file=sys.stderr,flush=True)

def receipt(data,digest,date,size):
    if not isinstance(data,dict) or data.get('success') is not True or data.get('cacheable') is not False:raise Stop('LIVE_ORIGINAL_NOT_RECEIVED')
    report=data.get('report');report=report if isinstance(report,dict) else {};text=report.get('content')
    if not isinstance(text,str) or report.get('date')!=date or report.get('contentSha256')!=digest or hashlib.sha256(text.encode()).hexdigest()!=digest or len(text.encode())!=size:raise Stop('LIVE_ORIGINAL_HASH_OR_SIZE_MISMATCH')
    return {'date':date,'bytes':size,'sha256':digest}

async def verify(user,password,args):
    from playwright.async_api import async_playwright
    phase='BROWSER_START';progress(phase);blocked={};allowed={'appVersion','login','logout','sessionInfo','privateMorningBriefing'};requests=[];errors=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1000},service_workers='block')
        page=await context.new_page();page.set_default_timeout(30000)
        page.on('pageerror',lambda _:errors.append('PAGE_ERROR'))
        async def route(r):
            url=r.request.url;method=r.request.method
            if url.startswith(PAGE) and method=='GET':await r.continue_();return
            if url in (PRIMARY,READER):
                if method=='OPTIONS':await r.continue_();return
                try:action=json.loads(r.request.post_data or '{}').get('action')
                except Exception:action=None
                if method=='POST' and action in allowed:
                    if action in ('login','logout','privateMorningBriefing') and url!=READER:
                        blocked['AUTH_ROUTE_MISMATCH']=blocked.get('AUTH_ROUTE_MISMATCH',0)+1;await r.abort();return
                    requests.append(action);await r.continue_();return
                key=action if action in ('nhAccounts','nhQuotes','nhExternalQuotes','externalHoldings','externalAccounts','externalHistory','publicFetch') else 'OTHER_SCOPE_BLOCKED'
                blocked[key]=blocked.get(key,0)+1
            await r.abort()
        await context.route('**/*',route)
        try:
            phase='PUBLISHED_SOURCE';progress(phase);response=await context.request.get(PAGE+'development-only.json',timeout=20000);marker=await response.json()
            if marker.get('myinvestDevelopmentOnly') is not True or marker.get('sourceCommit')!=args.source_sha:raise Stop('PUBLISHED_SOURCE_MISMATCH')
            phase='PRIVATE_BOOTSTRAP';progress(phase);await page.goto(PAGE+'index.html#/news',wait_until='domcontentloaded')
            await page.locator('#devBanner').wait_for()
            if not await page.evaluate('MYINVEST_TRANSPORT_CONFIG.privateBriefings===true'):raise Stop('PRIVATE_READER_NOT_AVAILABLE')
            phase='ANONYMOUS_DENIAL';progress(phase)
            anonymous=await page.evaluate('''async endpoint=>{const r=await fetch(endpoint,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','X-MyInvest-Dev-Client':'dashboard-v2-dev'},body:JSON.stringify({action:'privateMorningBriefing',mode:'latest'})});const d=await r.json();return {http:r.status,code:d.code,success:d.success}}''',READER)
            if anonymous!={'http':401,'code':'AUTH_REQUIRED','success':False}:raise Stop('ANONYMOUS_DENIAL_UNCONFIRMED')
            phase='OWNER_LOGIN';progress(phase);await page.locator('#authId').fill(user);await page.locator('#authPw').fill(password)
            async with page.expect_response(lambda r:r.url==READER and r.request.method=='POST' and json.loads(r.request.post_data or '{}').get('action')=='privateMorningBriefing',timeout=60000) as received:
                await page.locator('#authSubmitBtn').click()
            response=await received.value;data=await response.json()
            phase='SERVER_ORIGINAL';progress(phase);result=receipt(data,args.content_sha,args.date,args.bytes)
            if response.status!=200 or 'no-store' not in response.headers.get('cache-control','').lower():raise Stop('PRIVATE_CACHE_POLICY_UNCONFIRMED')
            del data
            phase='DOM_ORIGINAL';progress(phase);await page.wait_for_function("()=>document.querySelector('[data-news-block=private-original] pre')?.textContent.length>0")
            widths={}
            for width in (1440,690,344):
                progress('VIEWPORT_'+str(width))
                await page.set_viewport_size({'width':width,'height':1000})
                # Let media-query/header-menu updates settle before inspecting or clicking.
                await page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                observed=await page.evaluate('''async()=>{const el=document.querySelector('[data-news-block=private-original] pre');const text=el?.textContent||'';const bytes=new TextEncoder().encode(text);const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');return {sha,bytes:bytes.length,noExecutedMarkup:!el?.querySelector('script,iframe'),noPersistentCopy:![localStorage,sessionStorage].some(s=>Object.values(s).some(v=>String(v).includes(text))),noDocumentOverflow:document.documentElement.scrollWidth<=innerWidth+1}}''')
                if observed['sha']!=args.content_sha or observed['bytes']!=args.bytes or not observed['noExecutedMarkup'] or not observed['noPersistentCopy']:raise Stop('DOM_HASH_OR_PRIVACY_UNCONFIRMED')
                widths[str(width)]={'hash':'PASS','noDocumentOverflow':observed['noDocumentOverflow']}
            phase='LOGOUT_CLEAR';progress(phase)
            async with page.expect_response(lambda r:r.url==READER and r.request.method=='POST' and json.loads(r.request.post_data or '{}').get('action')=='logout',timeout=30000) as logged_out:
                phase='LOGOUT_CONTROL';progress(phase)
                logout=page.locator('#appContainer button[onclick="logout()"]')
                if not await logout.is_visible():await page.locator('header .dense-header-tools > summary').click()
                if not await logout.is_enabled():raise Stop('VISIBLE_LOGOUT_DISABLED')
                await logout.click()
            phase='LOGOUT_RESPONSE';progress(phase)
            # Logout hides/unmounts the page before ignored fetch bodies are drained.
            # Verify the response status and DOM cleanup; server-token revocation is
            # independently covered by the owner's live API receipt.
            if (await logged_out.value).status!=200:raise Stop('LOGOUT_TRANSPORT_UNCONFIRMED')
            phase='LOGOUT_DOM';progress(phase)
            await page.wait_for_function("()=>document.querySelector('[data-news-block=private-original] pre')===null")
            if 'AUTH_ROUTE_MISMATCH' in blocked:raise Stop('AUTH_ROUTE_MISMATCH')
            return {'status':'PASS' if not errors and all(v['noDocumentOverflow'] for v in widths.values()) else 'PARTIAL','phase':'REAL_BROWSER_ORIGINAL_VERIFIED','sourceSha':args.source_sha,'original':result,'sourceServerDomHashMatch':True,'anonymousBlocked':True,'logoutCleared':True,'widths':widths,'pageErrors':len(errors),'scopeBlockedRequests':blocked,'nhCalls':0,'accountCalls':0,'orderCalls':0,'originalFileWrites':0,'credentialsIncluded':False,'screenshotsWritten':False,'generalMemberLiveTest':'NOT_RUN','nextScheduledSave':'NOT_RUN'}
        except Stop as error:return {'status':'PARTIAL','phase':phase,'code':str(error),'credentialsIncluded':False,'nhCalls':0,'accountCalls':0,'orderCalls':0}
        except Exception:return {'status':'PARTIAL','phase':phase,'code':'LIVE_BROWSER_CHECK_UNCONFIRMED','credentialsIncluded':False,'nhCalls':0,'accountCalls':0,'orderCalls':0}
        finally:
            progress('BROWSER_CLEANUP')
            try:await asyncio.wait_for(context.unroute_all(behavior='ignoreErrors'),timeout=5)
            except Exception:pass
            try:await asyncio.wait_for(context.close(),timeout=5)
            except Exception:pass
            try:await asyncio.wait_for(browser.close(),timeout=5)
            except Exception:pass
            progress('BROWSER_CLOSED')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-sha',required=True);parser.add_argument('--content-sha',required=True);parser.add_argument('--date',default='2026-11-27');parser.add_argument('--bytes',type=int,default=16526);args=parser.parse_args()
    try:
        if not re.fullmatch('[a-f0-9]{40}',args.source_sha) or not re.fullmatch('[a-f0-9]{64}',args.content_sha) or args.date!='2026-11-27' or args.bytes!=16526:raise Stop('EXPECTED_ORIGINAL_RECEIPT_REQUIRED')
        if not sys.stdin.isatty():raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        from playwright.async_api import async_playwright
        user=getpass.getpass('Existing MY INVEST owner ID (hidden): ');password=getpass.getpass('Existing MY INVEST password (hidden): ')
        result=asyncio.run(verify(user,password,args))
    except ImportError:result={'status':'NOT_RUN','code':'PLAYWRIGHT_RUNTIME_REQUIRED','credentialsIncluded':False}
    except (Stop,EOFError,KeyboardInterrupt):result={'status':'NOT_RUN','code':'OWNER_BROWSER_INPUT_OR_RUNTIME_REQUIRED','credentialsIncluded':False}
    except Exception:result={'status':'NOT_RUN','code':'OWNER_BROWSER_RUNTIME_UNCONFIRMED','credentialsIncluded':False}
    print(json.dumps(result));return 0 if result.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
