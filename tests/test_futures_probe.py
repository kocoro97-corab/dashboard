import unittest,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from nh_v2_futures_probe import verify,validate_quote,Stop
from nh_staging_test import fingerprint
PLAN={'scriptId':'SYNTHETIC_ISOLATED_SCRIPT_123456','sheetHash':'b'*64,'sourceDigest':'c'*64}
class Client:
 def __init__(self):self.calls=[];self.token=None
 def call(self,action,**fields):
  self.calls.append(action)
  if action=='appVersion':return {'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fingerprint(PLAN['scriptId']),'sheetHash':PLAN['sheetHash'],'sourceDigest':PLAN['sourceDigest'],'gatewayVersion':2,'storeEngine':'account-store-v2'}
  if action=='login':return {'token':'a'*64}
  if action=='nhQuotes':return {'data':{'k4':quote()}}
  if action=='logout':return {'success':True}
  raise AssertionError('unexpected action')
def quote():return {'p':1500,'prev':1490,'name':'코스닥150 선물','code':'A066C000','expiry':'20991210','contractVerified':True,'observedAt':time.time()*1000-30000}
class Tests(unittest.TestCase):
 def test_one_future_inquiry_no_account_or_order_or_write(self):
  c=Client();r=verify(c,PLAN,lambda:('SYNTHETIC','SYNTHETIC_SECRET'));self.assertEqual(r['status'],'PARTIAL');self.assertEqual(c.calls,['appVersion','login','nhQuotes','logout']);self.assertEqual(r['orderCalls'],0);self.assertEqual(r['accountCalls'],0);self.assertNotIn('SYNTHETIC_SECRET',str(r));self.assertIsNone(c.token)
 def test_wrong_metadata_stops_before_credentials(self):
  c=Client();r=verify(c,{**PLAN,'sheetHash':'WRONG'},lambda:self.fail('credentials requested before proof'));self.assertEqual(c.calls,['appVersion']);self.assertEqual(r['code'],'ISOLATION_NOT_VERIFIED')
 def test_undated_old_invalid_and_wrong_contract_fail(self):
  for change in [{'observedAt':None},{'observedAt':time.time()*1000-5*86400000},{'expiry':'20260230'},{'code':'A016C000'},{'p':float('nan')}]:
   with self.assertRaises(Stop):validate_quote({**quote(),**change})
if __name__=='__main__':unittest.main()
