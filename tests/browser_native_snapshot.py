"""Synthetic check of the owner UI adapter; zero external NH/Google requests."""
from test_nh_v2_fresh import FakeWeb
from nh_v2_live_check import browser_readback

web=FakeWeb()
web.call('nhSnapshotCapture')
browser_readback(web)
print('PASS: synthetic native snapshot UI adapter, desktop 1440 and mobile 344, no external browser network')
