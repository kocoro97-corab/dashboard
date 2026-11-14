"""Narrow owner-run check: one balance request, no writes or raw data reports."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from nh_v2_live_check import verify_account_inquiry

class Web:
    def __init__(self):
        self.token=None;self.calls=[];self.admin=True;self.fail_logout=False
        self.result={'gatewayVersion':2,'accounts':[{'accountKey':'a'*64,'errors':[],
            'domestic':{'partial':False,'holdings':[{'code':'035720','currency':'KRW','quantity':2,'name':'SYNTHETIC_PRIVATE_CANARY'}]},
            'overseas':{'partial':False,'holdings':[]}}]}
    def call(self,action,**fields):
        self.calls.append(action)
        if action=='login':return {'token':'b'*64,'isAdmin':self.admin}
        if action=='nhAccounts':return copy.deepcopy(self.result)
        if action=='logout':
            if self.fail_logout:raise RuntimeError('SYNTHETIC_PRIVATE_CANARY')
            return {'success':True}
        raise AssertionError('FORBIDDEN_ACTION')

class InquiryTests(unittest.TestCase):
    def test_exact_read_only_actions_and_sanitized_report(self):
        web=Web();report=verify_account_inquiry(web,'synthetic','private')
        self.assertEqual(report['status'],'PASS')
        self.assertEqual(web.calls,['login','nhAccounts','logout'])
        self.assertIsNone(web.token)
        self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',json.dumps(report))
        self.assertFalse(report['accountStoreWrites'])
        self.assertFalse(report['publicRelayUsed'])
    def test_non_admin_never_requests_balances(self):
        web=Web();web.admin=False
        self.assertEqual(verify_account_inquiry(web,'synthetic','private')['status'],'FAIL')
        self.assertNotIn('nhAccounts',web.calls)
    def test_partial_missing_currency_and_duplicate_identity_fail(self):
        for change in ('partial','currency','identity','errors'):
            with self.subTest(change=change):
                web=Web();account=web.result['accounts'][0]
                if change=='partial':account['domestic']['partial']=True
                elif change=='currency':account['domestic']['holdings'][0]['currency']=None
                elif change=='identity':web.result['accounts'].append(copy.deepcopy(account))
                else:account['errors']=['SYNTHETIC_PRIVATE_CANARY']
                report=verify_account_inquiry(web,'synthetic','private')
                self.assertEqual(report['status'],'FAIL')
                self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',json.dumps(report))
    def test_logout_failure_is_reported_and_token_cleared(self):
        web=Web();web.fail_logout=True
        self.assertEqual(verify_account_inquiry(web,'synthetic','private')['code'],'LOGOUT_FAILED')
        self.assertIsNone(web.token)

if __name__=='__main__':unittest.main()
