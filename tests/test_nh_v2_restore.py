import copy
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from test_nh_v2_fresh import FakeWeb

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import nh_v2_restore as restore
from nh_staging_test import ApiFailure

class Store(FakeWeb):
    def __init__(self):
        super().__init__();super().call('nhSnapshotCapture');self.rev='v2:synthetic-before';self.history[0]['reason']='nh-read-snapshot';self.calls=[]
    def call(self,action,**fields):
        if action!='nhSnapshotRestore':return super().call(action,**fields)
        self.calls.append(action)
        assert fields=={'snapshotId':'synthetic-before','expectedRevision':'v2:synthetic-before','confirmReplace':True}
        self.history.insert(0,{'snapshotId':'synthetic-restored','reason':'restore','holdings':copy.deepcopy(self.accounts)})
        self.accounts=[];self.rev='v2:synthetic-restored';return {'success':True,'revision':self.rev}

class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.directory=Path(self.tmp.name)
        p=patch.object(restore,'private_path',side_effect=lambda path,new:Path(path));p.start();self.addCleanup(p.stop)
    def run_restore(self,web):return restore.restore_initial_baseline(web,self.directory,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
    def test_one_restore_keeps_private_backup_and_actual_snapshot_history(self):
        web=Store();before=copy.deepcopy(web.accounts);r=self.run_restore(web)
        self.assertEqual(r['status'],'PASS');self.assertTrue(r['storageWrites']);self.assertFalse(r['ownerRecoveryRequired']);self.assertTrue(r['realSnapshotRetainedInHistory'])
        backup=next(self.directory.glob('baseline-backup-*'));self.assertEqual(backup.stat().st_mode&0o777,0o700)
        snapshot=backup/'snapshot-before.json';self.assertEqual(snapshot.stat().st_mode&0o777,0o600)
        self.assertEqual(json.loads(snapshot.read_text())['accounts'],before)
        self.assertEqual(web.accounts,[]);self.assertEqual(web.history[0]['holdings'],before)
        self.assertEqual(web.calls.count('nhSnapshotRestore'),1);self.assertTrue(set(web.calls)<={'login','logout','nhSnapshotRead','nhSnapshotRestore'})
        text=json.dumps(r)
        for value in ('SYNTHETIC_PRIVATE_HOLDING','SYNTHETIC_PRIVATE_PASSWORD','SYNTHETIC_PRIVATE_TOKEN','synthetic-before','baseline-backup-'):self.assertNotIn(value,text)
    def test_multiple_or_unproven_history_is_never_restored(self):
        for mutation in [lambda w:w.history.append(copy.deepcopy(w.history[0])),lambda w:w.history[0].update(reason='restore'),lambda w:w.history[0].update(holdings=[{'synthetic':'data'}]),lambda w:setattr(w,'rev','unrelated'),lambda w:setattr(w,'accounts',[])]:
            w=Store();mutation(w);r=self.run_restore(w);self.assertEqual(r['status'],'FAIL');self.assertNotIn('nhSnapshotRestore',w.calls);self.assertFalse(r['storageWrites'])
    def test_backup_failure_prevents_remote_write(self):
        w=Store()
        with patch.object(restore,'backup_snapshot',side_effect=OSError('SYNTHETIC_PRIVATE_CANARY')):r=self.run_restore(w)
        self.assertEqual(r['status'],'FAIL');self.assertNotIn('nhSnapshotRestore',w.calls);self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',json.dumps(r))
    def test_backup_is_never_overwritten(self):
        w=Store();before=w.call('nhSnapshotRead')
        first=restore.backup_snapshot(self.directory,before);second=restore.backup_snapshot(self.directory,before)
        self.assertNotEqual(first,second);self.assertEqual((first/'snapshot-before.json').read_bytes(),(second/'snapshot-before.json').read_bytes())
    def test_concurrent_write_after_backup_stops_before_restore(self):
        w=Store();original=w.call;reads=0
        def call(action,**fields):
            nonlocal reads
            if action=='nhSnapshotRead':
                reads+=1
                if reads==2:w.rev='concurrent'
            return original(action,**fields)
        w.call=call;r=self.run_restore(w)
        self.assertEqual(r['code'],'CONCURRENT_SNAPSHOT_CHANGE');self.assertNotIn('nhSnapshotRestore',w.calls)
    def test_lost_acknowledgement_never_repeats_restore_or_deletes_history(self):
        w=Store();original=w.call
        def call(action,**fields):
            result=original(action,**fields)
            if action=='nhSnapshotRestore':raise ApiFailure('NETWORK_OR_JSON_FAILURE')
            return result
        w.call=call;r=self.run_restore(w)
        self.assertEqual(r['status'],'FAIL');self.assertTrue(r['ownerRecoveryRequired']);self.assertTrue(r['activeEmptyBaselineRestored']);self.assertTrue(r['realSnapshotRetainedInHistory']);self.assertEqual(w.calls.count('nhSnapshotRestore'),1)
    def test_conflict_leaves_snapshot_unchanged_without_retry(self):
        w=Store();original=w.call
        def call(action,**fields):
            if action=='nhSnapshotRestore':w.calls.append(action);raise ApiFailure('STORE_CONFLICT')
            return original(action,**fields)
        w.call=call;r=self.run_restore(w)
        self.assertEqual(r['status'],'FAIL');self.assertTrue(r['storedSnapshotUnchanged']);self.assertFalse(r['storageWrites']);self.assertEqual(w.calls.count('nhSnapshotRestore'),1)
    def test_restore_requires_explicit_flag_before_preflight(self):
        with patch.object(sys,'argv',['nh_v2_restore.py','--environment','synthetic']),patch.object(restore,'preflight') as preflight,contextlib.redirect_stdout(io.StringIO()):self.assertEqual(restore.main(),2)
        preflight.assert_not_called()
