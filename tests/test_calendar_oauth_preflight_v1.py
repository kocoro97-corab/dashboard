"""Offline OAuth readiness tests: local validation only, no Google consent."""
import sys
import tempfile
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from calendar_oauth_preflight_v1 import inspect,normalize_origin,EXPECTED_ORIGIN
from build_dev_pages import build

CLIENT='123456789012-abcdefghijklm123456789.apps.googleusercontent.com'

class CalendarOAuthReadiness(unittest.TestCase):
 def test_no_client_is_setup_required_not_connected(self):
  r=inspect()
  self.assertEqual(r['status'],'SETUP_REQUIRED')
  self.assertFalse(r['realGoogleAuthorizationVerified'])
  self.assertFalse(r['googleCloudOriginRegistrationVerified'])
  self.assertEqual(r['authorizedJavaScriptOriginToRegister'],EXPECTED_ORIGIN)
  self.assertFalse(r['googleCalendarWriteAuthorized'])

 def test_origin_must_be_only_site_origin_not_github_pages_path(self):
  self.assertIsNone(normalize_origin('https://kocoro97-corab.github.io/dashboard-v2-dev/'))
  self.assertIsNone(normalize_origin('https://accounts.google.com/secret'))
  self.assertEqual(normalize_origin(EXPECTED_ORIGIN+'/'),EXPECTED_ORIGIN)
  self.assertEqual(normalize_origin('http://localhost:8080'),'http://localhost:8080')
  self.assertIsNone(normalize_origin('http://evil.example'))
  self.assertIsNone(normalize_origin('https://x.example/#token'))
  self.assertEqual(inspect(origin='https://kocoro97-corab.github.io/dashboard-v2-dev/')['status'],
                   'INVALID_ORIGIN')

 def test_public_web_client_id_has_strict_shape_no_secrets(self):
  r=inspect(client_id=CLIENT)
  self.assertEqual(r['status'],'LOCAL_CONFIG_READY_LIVE_CONSENT_UNVERIFIED')
  self.assertEqual(r['googlePublicClientId'],'PUBLIC_ID_VALID_FORMAT')
  self.assertFalse(r['realGoogleAuthorizationVerified'])
  self.assertNotIn(CLIENT,str(r))
  self.assertEqual(len(r['requiredReadOnlyScopes']),2)
  self.assertTrue(all('readonly' in s for s in r['requiredReadOnlyScopes']))

 def test_invalid_oauth_id_is_rejected(self):
  for x in ('secret','google_oauth_client_secret','anything@gmail.com'):
   self.assertEqual(inspect(client_id=x)['status'],'INVALID_CLIENT_ID')

 def test_default_dev_build_does_not_embed_google_or_calendar_modules(self):
  with tempfile.TemporaryDirectory() as tmp:
   dest=Path(tmp)/'default';build(dest,use_public_config=False)
   r=inspect(html=dest/'index.html')
   self.assertEqual(r['status'],'SETUP_REQUIRED')
   self.assertEqual(r['browserBuildCheck'],'NO_OAUTH_DEFAULT_BUILD')
   self.assertNotIn('invest-calendar-workspace-v2.js',(dest/'index.html').read_text())

 def test_calendar_only_build_shows_local_calendar_without_real_oauth(self):
  with tempfile.TemporaryDirectory() as tmp:
   dest=Path(tmp)/'local'
   build(dest,use_public_config=False,include_calendar=True)
   html=(dest/'index.html').read_text()
   self.assertIn('invest-calendar-workspace-v2.js',html)
   self.assertEqual(inspect(html=html)['browserBuildCheck'],'NO_OAUTH_DEFAULT_BUILD')

 def test_with_public_id_development_build_contains_sdk_and_restricted_csp(self):
  with tempfile.TemporaryDirectory() as tmp:
   dest=Path(tmp)/'oauth'
   build(dest,use_public_config=False,include_calendar=True,
         google_calendar_client_id=CLIENT)
   r=inspect(client_id=CLIENT,html=dest/'index.html')
   self.assertEqual(r['status'],'LOCAL_CONFIG_READY_LIVE_CONSENT_UNVERIFIED')
   self.assertEqual(r['browserBuildCheck'],'OPTIONAL_GOOGLE_ASSETS_AND_CSP_PRESENT')
   doc=(dest/'index.html').read_text()
   self.assertIn('https://accounts.google.com/gsi/client',doc)
   self.assertIn('https://www.googleapis.com',doc)
   self.assertIn('invest-calendar-krx-official-v1.js',doc)
   self.assertIn('js/dev_session.js',doc)
   self.assertIn('five-minute-reference-panel-v1.js',doc)
   self.assertNotIn('client_secret',doc)

 def test_oauth_enabled_but_sdk_or_csp_missing_cannot_be_called_ready(self):
  r=inspect(client_id=CLIENT,html='<script>window.MYINVEST_GOOGLE_CALENDAR_CLIENT_ID="x";</script>')
  self.assertEqual(r['status'],'BUILD_MISMATCH')
  self.assertEqual(r['browserBuildCheck'],'MISMATCH_REQUIRES_REBUILD')

 def test_preflight_never_performs_live_google_network_or_order_operations(self):
  text=(ROOT/'tools/calendar_oauth_preflight_v1.py').read_text()
  for forbidden in ('requests.get(', 'urllib.request', 'httpx.', 'fetch(',
                    'Authorization: Bearer', 'refresh_token=', 'NH_ACCOUNT', 'executeOrder('):
   self.assertNotIn(forbidden,text)

if __name__=='__main__':
 unittest.main()
