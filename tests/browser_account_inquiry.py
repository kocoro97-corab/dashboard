"""Synthetic data through the same owner-private inquiry/display check. No live NH."""
from test_account_inquiry_only import Web, verify_account_inquiry

web=Web()
account=web.result['accounts'][0]
account['acctType']='01'
account['domestic']['holdings'][0].update(avgPrice=1000,currentPrice=1200)
account['overseas']['holdings']=[{'name':'SYNTHETIC US HOLDING','code':'TEST',
    'currency':'USD','quantity':3,'avgPrice':5.25,'currentPrice':None}]
report=verify_account_inquiry(web,'synthetic','private',display=True)
assert report['status']=='PASS',report
assert report['desktopAdapter']==report['mobileAdapter']=='PASS'
assert web.calls==['login','nhAccounts','logout']
print('PASS: synthetic domestic/overseas balance → PC/mobile display comparison; one inquiry; no store/snapshot/tunnel/order')
