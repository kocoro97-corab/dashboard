"""Offline synthetic identity/time/volume qualification; no real account data."""
import copy,hashlib,importlib.util,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import inspect_korean_intraday_v1 as probe
DAY='20261120';NOW=1795348800000

def master():
 return {'schema':1,'source':{'provider':'한국투자증권 공식 배포 KRX 상장종목 마스터','fetchedAt':'2026-11-11T09:55:45+00:00','archives':[{'url':'https://new.real.download.dws.co.kr/common/master/'+market+'_code.mst.zip','sha256':'a'*64} for market in ['kospi','kosdaq']]},'instruments':[{'code':'005930','name':'Synthetic listing','market':'KOSPI','type':'STOCK'}]}
def payload():
 return {'stockExchangeType':'KRX','openTime':DAY+'090000','closeTime':DAY+'200000','localDateTimeNow':'20261122101000','hasVolume':True,'priceInfos':[{'localDateTime':DAY+t,'openPrice':10,'highPrice':12,'lowPrice':9,'currentPrice':11,'accumulatedTradingVolume':v} for t,v in [('090000',100),('090500',70),('151500',90),('153000',1000),('154000',10),('160000',20),('195500',5)]]}
def bound(doc=None,listing=None):
 raw=json.dumps(doc if doc is not None else payload()).encode();m=json.dumps(listing if listing is not None else master()).encode();u=probe.target(DAY)
 return raw,{'requestUrl':u,'responseUrl':u,'httpStatus':200,'redirected':False,'payloadSha256':hashlib.sha256(raw).hexdigest(),'masterSha256':hashlib.sha256(m).hexdigest(),'receivedAt':None},m

def yahoo():
 points=[int(probe.local_time(DAY+t).timestamp()) for t in ['090000','090500','150000']]
 return {'chart':{'error':None,'result':[{'meta':{'symbol':'005930.KS','currency':'KRW','exchangeName':'KSC','exchangeTimezoneName':'Asia/Seoul','instrumentType':'EQUITY','dataGranularity':'5m','regularMarketTime':points[-1],'currentTradingPeriod':{'regular':{'start':points[0],'end':points[-1]}}},'timestamp':points,'indicators':{'quote':[{'open':[10]*3,'high':[12]*3,'low':[9]*3,'close':[11]*3,'volume':[100,70,0]}]}}]}}
