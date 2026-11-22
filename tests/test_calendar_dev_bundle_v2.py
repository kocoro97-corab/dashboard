"""Opt-in calendar integration in the LATEST existing developer artifact builder.

A normal development build must remain byte-compatible with the previous
builder contract; calendar and Google OAuth are included only by explicit
arguments. This test never visits Google or releases a Pages artifact.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build,CALENDAR_MODULES
from build_calendar_review_v2 import build_calendar_review

GOOGLE_ID='123456789012-abcdefghijklm123456789.apps.googleusercontent.com'

class CalendarIntegratedDeveloperBundleTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory()
  path=Path(cls.temp.name)
  cls.plain=path/'plain'
  cls.calendar=path/'calendar'
  cls.baseline_manifest=build(cls.plain,use_public_config=False)
  cls.calendar_manifest=build(cls.calendar,use_public_config=False,include_calendar=True)
  cls.baseline_html=(cls.plain/'index.html').read_text()
  cls.calendar_html=(cls.calendar/'index.html').read_text()

 @classmethod
 def tearDownClass(cls):
  cls.temp.cleanup()

 def test_default_developer_build_keeps_calendar_off(self):
  self.assertNotIn('invest-calendar-core-v2.js',self.baseline_html)
  self.assertNotIn('invest-calendar-workspace-v2.js',self.baseline_html)
  self.assertNotIn('MYINVEST_GOOGLE_CALENDAR_CLIENT_ID',self.baseline_html)
  self.assertNotIn('calendarReview',json.loads((self.plain/'development-only.json').read_text()))
  self.assertEqual(self.baseline_html.count('src="js/page-news.js?v=2'),1)

 def test_real_developer_builder_loads_calendar_once_before_shell(self):
  start=self.calendar_html.index('src="js/page-news.js?v=2')
  end=self.calendar_html.index('src="js/app-shell.js?v=2')
  order=[self.calendar_html.index('src="js/'+name+'?calendar=v2')
         for name in CALENDAR_MODULES]
  self.assertEqual(order,sorted(order))
  self.assertTrue(all(start<x<end for x in order))
  for name in CALENDAR_MODULES:
   self.assertEqual(self.calendar_html.count('src="js/'+name+'?calendar=v2'),1)
   self.assertTrue((self.calendar/'js'/name).is_file())
   self.assertIn('js/'+name,self.calendar_manifest)

 def test_default_artifact_other_files_equal_optional_artifact(self):
  original=set(self.baseline_manifest)
  optional=set(self.calendar_manifest)
  self.assertEqual(optional-original,set('js/'+name for name in CALENDAR_MODULES))
  for path in original:
   if path in {'index.html','development-only.json'}:
    continue
   self.assertEqual(self.baseline_manifest[path],self.calendar_manifest[path],path)
  self.assertEqual((self.plain/'js/page-strategy.js').read_bytes(),
                   (self.calendar/'js/page-strategy.js').read_bytes())
  self.assertEqual((self.plain/'js/app-shell.js').read_bytes(),
                   (self.calendar/'js/app-shell.js').read_bytes())

 def test_calendar_data_shares_old_local_events_without_google_writes(self):
  code=(self.calendar/'js/page-news.js').read_text()
  self.assertIn("const EVENT_KEY='myinvest_events_manual_v1'",code)
  self.assertIn('MYInvestCalendarWorkspaceV2?.open',code)
  self.assertIn("myinvest:calendar-changed",code)
  meta=json.loads((self.calendar/'development-only.json').read_text())
  self.assertEqual(meta['calendarReview'],'LOCAL_MANUAL_AND_OPTIONAL_GOOGLE_READ_ONLY')
  self.assertFalse(meta['googleOAuthClientConfigured'])
  self.assertFalse(meta['googleEventWrites'])
  self.assertTrue(meta['browserLocalCalendarWrites'])
  self.assertFalse(meta['calendarGASWrites'])
  self.assertFalse(meta['calendarNHCalls'])
  self.assertFalse(meta['published'])

 def test_google_oauth_not_enabled_by_default(self):
  # Opt-in calendar builds allow Google domains in CSP, but load no SDK
  # until a user explicitly supplies a public ID and clicks prepare.
  self.assertNotIn('<script src="https://accounts.google.com/gsi/client"',self.calendar_html)
  self.assertNotIn('MYINVEST_GOOGLE_CALENDAR_CLIENT_ID=',self.calendar_html)
  self.assertIn("script-src 'self' https://accounts.google.com",self.calendar_html)
  self.assertIn("connect-src 'self' https://www.googleapis.com",self.calendar_html)
  self.assertIn("form-action 'none'",self.calendar_html)
  self.assertIn("base-uri 'none'",self.calendar_html)

 def test_optional_public_google_oauth_id_tightly_limits_csp(self):
  with tempfile.TemporaryDirectory() as tmp:
   output=Path(tmp)/'google'
   manifest=build(output,use_public_config=False,include_calendar=True,
                  google_calendar_client_id=GOOGLE_ID)
   doc=(output/'index.html').read_text()
   meta=json.loads((output/'development-only.json').read_text())
   self.assertEqual(meta['googleScope'],'calendar.events.readonly')
   self.assertTrue(meta['googleOAuthClientConfigured'])
   self.assertIn('https://accounts.google.com/gsi/client',doc)
   self.assertIn('https://www.googleapis.com',doc)
   self.assertIn(GOOGLE_ID,doc)
   self.assertNotIn('client_secret',doc)
   self.assertIn('index.html',manifest)

 def test_google_oauth_rejected_when_calendar_bundle_is_off(self):
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(ValueError,'GOOGLE_OAUTH_REQUIRES_CALENDAR_PREVIEW'):
    build(Path(tmp)/'invalid',use_public_config=False,
          google_calendar_client_id=GOOGLE_ID)

 def test_google_client_rejected_when_invalid(self):
  for value in ('not-a-client','https://accounts.google.com','secret'):
   with tempfile.TemporaryDirectory() as tmp:
    with self.assertRaisesRegex(ValueError,'GOOGLE_PUBLIC_OAUTH_CLIENT_ID_INVALID'):
     build(Path(tmp)/'invalid',use_public_config=False,include_calendar=True,
           google_calendar_client_id=value)

 def test_existing_wrapper_uses_single_dev_builder_and_equivalent_assets(self):
  with tempfile.TemporaryDirectory() as tmp:
   temp=Path(tmp)/'wrapped'
   wrapped=build_calendar_review(temp)
   self.assertEqual(set(wrapped),set(self.calendar_manifest))
   # Dynamic source SHA is the same in this test run; output should match.
   for key in wrapped:
    self.assertEqual(wrapped[key],self.calendar_manifest[key],key)

 def test_no_live_calendar_or_broker_in_developer_artifact(self):
  self.assertNotIn('gas/Code.gs',self.calendar_manifest)
  self.assertNotIn('secrets.json',self.calendar_manifest)
  self.assertFalse(any('token' in p.lower() for p in self.calendar_manifest))
  self.assertNotIn('NH_ACCOUNT', (self.calendar/'js/invest-calendar-google-readonly-v2.js').read_text())

if __name__=='__main__':
 unittest.main()
