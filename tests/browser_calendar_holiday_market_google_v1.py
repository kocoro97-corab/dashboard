"""Synthetic Google multi-calendar OAuth + official market event visual review.

No actual Google account, credential, public market API, broker or deployment.
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

CLIENT='123456789012-abcdefghijklm123456789.apps.googleusercontent.com'
HOLIDAY='ko.south_korea#holiday@group.v.calendar.google.com'
FINANCE='private-finance-calendar@example.com'
SDK="""window.google={accounts:{oauth2:{
  initTokenClient:(options)=>({
    requestAccessToken:()=>options.callback({
      access_token:'ya29.mockBrowserCalendarAuthToken_123456789',
      expires_in:1800
    })
  }),
  revoke:(token,callback)=>callback()
}}};
"""

async def main():
 with tempfile.TemporaryDirectory() as tmp:
  dest=Path(tmp)/'calendar-review'
  build_calendar_review(dest,relay_endpoint=ENDPOINT,google_client_id=CLIENT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in (1440,344):
     h=await Harness(browser,dest,synthetic_feeds(),width).start_browser(tmp)
     urls=[]
     async def google_api(route):
      url=route.request.url
      urls.append(url)
      if '/users/me/calendarList' in url:
       data={'items':[
        {'id':'primary-user@example.com','summary':'내 기본 일정',
         'primary':True,'accessRole':'owner'},
        {'id':HOLIDAY,'summary':'대한민국의 휴일',
         'primary':False,'accessRole':'reader'},
        {'id':FINANCE,'summary':'비공개 재정 일정',
         'primary':False,'accessRole':'owner'}
       ]}
      elif '/calendars/primary/events' in url:
       data={'items':[{'id':'personal1','summary':'일반 약속',
        'start':{'date':'2026-12-15'},'status':'confirmed'}]}
      elif '/calendars/' in url and 'holiday' in url:
       data={'items':[{'id':'holiday1','summary':'기독탄신일',
        'start':{'date':'2026-12-25'},'status':'confirmed'}]}
      else:
       data={'items':[]}
      await route.fulfill(status=200,content_type='application/json',
       body=json.dumps(data))
     await h.ctx.route('https://accounts.google.com/gsi/client',
       lambda route:route.fulfill(status=200,content_type='application/javascript',body=SDK))
     await h.ctx.route('https://www.googleapis.com/calendar/v3/**',google_api)
     page=h.page
     try:
      await page.clock.set_fixed_time('2026-11-22T03:00:00Z')
      await h.login('news')
      await page.locator('[data-invest-calendar-trigger="true"]').click()
      modal=page.locator('.mcv2-modal')
      await modal.wait_for()
      # Official November market data without Google account.
      day=page.locator('[data-calendar-day="2026-11-27"]')
      await day.click()
      assert 'NYSE 조기폐장' in await modal.inner_text()
      assert '공식 발표 원문 보기' in await modal.inner_text()
      assert '마지막 확인 2026-11-22' in await modal.inner_text()
      assert await page.locator('.mcv2-event a[href*="nyse.com"]').count()>=1
      async with page.expect_download() as market_info:
       await page.locator('[data-market-ics-export]').click()
      market_file=await market_info.value
      assert market_file.suggested_filename=='myinvest-official-market-2026-11.ics'
      content=Path(await market_file.path()).read_text()
      assert 'BEGIN:VCALENDAR' in content
      assert 'NYSE' in content
      assert 'nyse.com/trade/hours-calendars' in content
      assert 'BEGIN:VEVENT' in content

      # Market visibility must be optional, not enforced in all contexts.
      await page.locator('[data-calendar-filter="holidays"]').click()
      assert 'NYSE 조기폐장' not in await modal.inner_text()
      await page.locator('[data-calendar-filter="holidays"]').click()
      assert 'NYSE 조기폐장' in await modal.inner_text()

      # Annual anniversaries are editable local records, not Google writes.
      await page.get_by_label('일정 날짜',exact=True).fill('2026-11-27')
      await page.get_by_label('일정 제목',exact=True).fill('연례 기념일')
      await page.get_by_label('일정 분류',exact=True).select_option('anniversary')
      await page.get_by_label('일정 반복',exact=True).select_option('yearly')
      await page.get_by_role('button',name='일정 저장',exact=True).click()
      stored=await page.evaluate('''()=>JSON.parse(localStorage.getItem("myinvest_events_manual_v1"))''')
      assert stored[0]['repeat']=='yearly'
      assert stored[0]['category']=='anniversary'

      # Google auth is explicitly click-based; no requests before.
      assert len(urls)==0
      await page.get_by_role('button',name='다음 달 ▶').click()
      assert '2026년 12월' in await modal.inner_text()
      assert await page.get_by_role('button',name='Google 읽기 전용 연결').is_enabled()
      await page.get_by_role('button',name='Google 읽기 전용 연결').click()
      await page.locator('[data-google-calendar-list] input[type="checkbox"]').first.wait_for()
      assert len(urls)==1 and '/users/me/calendarList' in urls[0]
      assert await page.get_by_label('대한민국의 휴일 일정 포함').is_checked()
      assert not await page.get_by_label('비공개 재정 일정 일정 포함').is_checked()
      await page.get_by_role('button',name='이 달 Google 일정 조회').click()
      await page.wait_for_function('()=>document.querySelector(".mcv2-modal")?.textContent.includes("Google 2/2개 캘린더")')
      assert len([u for u in urls if '/events?' in u])==2
      assert not any('private-finance' in u for u in urls),urls
      await page.locator('[data-calendar-day="2026-12-25"]').click()
      assert '기독탄신일' in await modal.inner_text()
      assert '대한민국의 휴일' in await modal.inner_text()
      assert '읽기 전용' in await modal.inner_text()
      # NYSE closure on same date remains a distinct, official US market event.
      assert 'NYSE 휴장' in await modal.inner_text()

      # Monthly cache and selected calendars do not cause automatic requests.
      requests=len(urls)
      await page.locator('[data-calendar-day="2026-12-15"]').click()
      assert len(urls)==requests
      await page.get_by_role('button',name='이 달 Google 일정 조회').click()
      await page.wait_for_function('()=>document.querySelector(".mcv2-modal")?.textContent.includes("Google 2/2개 캘린더")')
      assert len(urls)==requests

      await page.get_by_role('button',name='Google 연결 해제').click()
      assert not await page.evaluate('MYInvestCalendarWorkspaceV2.googleStatus().connected')
      await page.evaluate('logout()')
      await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
      assert await page.locator('.mcv2-modal').count()==0
      assert not h.errors,h.errors
      assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
      print(json.dumps({
       'width':width,'status':'PASS','officialNyseAndFomc':'PASS',
       'sourceLinks':'PASS','annualAnniversary':'PASS','googleList':'PASS',
       'subscribedKoreanHoliday':'PASS','privateCalendarsNotRead':'PASS',
       'calendarCache':'PASS','noGoogleWrites':True,
       'noNHOrders':True,'published':False
      },ensure_ascii=False),flush=True)
     finally:
      await h.close()
   finally:
    await browser.close()

if __name__=='__main__':
 asyncio.run(main())
