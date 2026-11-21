"""Synthetic morning-briefing archive UI test. No real NH/GAS/AI requests."""
import asyncio, json, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from playwright.async_api import async_playwright
from build_dev_pages import build
from public_integration_support import Harness, synthetic_feeds, ENDPOINT


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        artifact = Path(tmp) / 'public'
        build(artifact, relay_endpoint=ENDPOINT)
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                for width in [1440, 690, 344]:
                    h = await Harness(browser, artifact, synthetic_feeds(), width).start_browser(tmp)
                    try:
                        await h.login('news');await h.page.locator('.nev5-management > summary').click()
                        panel = h.page.locator('.mibv1')
                        assert await panel.count() == 1, 'archive panel must mount once'
                        assert '자동 전달은 아직 연결되지 않았습니다' in await panel.inner_text()

                        data = await h.page.evaluate("""() => {
                          const now=Date.now();
                          const date=new Intl.DateTimeFormat('sv-SE',{
                            timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
                          }).format(new Date(now));
                          const data={
                            schemaVersion:1,date,origin:'chatgpt-task',title:'합성 7시 공개 브리핑',
                            visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
                            generatedAt:now,observedAt:now-60000,retrievedAt:now-30000,
                            rawText:'합성 시장 브리핑 <img src=x onerror=window.__XSS__=true>',
                            sections:[],sources:[{id:'official',title:'합성 외부 출처',
                              url:'https://example.org/report',publishedAt:now-60000}]
                          };
                          const row=window.MYInvestBriefingArchiveV1.normalize(data,{now});
                          if(!row.ok)throw new Error(row.code);
                          const out=window.MYInvestBriefingTransferV1.exportJSON([row.record],{now});
                          if(!out.ok)throw new Error(out.code);
                          return {date, json:out.json};
                        }""")
                        await panel.locator('input[type=file]').set_input_files({
                            'name':'public-market-test.json',
                            'mimeType':'application/json',
                            'buffer':data['json'].encode('utf-8')
                        })
                        assert '합성 7시 공개 브리핑' in await panel.inner_text()
                        assert '원문·생성 경로·시장 수치' in await panel.inner_text()
                        assert await panel.get_by_role('link', name='합성 외부 출처').count() == 1
                        assert await h.page.evaluate('window.__XSS__ === undefined')

                        await h.page.evaluate("""() => {
                          const key='myinvest_public_ai_briefings_v1';
                          const date=new Intl.DateTimeFormat('sv-SE',{
                            timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
                          }).format(new Date());
                          localStorage.setItem(key,JSON.stringify([{
                            date,text:'기존 수동 기록 보존 확인',at:Date.now(),source:'user'
                          }]));
                        }""")
                        await panel.get_by_role('button', name='기존 수동 브리핑 복사').click()
                        dropdown=h.page.get_by_label('브리핑 날짜 및 출처 선택')
                        assert await dropdown.locator('option').count()==2
                        await dropdown.select_option(data['date']+'|manual')
                        assert '기존 수동 기록 보존 확인' in await panel.inner_text()
                        assert await h.page.evaluate("""() => {
                          return localStorage.getItem('myinvest_public_ai_briefings_v1') !== null;
                        }""")
                        before=await h.page.evaluate(
                            "localStorage.getItem('myinvest_public_briefing_archive_v1')")
                        await panel.locator('input[type=file]').set_input_files({
                            'name':'bad.json','mimeType':'application/json','buffer':b'{"bad":true}'
                        })
                        after=await h.page.evaluate(
                            "localStorage.getItem('myinvest_public_briefing_archive_v1')")
                        assert before==after, 'invalid import must preserve data'
                        assert '가져오기 거부' in await panel.inner_text()

                        await h.go('market')
                        await h.go('news')
                        assert await h.page.locator('.mibv1').count()==1
                        assert await h.page.get_by_label('브리핑 날짜 및 출처 선택').locator('option').count()==2
                        assert await h.page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                        assert not h.errors, h.errors
                        assert not any(r['action'] in ['saveExternalHoldings',
                          'restoreExternalHoldings','order'] for r in h.requests)
                        print(json.dumps({'width':width,'archivePanel':'PASS',
                          'manualImport':'PASS','legacyPreserved':'PASS',
                          'invalidUploadPreservesStorage':'PASS',
                          'routeRestore':'PASS','noRealAIOrNH':True}))
                    finally:
                        await h.close()
            finally:
                await browser.close()


if __name__=='__main__':
    asyncio.run(main())
