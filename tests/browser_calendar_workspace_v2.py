"""MY INVEST V2 calendar in the existing news/global-toolbar app shell.

PC 1440px / intermediate 690px / narrow Fold 344px; synthetic login only.
No Google OAuth credential, NH, GAS writes or live providers are used.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'tests')]
from build_calendar_review_v2 import build_calendar_review
from public_integration_support import Harness,synthetic_feeds,ENDPOINT

ICS='''BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:google-calendar-export-fake-1
DTSTART;VALUE=DATE:20261127
SUMMARY:Google ICS 가져온 일정
END:VEVENT
END:VCALENDAR
'''

async def main():
 with tempfile.TemporaryDirectory() as folder:
  output=Path(folder)/'calendar'
  build_calendar_review(output,relay_endpoint=ENDPOINT)
  feeds=synthetic_feeds()
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in (1440,690,344):
     h=await Harness(browser,output,feeds,width).start_browser(folder)
     page=h.page
     forbidden=[]
     page.on('request',lambda request:forbidden.append(request.url)
             if 'googleapis.com/calendar/' in request.url or
             'accounts.google.com/gsi/' in request.url else None)
     try:
      await page.clock.set_fixed_time('2026-11-22T03:00:00Z')
      await h.login('news')
      assert await page.locator('[data-invest-calendar-trigger="true"]').count()==1
      await page.locator('[data-invest-calendar-trigger="true"]').click()
      modal=page.locator('.mcv2-modal')
      await modal.wait_for()
      assert await page.locator('.nev5-overlay').count()==0
      assert '투자 일정 캘린더' in await modal.inner_text()
      assert await page.locator('[data-calendar-day]').count()==30
      assert await page.locator('[data-calendar-form]').count()==1
      assert await page.locator('button:has-text("Google 읽기 전용 연결")').is_disabled()
      assert '자동 동기화되지 않습니다' in await modal.inner_text()
      assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width

      # Native calendar insert: shared existing localStorage key and news list.
      await page.get_by_label('일정 날짜',exact=True).fill('2026-11-27')
      await page.get_by_label('일정 제목',exact=True).fill('FOMC 반응 점검')
      await page.get_by_label('일정 시간',exact=True).fill('09:30')
      await page.get_by_label('일정 메모',exact=True).fill('SOX와 환율 확인')
      await page.get_by_role('button',name='일정 저장',exact=True).click()
      assert '일정을 이 브라우저에 저장' in await modal.inner_text()
      assert 'FOMC 반응 점검' in await modal.inner_text()
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert len(stored)==1
      assert stored[0]['date']=='2026-11-27'
      assert stored[0]['time']=='09:30'
      assert stored[0]['note']=='SOX와 환율 확인'
      assert 'FOMC 반응 점검' in await page.locator('[data-news-block="events"]').inner_text()

      # Edits must update existing ID, not append a duplicate.
      await modal.locator('.mcv2-event').filter(has_text='FOMC 반응 점검').get_by_role('button',name='수정').click()
      await page.get_by_label('일정 제목',exact=True).fill('FOMC 이후 투자 점검')
      await page.get_by_role('button',name='수정 저장').click()
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert len(stored)==1
      assert stored[0]['title']=='FOMC 이후 투자 점검'
      assert 'FOMC 이후 투자 점검' in await modal.inner_text()
      assert 'FOMC 이후 투자 점검' in await page.locator('[data-news-block="events"]').inner_text()

      # Google ICS export file is a user-selected offline operation.
      await page.get_by_label('ICS 일정 파일 선택').set_input_files({
       'name':'google-export.ics','mimeType':'text/calendar','buffer':ICS.encode('utf-8')})
      await page.wait_for_function('()=>document.querySelector(".mcv2-modal")?.textContent.includes("ICS 일정 1건 추가")')
      assert 'Google ICS 가져온 일정' in await modal.inner_text()
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert len(stored)==2
      assert all(row['date']=='2026-11-27' for row in stored)

      # Idempotent Google ICS import on the same browser.
      await page.get_by_label('ICS 일정 파일 선택').set_input_files({
       'name':'google-export.ics','mimeType':'text/calendar','buffer':ICS.encode('utf-8')})
      await page.wait_for_function('()=>document.querySelector(".mcv2-modal")?.textContent.includes("중복 1건")')
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert len(stored)==2

      async with page.expect_download() as info:
       await page.get_by_role('button',name='내 일정 .ics 내보내기').click()
      downloaded=await info.value
      assert downloaded.suggested_filename=='myinvest-investment-events.ics'
      filepath=await downloaded.path()
      assert filepath
      ics=Path(filepath).read_text()
      assert 'BEGIN:VCALENDAR' in ics
      assert 'FOMC 이후 투자 점검' in ics
      assert 'Google ICS 가져온 일정' in ics

      # Month switch and day selection remain responsive.
      await page.get_by_role('button',name='다음 달 ▶').click()
      assert '2026년 12월' in await modal.inner_text()
      await page.get_by_role('button',name='◀ 이전 달').click()
      assert '2026년 11월' in await modal.inner_text()
      assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width

      # Deletion must remove only the chosen native event after confirmation.
      await page.locator('[data-calendar-day="2026-11-27"]').click()
      page.once('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
      await modal.locator('.mcv2-event').filter(has_text='FOMC 이후 투자 점검').get_by_role('button',name='삭제').click()
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert len(stored)==1
      assert stored[0]['title']=='Google ICS 가져온 일정'
      assert 'FOMC 이후 투자 점검' not in await page.locator('[data-news-block="events"]').inner_text()

      # Escape closes modal without affecting legacy news, then header opens.
      await page.keyboard.press('Escape')
      await page.wait_for_function('()=>!document.querySelector(".mcv2-modal")')
      await page.locator('button[aria-label="투자 캘린더"]').click()
      await modal.wait_for()
      assert await page.locator('.nev5-overlay').count()==0

      # Global toolbar on a different route routes through news to calendar.
      await page.get_by_role('button',name='닫기',exact=True).click()
      await h.go('home')
      await page.locator('button[aria-label="투자 캘린더"]').click()
      await modal.wait_for()
      assert await page.locator('.nev5-overlay').count()==0
      assert await page.evaluate('DashboardShell.getStatus().page')=='news'

      # On logout all calendar DOM and consent state is cleared.
      await page.evaluate('logout()')
      await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
      assert await page.locator('.mcv2-modal').count()==0
      assert await page.locator('.nev5-overlay').count()==0
      assert not await page.evaluate('MYInvestCalendarWorkspaceV2.googleStatus().connected')
      assert not forbidden,forbidden
      assert not h.errors,h.errors
      assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),width

      print(json.dumps({
       'width':width,'status':'PASS','nativeCalendar':'PASS',
       'localLegacyEventIntegration':'PASS','icsImportExport':'PASS',
       'manualEditDelete':'PASS','navigation':'PASS',
       'logoutCleanup':'PASS','responsive':'PASS',
       'googleCallsWithoutConsent':0,
       'nhOrderCalls':0,'published':False
      },ensure_ascii=False),flush=True)
     finally:
      await h.close()
   finally:
    await browser.close()

if __name__=='__main__':
 asyncio.run(main())
