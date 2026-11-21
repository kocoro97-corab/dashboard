"""Shared public-market briefing feed browser test. Synthetic static file only."""
import asyncio
import json
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from playwright.async_api import async_playwright
from build_dev_pages import build
from public_integration_support import Harness, synthetic_feeds, ENDPOINT

def public_feed():
    now=int(time.time()*1000)
    generated=now-60_000
    date=datetime.fromtimestamp(generated/1000,ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d')
    record={
      'schemaVersion':1,'date':date,'origin':'chatgpt-task',
      'title':'합성 공유 브리핑',
      'visibility':'public-market-only','timeZone':'Asia/Seoul','scheduleLocal':'07:00',
      'generatedAt':generated,'observedAt':generated-120_000,'retrievedAt':generated-60_000,
      'rawText':'합성 공유 보고서 <script>window.__BAD=true</script>',
      'sections':[],'sources':[]
    }
    return {'type':'public-briefing-feed-v1','schemaVersion':1,'records':[record]}

async def main():
    with tempfile.TemporaryDirectory() as tmp:
        artifact=Path(tmp)/'public'
        build(artifact,relay_endpoint=ENDPOINT)
        file=artifact/'data/myinvest-public-briefings-v1.json'
        valid=public_feed()
        file.write_text(json.dumps(valid,ensure_ascii=False),encoding='utf-8')
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(headless=True)
            try:
                for width in [1440,690,344]:
                    h=await Harness(browser,artifact,synthetic_feeds(),width).start_browser(tmp)
                    try:
                        await h.login('news')
                        section=h.page.locator('.mifv1')
                        await section.get_by_text('합성 공유 브리핑').wait_for()
                        assert await section.count()==1
                        assert '독립 검증되지 않았습니다' in await section.inner_text()
                        assert await h.page.evaluate('window.__BAD===undefined')
                        assert await h.page.locator('.mibv1').count()==1
                        assert await h.page.locator('.nev5-brief').count()==1

                        # Tamper a public file, re-request and reject entire feed.
                        bad=json.loads(json.dumps(valid))
                        bad['records'][0]['accountNumber']='PRIVATE_DO_NOT_DISPLAY'
                        file.write_text(json.dumps(bad,ensure_ascii=False),encoding='utf-8')
                        await section.get_by_role('button',name='공유 파일 새로고침').click()
                        await section.get_by_text('INVALID_PUBLIC_FEED_RECORD_',exact=False).wait_for()
                        assert 'PRIVATE_DO_NOT_DISPLAY' not in await section.inner_text()
                        assert await h.page.evaluate(
                          "localStorage.getItem('myinvest_public_briefing_archive_v1')===null")

                        # Repair fixture and prove re-entry triggers safe same-origin refresh.
                        file.write_text(json.dumps(valid,ensure_ascii=False),encoding='utf-8')
                        await h.go('market')
                        await h.go('news')
                        await section.get_by_text('합성 공유 브리핑').wait_for()
                        assert await section.count()==1
                        assert await h.page.evaluate(
                          'document.documentElement.scrollWidth<=innerWidth+1')
                        assert not h.errors,h.errors
                        assert not any(req['action'] in [
                          'saveExternalHoldings','restoreExternalHoldings','order']
                          for req in h.requests)
                        print(json.dumps({
                          'width':width,'staticSharedPublicFeed':'PASS',
                          'rejectsPrivateFields':'PASS',
                          'manualArchivePreserved':'PASS',
                          'routeReload':'PASS',
                          'hasAutomaticChatGPTDelivery':False,
                          'realNHCalls':0
                        }))
                    finally:
                        await h.close()
            finally:
                await browser.close()

if __name__=='__main__':
    asyncio.run(main())
