"""Synthetic check of the owner UI adapter; zero external NH/Google requests."""
from test_nh_v2_fresh import FakeWeb
from nh_v2_live_check import verify_existing_snapshot_ui

web=FakeWeb()
web.call('nhSnapshotCapture')
web.calls=[]
report=verify_existing_snapshot_ui(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
assert report['status']=='PASS' and report['storedSnapshotUnchanged']
assert set(web.calls)<={'login','logout','nhSnapshotRead'}
assert not report['storageWrites'] and not report['nhRequested']
print('PASS: synthetic native snapshot UI adapter, desktop 1440 and mobile 344, no external browser network')
