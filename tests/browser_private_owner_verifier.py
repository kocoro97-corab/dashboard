"""Full owner verifier with local artifacts/synthetic API only. No outbound requests."""
import asyncio,hashlib,json,mimetypes,os,sys,tempfile,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from playwright.async_api import Route,APIRequestContext,Page
import verify_private_news_live_browser as verifier
from build_dev_pages import build

async def main():
    text='# SYNTHETIC ONLY 원문\r\n<grid columns={2}><box><title>합성 카드</title>**강조**</box><box>자료<Cite ref="synthetic"/></box></grid>\n| 항목 | 값 |\n| --- | --- |\n| 합성지수 | 123 |\n<svg viewBox="0 0 100 20" onload="window.__EXECUTION_CANARY=true"><rect x="1" y="1" width="10" height="10" fill="url(https://forbidden.invalid/paint)" onclick="window.__EXECUTION_CANARY=true"/><text x="20" y="10">합성 도표</text></svg>\n<script>window.__EXECUTION_CANARY=true</script><img src="https://forbidden.invalid/image" onerror="alert(1)">\n'
    args=SimpleNamespace(source_sha='e'*40,content_sha=hashlib.sha256(text.encode()).hexdigest(),date='2026-11-27',bytes=len(text.encode()))
    hashes={'scriptHash':'a'*64,'sheetHash':'b'*64,'sourceDigest':'c'*64}
    metadata={'success':True,'freshTestEnvironment':True,'testEnvironment':'nh-staging','gatewayVersion':2,'storeEngine':'account-store-v2','relayProfile':'persistent',**hashes}
    original={'success':True,'schemaVersion':1,'private':True,'cacheable':False,'dates':[args.date],'latestDate':args.date,'report':{'date':args.date,'content':text,'contentSha256':args.content_sha,'format':'verbatim-text','origin':'scheduled-task-archive-unverified','savedAt':int(time.time()*1000)}}
    state={'revoked':False,'privateReads':0,'outbound':0}
    real_abort=Route.abort
    async def synthetic_abort(route,*a,**kw):
        if urlsplit(route.request.url).hostname=='forbidden.invalid':state['outbound']+=1
        return await real_abort(route,*a,**kw)
    with tempfile.TemporaryDirectory() as temporary:
        artifact=Path(temporary)/'artifact';build(artifact,source_branch='feat/private-original-briefing-read-20261126',private_briefing_endpoint=verifier.READER)
        async def synthetic_request(_,url,**kwargs):
            assert url==verifier.PAGE+'development-only.json'
            class Response:
                async def json(self):return {'myinvestDevelopmentOnly':True,'sourceCommit':args.source_sha}
            return Response()
        async def synthetic_continue(route,**kwargs):
            url=route.request.url
            if url.startswith(verifier.PAGE):
                path=artifact/(urlsplit(url).path.removeprefix('/dashboard-v2-dev/') or 'index.html')
                if path.is_file() and artifact in path.resolve().parents:
                    await route.fulfill(content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream',body=path.read_bytes());return
                await route.fulfill(status=404,body='');return
            assert url in (verifier.PRIMARY,verifier.READER),'all external requests must be fulfilled or aborted'
            body=json.loads(route.request.post_data or '{}');action=body.get('action');status=200
            if action=='appVersion':
                data={**metadata}
                if url==verifier.READER:data.update(developmentPrivateBriefings=True,developmentPrivateBriefingAuthority='gas-login-owner-v1',developmentPrivateBriefingRevision='f'*32,privateBriefingRelayFeatures=['privateMorningBriefing'])
            elif action=='login':
                assert url==verifier.READER and body['user']=='synthetic-owner' and body['pass']=='SYNTHETIC_ONLY_PASSWORD'
                state['revoked']=False;data={'success':True,'token':'a'*64,'isAdmin':True,'mustChangePassword':False}
            elif action=='sessionInfo':data={'success':not state['revoked'],'isAdmin':True,'mustChangePassword':False}
            elif action=='logout':state['revoked']=True;data={'success':True}
            elif action=='privateMorningBriefing':
                if not route.request.headers.get('authorization'):status=401;data={'success':False,'code':'AUTH_REQUIRED'}
                else:state['privateReads']+=1;data=original
            else:raise AssertionError('no actual or synthetic NH/account endpoint may run in this verifier')
            await route.fulfill(status=status,json=data,headers={'Access-Control-Allow-Origin':'https://kocoro97-corab.github.io','Cache-Control':'no-store'})
        real_evaluate=Page.evaluate
        async def synthetic_evaluate(page,expression,*a,**kw):
            result=await real_evaluate(page,expression,*a,**kw)
            if 'viewerStructure' in expression and os.environ.get('MYINVEST_VIEWER_SCREENSHOTS'):
                folder=Path(os.environ['MYINVEST_VIEWER_SCREENSHOTS']);folder.mkdir(parents=True,exist_ok=True)
                await page.screenshot(path=str(folder/('synthetic-viewer-'+str(page.viewport_size['width'])+'.png')))
            return result
        # Route.continue_ is NEVER allowed to send network traffic in this test.
        with patch.object(Route,'continue_',synthetic_continue),patch.object(APIRequestContext,'get',synthetic_request),patch.object(Page,'evaluate',synthetic_evaluate),patch.object(Route,'abort',synthetic_abort):
            result=await verifier.verify('synthetic-owner','SYNTHETIC_ONLY_PASSWORD',args)
        assert result['status']=='PASS',result
        assert result['formattedViewerVerified'] is True and result['domHashScope']=='unchanged-raw-source-details'
        assert result['sourceServerDomHashMatch'] is True and result['logoutCleared'] is True,result
        structure=result['widths']['1440']['viewerStructure']
        assert structure['headings']>=2 and structure['tables']==1 and structure['cards']==2 and structure['diagrams']==1,structure
        assert all(v['rawSourceCollapsed'] for v in result['widths'].values())
        assert state['outbound']==0,'viewer must not even attempt remote image/SVG resources'
        assert state['privateReads']>=1 and result['nhCalls']==result['accountCalls']==result['orderCalls']==0
        print(json.dumps({'mode':'SYNTHETIC_OWNER_VERIFIER','status':'PASS','widths':result['widths'],'originalHash':True,'logoutCleared':True,'actualGoogleCalls':0,'actualNhCalls':0}))

if __name__=='__main__':asyncio.run(main())