class KoreanIntradayInspectorTest(unittest.TestCase):
 def inspect(self,doc=None,listing=None,**kwargs):return probe.inspect_snapshot(*bound(doc,listing),DAY,NOW,**kwargs)
 def test_valid_snapshot_remains_partial_with_clock_counts_not_certified_session_candles(self):
  r=self.inspect();self.assertEqual(r['status'],'PARTIAL');self.assertEqual(r['rawPoints'],7);self.assertEqual(r['clockReferenceCounts'],{'before1530':3,'at1530':1,'after1530Before1600':1,'atOrAfter1600':2});self.assertGreater(r['absentFiveMinuteGridSlots'],0)
  self.assertTrue(r['firstPoint'].endswith('09:00:00+09:00'));self.assertFalse(r['volumeValuesMonotone']);self.assertIsNone(r['receiptAt'])
  for key in ['providerIdentityVerified','providerTimezoneVerified','barTimeMeaningVerified','rowVenueVerified','sessionCalendarVerified','volumeSemanticsVerified','tradeVwapVerified','fullSessionCoverageVerified','realTimeVerified','signalReady','relayPermissionsChanged']:self.assertFalse(r[key])
 def test_only_canonical_request_date_and_no_redirects_or_query_expansion(self):
  raw,ctx,m=bound()
  for change in [{'requestUrl':ctx['requestUrl']+'&token=PRIVATE_VALUE'},{'responseUrl':ctx['responseUrl'].replace('005930','000660')},{'redirected':True},{'httpStatus':True},{'httpStatus':302}]:
   with self.assertRaisesRegex(ValueError,'INVALID_PROVENANCE'):probe.inspect_snapshot(raw,{**ctx,**change},m,DAY,NOW)
  with self.assertRaisesRegex(ValueError,'INVALID_DATE'):probe.target('20260230')
 def test_capture_and_master_digest_mismatch_rejected(self):
  raw,ctx,m=bound()
  for key,code in [('payloadSha256','CAPTURE_DIGEST_MISMATCH'),('masterSha256','MASTER_DIGEST_MISMATCH')]:
   with self.assertRaisesRegex(ValueError,code):probe.inspect_snapshot(raw,{**ctx,key:'0'*64},m,DAY,NOW)
 def test_listing_master_requires_provenance_and_unambiguous_stock_identity(self):
  for change in ['source','duplicate','market','type','missing']:
   m=master()
   if change=='source':m['source']['archives'][0]['url']='https://evil.invalid/private'
   if change=='duplicate':m['instruments']*=2
   if change=='market':m['instruments'][0]['market']='KOSDAQ'
   if change=='type':m['instruments'][0]['type']='ETF'
   if change=='missing':m['instruments']=[]
   with self.assertRaises(ValueError):self.inspect(listing=m)
 def test_exchange_and_contradictory_identity_echoes_rejected(self):
  for key,value in [('stockExchangeType','NXT'),('symbol','AAPL'),('currency','USD')]:
   d=payload();d[key]=value
   with self.assertRaisesRegex(ValueError,'INVALID_PROVIDER_WRAPPER'):self.inspect(d)
 def test_duplicate_reverse_future_off_grid_and_wrong_day_points_rejected(self):
  for change in ['duplicate','reverse','future','offgrid','wrongday']:
   d=payload()
   if change=='duplicate':d['priceInfos'][1]['localDateTime']=d['priceInfos'][0]['localDateTime']
   if change=='reverse':d['priceInfos'].reverse()
   if change=='future':d['priceInfos'][-1]['localDateTime']='20261123195500'
   if change=='offgrid':d['priceInfos'][1]['localDateTime']=DAY+'090501'
   if change=='wrongday':d['priceInfos'][0]['localDateTime']='20261119090000'
   with self.assertRaises(ValueError):self.inspect(d)
 def test_bad_ohlc_never_repaired_or_zero_filled(self):
  for key,value in [('currentPrice',None),('openPrice',False),('highPrice',1),('lowPrice',20),('currentPrice',0)]:
   d=payload();d['priceInfos'][0][key]=value
   with self.assertRaisesRegex(ValueError,'INVALID_OHLC'):self.inspect(d)
 def test_missing_volume_unknown_zero_preserved_invalid_volume_rejected(self):
  d=payload();d['priceInfos'][0]['accumulatedTradingVolume']=None;d['priceInfos'][1]['accumulatedTradingVolume']=0;r=self.inspect(d);self.assertEqual(r['unknownVolumePoints'],1);self.assertEqual(r['zeroVolumePoints'],1);self.assertIsNone(r['volumeValuesMonotone'])
  for value in [-1,True,float('nan')]:
   d=payload();d['priceInfos'][0]['accumulatedTradingVolume']=value
   with self.assertRaisesRegex(ValueError,'INVALID_VOLUME'):self.inspect(d)
 def test_clock_receipt_and_inspection_time_are_distinct_and_never_invented(self):
  d=payload();d.pop('localDateTimeNow');r=self.inspect(d);self.assertIsNone(r['providerClock']);self.assertIn('RECEIPT_TIME_UNKNOWN',r['warnings']);self.assertIn('PROVIDER_CLOCK_UNKNOWN',r['warnings'])
  raw,ctx,m=bound()
  for receipt in [NOW+1,True,1]:
   with self.assertRaises(ValueError):probe.inspect_snapshot(raw,{**ctx,'receivedAt':receipt},m,DAY,NOW)
  declared_before_provider_clock=int(probe.local_time(DAY+'200000').timestamp()*1000)
  with self.assertRaisesRegex(ValueError,'INVALID_PROVIDER_CLOCK'):probe.inspect_snapshot(raw,{**ctx,'receivedAt':declared_before_provider_clock},m,DAY,NOW)
  with self.assertRaisesRegex(ValueError,'INVALID_INSPECTION_TIME'):probe.inspect_snapshot(raw,ctx,m,DAY,True)
 def test_provider_clock_contradictions_rejected(self):
  for value in ['20261120080000','20270101000000','PRIVATE_VALUE']:
   d=payload();d['localDateTimeNow']=value
   with self.assertRaises(ValueError):self.inspect(d)
 def test_terminal_clock_event_not_reported_as_extra_completed_candle(self):
  d=payload();d['priceInfos'].append({**d['priceInfos'][-1],'localDateTime':DAY+'200000'});r=self.inspect(d);self.assertEqual(r['terminalBoundaryPoints'],1);self.assertNotIn('completedCandles',r);self.assertFalse(r['fullSessionCoverageVerified'])
 def test_cross_source_comparison_uses_only_identical_timestamps_and_does_not_stitch(self):
  r=self.inspect(yahoo=yahoo())['comparison'];self.assertEqual(r['nonzeroYahooVolumePairs'],2);self.assertEqual(r['matchingClosePairs'],2);self.assertEqual(r['matchingVolumePairs'],2)
  for key in ['timestampShiftApplied','sourcesStitched','vwapCalculated']:self.assertFalse(r[key])
  d=yahoo();d['chart']['result'][0]['meta']['currency']='USD'
  with self.assertRaisesRegex(ValueError,'COMPARISON_YAHOO_INVALID'):self.inspect(yahoo=d)
  d=yahoo();r=d['chart']['result'][0];r['timestamp']=[t-86400 for t in r['timestamp']];r['meta']['regularMarketTime']-=86400
  for key in ['start','end']:r['meta']['currentTradingPeriod']['regular'][key]-=86400
  with self.assertRaisesRegex(ValueError,'COMPARISON_YAHOO_INVALID'):self.inspect(yahoo=d)
  d=payload();d['priceInfos'][0]['accumulatedTradingVolume']=None;r=self.inspect(d,yahoo=yahoo())['comparison'];self.assertEqual(r['unknownNativeVolumePairs'],1);self.assertEqual(r['knownNativeVolumePairs'],1);self.assertEqual(r['matchingVolumePairs'],1)
 def test_no_network_or_private_fields_or_input_mutations(self):
  d=payload();d['privateToken']='PRIVATE_VALUE';d['priceInfos'][0]['account']='PRIVATE_VALUE';before=copy.deepcopy(d)
  with patch('urllib.request.build_opener',side_effect=AssertionError('NETWORK_NOT_ALLOWED')):r=self.inspect(d)
  self.assertNotIn('PRIVATE_VALUE',json.dumps(r));self.assertNotIn('currentPrice',json.dumps(r));self.assertEqual(d,before)
  raw,ctx,m=bound()
  with self.assertRaisesRegex(ValueError,'INVALID_PROVENANCE'):probe.inspect_snapshot(raw,{**ctx,'token':'PRIVATE_VALUE'},m,DAY,NOW)
 def test_native_url_not_allowed_by_active_relay_and_cli_failure_is_sanitized(self):
  sys.path.insert(0,str(ROOT/'relay'));from market_routes import allowed_market_url
  self.assertFalse(allowed_market_url(probe.target(DAY)))
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'body.json').write_text('PRIVATE_VALUE');(p/'ctx.json').write_text('PRIVATE_VALUE')
   r=subprocess.run([sys.executable,str(ROOT/'tools/inspect_korean_intraday_v1.py'),'--payload',str(p/'body.json'),'--context',str(p/'ctx.json'),'--date',DAY],capture_output=True,text=True)
   self.assertEqual(r.returncode,1);self.assertNotIn('PRIVATE_VALUE',r.stdout+r.stderr);self.assertEqual(json.loads(r.stdout)['code'],'INVALID_LOCAL_CAPTURE')
 def test_local_symlinks_and_oversized_inputs_are_refused(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'body.json';p.write_text('PRIVATE_VALUE');link=Path(tmp)/'link.json';link.symlink_to(p)
   for path,limit in [(link,100),(p,1)]:
    with self.assertRaisesRegex(ValueError,'INVALID_LOCAL_CAPTURE'):probe.read_file(path,limit)
if __name__=='__main__':unittest.main()
