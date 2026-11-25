"""Owner-only restoration of the original empty fresh-test baseline; journal retained.
No NH calls, code deployment, old/production resources or property changes.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

from nh_v2_fresh import private_path
from nh_v2_live_check import preflight
from nh_staging_test import ApiFailure, SAFE_REPORT_CODES

class Stop(Exception):
    pass


def same_state(a,b):
    return all(a.get(k)==b.get(k) for k in ('accounts','revision','history'))


def backup_snapshot(directory,state):
    # New private directory each time. No existing file or backup is overwritten.
    root=private_path(directory,False)/('baseline-backup-'+uuid.uuid4().hex)
    root.mkdir(mode=0o700)
    raw=json.dumps(state,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()
    digest=hashlib.sha256(raw).hexdigest()
    for name,data in [('snapshot-before.json',raw),('sha256.txt',(digest+'\n').encode())]:
        fd=os.open(root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as output:
            output.write(data);output.flush();os.fsync(output.fileno())
    stored=(root/'snapshot-before.json').read_bytes()
    if hashlib.sha256(stored).hexdigest()!=digest or (root/'sha256.txt').read_text().strip()!=digest or json.loads(stored)!=state:
        raise Stop('PRIVATE_SNAPSHOT_BACKUP_FAILED')
    return root


def initial_empty_record(state):
    history=state.get('history')
    if not state.get('accounts') or not isinstance(history,list) or len(history)!=1:
        raise Stop('ORIGINAL_CAPTURE_REQUIRED')
    record=history[0]
    if not (isinstance(record.get('snapshotId'),str) and record['snapshotId'] and record.get('reason')=='nh-read-snapshot' and record.get('holdings')==[] and state.get('revision')=='v2:'+record['snapshotId']):
        raise Stop('ORIGINAL_EMPTY_BASELINE_NOT_PROVEN')
    return record


def restored_state(before,after):
    history=after.get('history')
    if not isinstance(history,list) or len(history)!=2 or not isinstance(after.get('revision'),str):return False
    latest=history[0]
    return (after.get('accounts')==[] and latest.get('reason')=='restore'
            and isinstance(latest.get('snapshotId'),str) and bool(latest['snapshotId'])
            and after['revision']=='v2:'+latest['snapshotId'] and after['revision']!=before['revision']
            and latest.get('holdings')==before['accounts'] and history[1]==before['history'][0])


def restore_initial_baseline(web,directory,username,password):
    report={'mode':'FRESH_TEST_INITIAL_BASELINE_RESTORE','status':'FAIL','backup':'NOT_RUN',
            'storageWriteAttempted':False,'storageWrites':False,'nhRequested':False,'orderCalls':0,
            'rawFinancialDataIncluded':False,'ownerRecoveryRequired':False}
    before=None;attempted=False
    try:
        login=web.call('login',**{'user':username,'pass':password});web.token=login.get('token')
        if not web.token or not login.get('isAdmin') or login.get('mustChangePassword'):raise Stop('DEDICATED_FRESH_ADMIN_REQUIRED')
        before=web.call('nhSnapshotRead');record=initial_empty_record(before)
        backup_snapshot(directory,before);report['backup']='PASS'
        if not same_state(before,web.call('nhSnapshotRead')):raise Stop('CONCURRENT_SNAPSHOT_CHANGE')
        attempted=True;report.update(storageWriteAttempted=True,storageWrites='UNCONFIRMED',ownerRecoveryRequired=True)
        # Exactly one restore. Optimistic revision check prevents intervening writes.
        result=web.call('nhSnapshotRestore',snapshotId=record['snapshotId'],expectedRevision=before['revision'],confirmReplace=True)
        after=web.call('nhSnapshotRead')
        if not restored_state(before,after) or result.get('revision')!=after.get('revision'):
            raise Stop('RESTORE_READBACK_FAILED')
        report.update(status='PASS',storageWrites=True,activeEmptyBaselineRestored=True,
                      realSnapshotRetainedInHistory=True,originalHistoryRetained=True,ownerRecoveryRequired=False)
    except Exception as error:
        safe={'DEDICATED_FRESH_ADMIN_REQUIRED','ORIGINAL_CAPTURE_REQUIRED','ORIGINAL_EMPTY_BASELINE_NOT_PROVEN','PRIVATE_SNAPSHOT_BACKUP_FAILED','CONCURRENT_SNAPSHOT_CHANGE','RESTORE_READBACK_FAILED'}
        code=error.code if isinstance(error,ApiFailure) and error.code in SAFE_REPORT_CODES else str(error) if isinstance(error,Stop) and str(error) in safe else 'FRESH_BASELINE_RESTORE_FAILED'
        report['code']=code
        if attempted and before is not None:
            try:
                after=web.call('nhSnapshotRead')
                if same_state(before,after):
                    report.update(storageWrites=False,storedSnapshotUnchanged=True,ownerRecoveryRequired=False)
                elif restored_state(before,after):
                    # A lost acknowledgement must not cause a second restore.
                    report.update(storageWrites=True,activeEmptyBaselineRestored=True,realSnapshotRetainedInHistory=True,originalHistoryRetained=True)
            except Exception:
                pass
    finally:
        if web.token:
            try:web.call('logout')
            except Exception:report.update(status='FAIL',code='LOGOUT_FAILED')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment',type=Path,required=True)
    parser.add_argument('--restore-initial-empty-baseline',action='store_true',help='Explicitly restore the fresh initial empty active state, keeping private backup and journal')
    args=parser.parse_args()
    if not args.restore_initial_empty_baseline:
        print(json.dumps({'status':'NOT_RUN','code':'EXPLICIT_FRESH_RESTORE_REQUIRED','storageWrites':False,'nhRequested':False,'orderCalls':0}));return 2
    try:
        web=preflight(args.environment,allow_same_source_tools=True)
        if not sys.stdin.isatty():raise Stop('OWNER_PRIVATE_TERMINAL_REQUIRED')
        username=input('Fresh staging user (visible): ').strip();password=getpass.getpass('Fresh staging password (hidden): ')
        if not username or len(password)<16:raise Stop('STRONG_PRIVATE_CREDENTIALS_REQUIRED')
        report=restore_initial_baseline(web,args.environment,username,password)
    except Exception:
        report={'status':'NOT_RUN','code':'FRESH_RESTORE_PREFLIGHT_OR_AUTH_REQUIRED','storageWrites':False,'nhRequested':False,'orderCalls':0,'rawFinancialDataIncluded':False}
    print(json.dumps(report));return 0 if report['status']=='PASS' else 2

if __name__=='__main__':raise SystemExit(main())
