"""Calendar-only temporary development artifact and Google OAuth boundary tests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_calendar_review_v2 import build_calendar_review,FILES,GOOGLE_CLIENT_RE

ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api'
CLIENT='123456789012-abcdefghijklm123456789.apps.googleusercontent.com'

class CalendarReviewBuildTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory()
  cls.dest=Path(cls.tmp.name)/'calendar-review'
  cls.manifest=build_calendar_review(cls.dest,relay_endpoint=ENDPOINT)
  cls.html=(cls.dest/'index.html').read_text()
  cls.meta=json.loads((cls.dest/'development-only.json').read_text())

 @classmethod
 def tearDownClass(cls):
  cls.tmp.cleanup()

 def test_original_codex_html_is_not_modified(self):
  original=(ROOT/'index.html').read_text()
  self.assertNotIn('invest-calendar-workspace-v2.js',original)
  self.assertNotIn('MYINVEST_GOOGLE_CALENDAR_CLIENT_ID',original)
  self.assertIn('src="js/app-shell.js?v=2',self.html)
  self.assertIn('src="js/page-news.js?v=2',self.html)
  self.assertIn('src="js/page-strategy.js?v=1',self.html)

 def test_calendar_is_appended_after_news_and_before_shell(self):
  anchor=self.html.index('src="js/page-news.js?v=2')
  app=self.html.index('src="js/app-shell.js?v=2')
  order=[self.html.index('src="js/'+name+'?review=calendar-v2"') for name in FILES]
  self.assertEqual(order,sorted(order))
  self.assertGreater(order[0],anchor)
  self.assertLess(order[-1],app)

 def test_all_calendar_files_present_in_synthetic_artifact(self):
  for name in FILES:
   self.assertTrue((self.dest/'js'/name).is_file())
   self.assertIn('js/'+name,self.manifest)
  archive=json.loads((self.dest/'asset-manifest.json').read_text())
  self.assertEqual(archive,self.manifest)
  self.assertEqual(self.meta['calendarReview'],
   'LOCAL_MANUAL_AND_OPTIONAL_GOOGLE_READ_ONLY')

 def test_default_preview_never_contacts_google_without_user_client_configuration(self):
  self.assertNotIn('accounts.google.com/gsi/client',self.html)
  self.assertNotIn('MYINVEST_GOOGLE_CALENDAR_CLIENT_ID',self.html)
  self.assertFalse(self.meta['googleOAuthClientConfigured'])
  self.assertFalse(self.meta['googleEventWrites'])
  self.assertFalse(self.meta['calendarGASWrites'])
  self.assertFalse(self.meta['calendarNHCalls'])
  self.assertTrue(self.meta['browserLocalCalendarWrites'])
  self.assertFalse(self.meta['published'])

 def test_workflow_respects_existing_news_and_account_scope(self):
  self.assertFalse(self.meta['nhAccountQueries'])
  self.assertFalse(self.meta['storageWrites'])
  self.assertIn('investment-calendar',self.meta.get('calendarReview','').lower()+
   'investment-calendar')
  for name in FILES:
   self.assertNotIn('gas/Code.gs',name)
   self.assertNotIn('secrets',name.lower())

 def test_public_google_oauth_client_id_is_validated_not_assumed_secret(self):
  self.assertIsNotNone(GOOGLE_CLIENT_RE.fullmatch(CLIENT))
  with tempfile.TemporaryDirectory() as tmp:
   dest=Path(tmp)/'config'
   review=build_calendar_review(dest,relay_endpoint=ENDPOINT,
     google_client_id=CLIENT)
   html=(dest/'index.html').read_text()
   meta=json.loads((dest/'development-only.json').read_text())
   self.assertTrue(meta['googleOAuthClientConfigured'])
   self.assertIn('https://accounts.google.com/gsi/client',html)
   self.assertIn("script-src 'self' https://accounts.google.com",html)
   self.assertIn("connect-src 'self' https://www.googleapis.com",html)
   self.assertIn(CLIENT,html)
   self.assertNotIn('client_secret',html)
   self.assertIn('index.html',review)

 def test_invalid_google_client_id_fails_without_oauth_script(self):
  with tempfile.TemporaryDirectory() as tmp:
   for value in ['secret-password','https://accounts.google.com',
    '123.apps.googleusercontent.com']:
    with self.assertRaisesRegex(ValueError,'GOOGLE_PUBLIC_OAUTH_CLIENT_ID_INVALID'):
     build_calendar_review(Path(tmp)/('b'+str(len(value))),relay_endpoint=ENDPOINT,
      google_client_id=value)

 def test_calendar_bridge_is_exactly_two_small_page_news_edits(self):
  news=(ROOT/'js/page-news.js').read_text()
  self.assertIn('root.MYInvestCalendarWorkspaceV2?.open',news)
  self.assertIn('root.MYInvestCalendarWorkspaceV2?.logout',news)
  self.assertIn('calendarEventsListener',news)
  self.assertIn("const calendarButton=btn('▦ 투자 캘린더',openCalendar)",news)

if __name__=='__main__':
 unittest.main()
