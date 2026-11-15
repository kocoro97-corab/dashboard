"""Default-off account capability and fixed synthetic-only store protection."""
import hashlib
import json
from pathlib import Path
import threading

READS=frozenset({'nhAccounts','nhExternalQuotes','externalHoldings','externalHistory','externalAccounts'})
WRITES=frozenset({'saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'})
FIXTURE=Path(__file__).resolve().parents[1]/'data/account-test-holdings.json'

class AccountPolicyError(Exception):pass

def canonical(row):return json.dumps(row,sort_keys=True,ensure_ascii=False,separators=(',',':'))

class TestStoreGuard:
    def __init__(self,user):
        self.user=user
        self.allowed=frozenset(canonical(row) for row in json.loads(FIXTURE.read_text()))
        self.tokens=set();self.lock=threading.Lock()

    def observe(self,payload,result):
        token=result.get('token') if payload.get('action')=='login' else payload.get('token')
        if not isinstance(token,str):return
        digest=hashlib.sha256(token.encode()).digest()
        with self.lock:
            if payload.get('action')=='logout':self.tokens.discard(digest)
            elif result.get('success') is True and result.get('isAdmin') is True and payload.get('user')==self.user:
                if len(self.tokens)>=128:raise AccountPolicyError('TEST_STORE_SESSION_LIMIT')
                self.tokens.add(digest)

    def safe_rows(self,rows):
        return isinstance(rows,list) and len(rows)<=len(self.allowed) and len({canonical(row) for row in rows})==len(rows) and all(canonical(row) in self.allowed for row in rows)

    def authorize(self,payload,gateway):
        digest=hashlib.sha256(payload['token'].encode()).digest()
        with self.lock:bound=digest in self.tokens
        if not bound:raise AccountPolicyError('TEST_STORE_USER_REQUIRED')
        session=gateway.post({'action':'sessionInfo','token':payload['token']})
        if session.get('success') is not True or session.get('isAdmin') is not True or session.get('mustChangePassword'):raise AccountPolicyError('AUTH_REQUIRED')
        if payload.get('confirmReplace') is not True or not isinstance(payload.get('expectedRevision'),str):raise AccountPolicyError('TEST_STORE_REVIEW_REQUIRED')
        if payload['action']=='saveExternalHoldings' and not self.safe_rows(payload.get('holdings')):raise AccountPolicyError('TEST_STORE_SYNTHETIC_ONLY')
        current=gateway.post({'action':'externalHoldings','token':payload['token']})
        history=gateway.post({'action':'externalHistory','token':payload['token']})
        if current.get('success') is not True or history.get('success') is not True or current.get('storeVersion')!=2:raise AccountPolicyError('TEST_STORE_STATE_UNCONFIRMED')
        if current.get('revision')!=payload['expectedRevision']:raise AccountPolicyError('STORE_CONFLICT')
        snapshots=history.get('history')
        if not self.safe_rows(current.get('holdings')) or not isinstance(snapshots,list) or any(not isinstance(x,dict) or not self.safe_rows(x.get('holdings')) for x in snapshots):raise AccountPolicyError('TEST_STORE_EXISTING_DATA_PROTECTED')
        if payload['action']=='restoreExternalHoldings' and not any(x.get('snapshotId')==payload.get('snapshotId') for x in snapshots):raise AccountPolicyError('STORE_NOT_FOUND')

def validate_payload(payload):
    action=payload['action'];keys={'action','token'}
    if action=='nhExternalQuotes':
        import re
        keys.add('codes');codes=payload.get('codes')
        if not isinstance(codes,list) or not 1<=len(codes)<=40 or any(not isinstance(x,str) or not re.fullmatch('[A-Z0-9]{6}',x) for x in codes):raise AccountPolicyError('INVALID_CODES')
    elif action=='saveExternalHoldings':keys|={'holdings','expectedRevision','confirmReplace'}
    elif action=='restoreExternalHoldings':keys|={'snapshotId','expectedRevision','confirmReplace'}
    elif action=='saveExternalAccounts':keys|={'accounts','brokers','expectedRevision','confirmReplace'}
    if action=='saveExternalHoldings' and type(payload.get('externalAccountsVersion')) is int and payload['externalAccountsVersion']==1:keys.add('externalAccountsVersion')
    if set(payload)!=keys:raise AccountPolicyError('RELAY_BAD_REQUEST')
