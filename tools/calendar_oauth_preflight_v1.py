"""MY INVEST V2 Google Calendar OAuth readiness check (NO NETWORK/LOGIN).

Does not request or store user tokens. A public OAuth web Client ID is
optional. An origin must be entered under Google Cloud's "Authorized
JavaScript origins"; an OAuth redirect URI or path is not an origin.
This script cannot confirm Google's actual registration or live consent.
"""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ID_RE=re.compile(r'^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$')
EXPECTED_ORIGIN='https://kocoro97-corab.github.io'
SCOPES=(
 'https://www.googleapis.com/auth/calendar.events.readonly',
 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
)
def normalize_origin(text):
 if not isinstance(text,str) or not text:return None
 try:u=urlsplit(text)
 except ValueError:return None
 if u.username or u.password or u.query or u.fragment:return None
 if u.path not in ('','/'):return None
 if u.scheme=='https' and u.hostname and u.port in (None,443):
  return 'https://'+u.hostname.lower()
 if u.scheme=='http' and u.hostname in ('localhost','127.0.0.1') and u.port:
  return 'http://'+u.hostname+':'+str(u.port)
 return None

def inspect(*,client_id=None,origin=EXPECTED_ORIGIN,html=None):
 normalized=normalize_origin(origin)
 identity='MISSING' if not client_id else (
  'PUBLIC_ID_VALID_FORMAT' if isinstance(client_id,str)
  and ID_RE.fullmatch(client_id) else 'INVALID_FORMAT')
 if not normalized:
  state='INVALID_ORIGIN'
 elif identity=='INVALID_FORMAT':
  state='INVALID_CLIENT_ID'
 elif identity=='MISSING':
  state='SETUP_REQUIRED'
 else:
  state='LOCAL_CONFIG_READY_LIVE_CONSENT_UNVERIFIED'
 html_result='NOT_PROVIDED'
 if html is not None:
  if isinstance(html,Path):html=html.read_text()
  has_client='MYINVEST_GOOGLE_CALENDAR_CLIENT_ID' in html
  has_sdk='https://accounts.google.com/gsi/client' in html
  has_csp="script-src 'self' https://accounts.google.com" in html and (
   "connect-src 'self' https://www.googleapis.com" in html)
  if identity=='PUBLIC_ID_VALID_FORMAT' and all((has_client,has_sdk,has_csp)):
   html_result='OPTIONAL_GOOGLE_ASSETS_AND_CSP_PRESENT'
  elif identity=='MISSING' and not has_client and not has_sdk:
   html_result='NO_OAUTH_DEFAULT_BUILD'
  else:
   html_result='MISMATCH_REQUIRES_REBUILD'
  if html_result=='MISMATCH_REQUIRES_REBUILD':state='BUILD_MISMATCH'
 return {
  'status':state,
  'authorizedJavaScriptOriginToRegister':normalized,
  'sitePathIsNotAnOAuthOrigin':True,
  'expectedDevelopmentSite':'https://kocoro97-corab.github.io/dashboard-v2-dev/',
  'googlePublicClientId':identity,
  'requiredReadOnlyScopes':list(SCOPES),
  'browserBuildCheck':html_result,
  'realGoogleAuthorizationVerified':False,
  'googleCloudOriginRegistrationVerified':False,
  'userTokenObserved':False,
  'googleCalendarWriteAuthorized':False,
  'steps':[
   'Google Cloud에서 Calendar API를 활성화하고 OAuth 동의화면/테스트사용자를 설정',
   '웹 애플리케이션 OAuth 클라이언트를 만들고 위 JavaScript origin을 정확히 등록',
   '공개 OAuth client ID만 --google-calendar-client-id 옵션으로 개발 빌드에 제공',
   '실제 웹사이트의 Google 읽기 전용 연결 버튼에서 사용자가 직접 동의',
   '휴일 구독 캘린더를 선택해 해당 월 일정을 조회하고 실패 코드/COOP·CSP 점검',
  ]
 }

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--client-id',help='Public Google Web OAuth client ID; NEVER a secret/token')
 p.add_argument('--origin',default=EXPECTED_ORIGIN)
 p.add_argument('--build-index',type=Path,help='Optional developer build index.html for offline CSP validation')
 a=p.parse_args()
 try:r=inspect(client_id=a.client_id,origin=a.origin,html=a.build_index)
 except (OSError,ValueError) as e:
  p.error('Unable to inspect supplied development index.html')
 print(json.dumps(r,ensure_ascii=False,indent=2))
 if r['status'] in ('INVALID_ORIGIN','INVALID_CLIENT_ID','BUILD_MISMATCH'):
  return 2
 return 0

if __name__=='__main__':
 raise SystemExit(main())
