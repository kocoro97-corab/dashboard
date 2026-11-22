"""MY INVEST V2 — browser-only OAuth self-setup with no prebuilt Google ID.

Google SDK + Calendar API are intercepted with fake data. This proves the
optional developer page can collect a PUBLIC client ID at runtime and trigger
consent on a second explicit click. No real Google/NH/Sheets or deployment.
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

PUBLIC_ID='123456789012-abcdefghijklm123456789.apps.googleusercontent.com'
HOLIDAY='ko.south_korea#holiday@group.v.calendar.google.com'
SDK="""window.google={accounts:{oauth2:{
 initTokenClient:(options)=>({
  requestAccessToken:()=>{
   window.__mockGoogleReadScopes=options.scope;
   options.callback({access_token:'ya29.synthetic_google_calendar_test_0123456789',expires_in:1800});
  }
 }),
 revoke:(token,callback)=>callback()
}}};"""

async def main():
 with tempfile.TemporaryDirectory() as folder:
  output=Path(folder)/'calendar-dev'
  build_calendar_review(output,relay_endpoint=ENDPOINT)
  src=(output/'index.html').read_text()
  assert 'https://accounts.google.com/gsi/client' not in src
  assert 'MYINVEST_GOOGLE_CALENDAR_CLIENT_ID=' not in src
  assert "script-src 'self' https://accounts.google.com" in src
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in (1440,344):
     h=await Harness(browser,output,synthetic_feeds(),width).start_browser(folder)
     urls=[]
     oauth_scripts=[]
     async def oauth_script(route):
      oauth_scripts.append(route.request.url)
      await route.fulfill(status=200,content_type='application/javascript',body=SDK)
     async def api(route):
      url=route.request.url
      urls.append(url)
      if '/users/me/calendarList' in url:
       payload={'items':[
        {'id':'owner@example.com','summary':'기본 캘린더',
         'primary':True,'accessRole':'owner'},
        {'id':HOLIDAY,'summary':'대한민국의 휴일',
         'primary':False,'accessRole':'reader'},
        {'id':'nonselected@example.com','summary':'민감한 개인 일정',
         'primary':False,'accessRole':'owner'}]}
      elif '/calendars/primary/events?' in url:
       payload={'items':[{'id':'p','summary':'일반 약속',
        'start':{'date':'2026-12-15'},'status':'confirmed'}]}
      elif 'holiday' in url:
       payload={'items':[{'id':'h','summary':'기독탄신일',
        'start':{'date':'2026-12-25'},'status':'confirmed'}]}
      else:
       payload={'items':[]}
      await route.fulfill(status=200,content_type='application/json',
       body=json.dumps(payload))
     await h.ctx.route('https://accounts.google.com/gsi/client',oauth_script)
     await h.ctx.route('https://www.googleapis.com/calendar/v3/**',api)
     page=h.page
     try:
      await page.clock.set_fixed_time('2026-11-22T03:00:00Z')
      await h.login('news')
      await page.locator('[data-invest-calendar-trigger="true"]').click()
      modal=page.locator('.mcv2-modal')
      await modal.wait_for()
      await page.get_by_role('button',name='다음 달 ▶').click()
      assert '2026년 12월' in await modal.inner_text()
      assert await page.get_by_role('button',name='Google 읽기 전용 연결').is_disabled()
      assert not oauth_scripts and not urls
      await page.locator('[data-google-oauth-config] summary').click()
      field=page.get_by_label('Google 공개 OAuth 클라이언트 ID')
      await field.fill('client_secret_is_not_a_public_id')
      await page.get_by_role('button',name='설정 적용·Google SDK 준비').click()
      assert 'GOOGLE_PUBLIC_WEB_CLIENT_ID_INVALID' in await modal.inner_text()
      assert not oauth_scripts and not urls
      assert await page.get_by_role('button',name='Google 읽기 전용 연결').is_disabled()
      # User explicitly supplies the PUBLIC OAuth ID in the developer UI.
      await page.locator('[data-google-oauth-config] summary').click()
      await page.get_by_label('Google 공개 OAuth 클라이언트 ID').fill(PUBLIC_ID)
      await page.get_by_role('button',name='설정 적용·Google SDK 준비').click()
      await page.wait_for_function(
       '()=>document.querySelector(".mcv2-modal")?.textContent.includes("공개 웹 OAuth ID 설정을 확인")')
      assert len(oauth_scripts)==1
      assert len(urls)==0
      assert await page.get_by_role('button',name='Google 읽기 전용 연결').is_enabled()
      assert not await page.evaluate('MYInvestCalendarWorkspaceV2.googleStatus().connected')
      # Actual consent would happen HERE; the browser test intercepts OAuth.
      await page.get_by_role('button',name='Google 읽기 전용 연결').click()
      await page.locator('[data-google-calendar-list] input[type="checkbox"]').first.wait_for()
      scopes=await page.evaluate('window.__mockGoogleReadScopes')
      assert 'calendar.events.readonly' in scopes
      assert 'calendar.calendarlist.readonly' in scopes
      assert not any('calendar.events ' in scope for scope in scopes.split(' '))
      assert len(urls)==1 and '/users/me/calendarList' in urls[0]
      assert await page.get_by_label('대한민국의 휴일 일정 포함').is_checked()
      assert not await page.get_by_label('민감한 개인 일정 일정 포함').is_checked()
      await page.get_by_role('button',name='이 달 Google 일정 조회').click()
      await page.wait_for_function('()=>document.querySelector(".mcv2-modal")?.textContent.includes("Google 2/2개")')
      assert len([x for x in urls if '/events?' in x])==2
      assert not any('nonselected' in x for x in urls)
      await page.locator('[data-calendar-day="2026-12-25"]').click()
      assert '기독탄신일' in await modal.inner_text()
      assert 'NYSE 휴장' in await modal.inner_text()
      # User identity and token must not be stored alongside manual events.
      storage=await page.evaluate('()=>Object.entries(localStorage)')
      assert all(PUBLIC_ID not in str(x) and 'synthetic_google_calendar_test' not in str(x)
                 for x in storage)
      assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
      await page.evaluate('logout()')
      await page.wait_for_function('()=>DashboardShell.getStatus().page===null')
      assert not await page.evaluate('MYInvestCalendarWorkspaceV2.googleStatus().connected')
      assert len(oauth_scripts)==1
      assert not h.errors,h.errors
      print(json.dumps({'width':width,'status':'PASS',
       'runtimePublicOAuthId':'PASS','sdkRequestsBeforeUserGesture':0,
       'sdkRequestsAfterExplicitApply':1,'fakeGoogleConsent':'PASS',
       'holidaySubscription':'PASS','privateCalendarReads':0,
       'browserCredentialStorage':0,'logoutCleanup':'PASS',
       'realGoogleCalls':0,'realNHCalls':0,'published':False},
       ensure_ascii=False),flush=True)
     finally:
      await h.close()
   finally:
    await browser.close()

if __name__=='__main__':
 asyncio.run(main())
