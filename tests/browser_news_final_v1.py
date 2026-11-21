"""Integrated news UI: synthetic auth/feeds; public reports never account data."""
import argparse,asyncio,json,sys,tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,ENDPOINT
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('/tmp/news-final'));p.add_argument('--feed',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
async def main():
 rows=[]
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'site';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch()
   for width in [1440,690,344]:
    h=await Harness(browser,artifact,synthetic_feeds(),width).start_browser(tmp)
    try:
     now=1795212300000 # 2026-11-20 22:05 UTC / 2026-11-21 07:05 KST
     record={'schemaVersion':1,'date':'2026-11-21','origin':'dashboard-pipeline','title':'합성 통합 브리핑','visibility':'public-market-only','timeZone':'Asia/Seoul','scheduleLocal':'07:00','generatedAt':now-60000,'observedAt':now-3600000,'retrievedAt':now-120000,'rawText':None,'sections':[{'kind':'us-market','heading':'합성 미국장','body':'합성 테스트 자료','sourceIds':[]}],'sources':[]}
     feed=json.loads(a.feed.read_text()) if a.feed else {'type':'public-briefing-feed-v1','schemaVersion':1,'records':[record]}
     if not a.feed:await h.page.clock.set_fixed_time('2026-11-20T22:05:00Z')
     file=artifact/'data/myinvest-public-briefings-v1.json';file.write_text(json.dumps(feed))
     await h.login('news');await h.page.locator('.mifv1 h4').first.wait_for()
     assert await h.page.evaluate('Array.from(document.querySelectorAll(".nev5 > [data-news-block]")).map(x=>x.dataset.newsBlock).join(",")')=='briefing,live-news,symbols,history,events'
     assert await h.page.locator('.nev5-management').get_attribute('open') is None
     assert '실제 AI 모델 호출 없음' in await h.page.locator('.mifv1').inner_text()
     title=feed['records'][0]['title'];assert title in await h.page.locator('.mifv1').inner_text()
     assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     if a.feed:
      assert '일별 관측일' in await h.page.locator('.mifv1').inner_text()
      await h.page.screenshot(path=str(a.output/(str(width)+'-public-capture.png')))
      rows.append({'width':width,'test':'ACTUAL_PUBLIC_REPORT_REPLAY_SYNTHETIC_AUTH','status':'PASS'});continue
     # Malformed/private refresh retains previous good report and timestamps.
     old_text=await h.page.locator('.mifv1').inner_text();file.write_text('{"private":"PRIVATE_DO_NOT_DISPLAY"}')
     await h.page.get_by_role('button',name='공유 파일 새로고침',exact=True).click();await h.page.locator('.mifv1-stale').wait_for()
     assert title in await h.page.locator('.mifv1').inner_text();assert 'PRIVATE_DO_NOT_DISPLAY' not in await h.page.locator('.mifv1').inner_text()
     file.write_text(json.dumps(feed))
     await h.page.locator('.nev5-management > summary').click();panel=h.page.locator('.mibv1')
     backup={'type':'myinvest-public-briefing-backup-v1','schemaVersion':1,'exportedAt':now,'records':[record]}
     async def upload(data):await panel.locator('input[type=file]').set_input_files({'name':'public.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
     await upload(backup);await panel.get_by_text('가져오기: 추가',exact=False).wait_for();before=await h.page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')
     changed=json.loads(json.dumps(backup));changed['records'][0]['generatedAt']+=1000;changed['records'][0]['title']='교체되지 않을 합성 제목'
     h.page.once('dialog',lambda dialog:dialog.dismiss());await upload(changed);await panel.get_by_text('교체를 취소했습니다',exact=False).wait_for();assert await h.page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')==before
     async with h.page.expect_download() as download:await panel.get_by_role('button',name='JSON 백업 내보내기',exact=True).click()
     saved=await download.value;path=await saved.path();assert json.loads(Path(path).read_text())['records'][0]['title']==record['title']
     bad=json.loads(json.dumps(backup));bad['records'][0]['accountNumber']='PRIVATE_DO_NOT_DISPLAY';await upload(bad);await panel.get_by_text('가져오기 거부',exact=False).wait_for();assert await h.page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')==before
     await h.go('settings');await h.go('news');assert await h.page.locator('.mifv1').count()==1 and await h.page.locator('.mibv1').count()==1
     await h.page.locator('.nev5-management > summary').click();late=json.loads(json.dumps(backup));late['records'][0]['date']='2026-11-20';late['records'][0]['title']='저장되면 안 되는 늦은 합성 기록';await h.page.evaluate('text=>{File.prototype.text=function(){return new Promise(r=>setTimeout(()=>r(text),300))}}',json.dumps(late))
     await h.page.locator('.mibv1 input[type=file]').set_input_files({'name':'late.json','mimeType':'application/json','buffer':b'{}'});await h.go('settings');await h.page.wait_for_timeout(400)
     assert await h.page.evaluate('localStorage.getItem("myinvest_public_briefing_archive_v1")')==before
     await h.go('news');await h.page.screenshot(path=str(a.output/(str(width)+'-news-final.png')))
     await h.page.evaluate('logout()');await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await h.page.locator('.mifv1').count()==0;assert not h.errors,h.errors
     assert not any(r['action'] in ['nhAccounts','nhQuotes','nhExternalQuotes','saveExternalHoldings','restoreExternalHoldings','order'] for r in h.requests)
     rows.append({'width':width,'test':'NEWS_LAYOUT_RETENTION_IMPORT_CONFIRM_BACKUP_ROUTE_LOGOUT','status':'PASS','actualNhCalls':0})
    finally:await h.close()
   await browser.close()
 a.output.joinpath('results.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows));return 0
raise SystemExit(asyncio.run(main()))
