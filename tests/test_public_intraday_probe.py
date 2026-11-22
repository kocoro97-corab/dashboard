"""Synthetic capability validation, never live provider/NH requests."""
import copy,importlib.util,json,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('intraday_probe',ROOT/'tools/probe_public_intraday_v1.py');probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
NOW=1795215600000
def fixture(symbol='AAPL',interval='5m'):
 currency,exchange,zone=probe.SYMBOLS[symbol];step=probe.INTERVALS[interval];start=NOW//1000-3600;end=start+step*3
 return {'chart':{'error':None,'result':[{'meta':{'symbol':symbol,'currency':currency,'exchangeName':exchange,'exchangeTimezoneName':zone,'instrumentType':'EQUITY','dataGranularity':interval,'regularMarketTime':end+2,'currentTradingPeriod':{'regular':{'start':start,'end':end}}},'timestamp':[start+i*step for i in range(4)],'indicators':{'quote':[{'open':[10]*4,'high':[12]*4,'low':[9]*4,'close':[11]*4,'volume':[100,0,200,0]}]}}]}}
class IntradayProbeTest(unittest.TestCase):
 def inspect(self,d,s='AAPL',i='5m'):return probe.inspect_payload(d,s,i,NOW)
 def test_identity_timezones_and_intervals(self):
  for symbol in probe.SYMBOLS:
   for interval in probe.INTERVALS:
    r=self.inspect(fixture(symbol,interval),symbol,interval);self.assertEqual(r['usableBars'],3);self.assertFalse(r['realTimeVerified']);self.assertFalse(r['fullSessionCoverageVerified']);self.assertFalse(r['tradeVwapVerified'])
 def test_terminal_boundary_point_is_not_an_extra_full_bar(self):
  r=self.inspect(fixture());self.assertEqual(r['rawPoints'],4);self.assertEqual(r['terminalBoundaryPointsExcluded'],1);self.assertEqual(r['usableBars'],3)
 def test_zero_volume_preserved_but_missing_volume_unknown(self):
  d=fixture();d['chart']['result'][0]['indicators']['quote'][0]['volume'][2]=None;r=self.inspect(d)
  self.assertEqual(r['zeroVolumeBars'],1);self.assertEqual(r['unknownVolumeBars'],1);self.assertIn('BAR_VOLUME_UNKNOWN',r['warnings']);self.assertEqual(r['status'],'PARTIAL')
 def test_wrong_symbol_currency_exchange_interval_timezone(self):
  for key,value in [('symbol','MSFT'),('currency','KRW'),('exchangeName','KSC'),('dataGranularity','1d'),('exchangeTimezoneName','UTC')]:
   d=fixture();d['chart']['result'][0]['meta'][key]=value
   with self.assertRaisesRegex(ValueError,'IDENTITY_CURRENCY_INTERVAL_MISMATCH'):self.inspect(d)
 def test_duplicate_reverse_future_and_off_grid_timestamps_rejected(self):
  for kind in ['duplicate','reverse','future','offgrid']:
   d=fixture();row=d['chart']['result'][0]
   if kind=='duplicate':row['timestamp'][1]=row['timestamp'][0]
   if kind=='reverse':row['timestamp'].reverse()
   if kind=='future':row['timestamp'][-1]=NOW//1000+1
   if kind=='offgrid':row['timestamp'][1]+=1
   with self.assertRaises(ValueError):self.inspect(d)
 def test_partial_ohlc_never_zero_filled(self):
  d=fixture();d['chart']['result'][0]['indicators']['quote'][0]['close'][1]=None;r=self.inspect(d)
  self.assertEqual(r['invalidRows'],1);self.assertEqual(r['usableBars'],2);self.assertEqual(r['missingIntervals'],1);self.assertEqual(r['status'],'PARTIAL')
 def test_provider_quote_after_session_end_is_not_claimed_delay(self):
  d=fixture();m=d['chart']['result'][0]['meta'];m['regularMarketTime']=m['currentTradingPeriod']['regular']['end']+1805;r=self.inspect(d)
  self.assertIn('QUOTE_AFTER_PROVIDER_SESSION_END',r['warnings']);self.assertEqual(r['quoteToLastPointGapSeconds'],1805);self.assertNotIn('delayMinutes',r)
 def test_unknown_session_and_quote_time_are_explicit(self):
  d=fixture();m=d['chart']['result'][0]['meta'];m.pop('currentTradingPeriod');m.pop('regularMarketTime');r=self.inspect(d)
  self.assertIsNone(r['providerSessionEndLocal']);self.assertIsNone(r['providerQuoteLocal']);self.assertEqual(r['status'],'PARTIAL')
 def test_input_not_mutated_or_private_fields_echoed(self):
  d=fixture();d['privateToken']='PRIVATE_VALUE';before=copy.deepcopy(d);r=self.inspect(d);self.assertEqual(d,before);self.assertNotIn('PRIVATE_VALUE',json.dumps(r))
 def test_fixed_targets_allow_only_the_approved_five_minute_pilot(self):
  sys.path.insert(0,str(ROOT/'relay'));from market_routes import allowed_market_url
  for symbol in probe.SYMBOLS:
   for interval in probe.INTERVALS:self.assertEqual(allowed_market_url(probe.target(symbol,interval)),symbol=='AAPL' and interval=='5m')
  with self.assertRaises(ValueError):probe.target('OTHER','1m')
  with self.assertRaises(ValueError):probe.target('AAPL','1d')
 def test_existing_capture_directory_refused_before_network(self):
  with tempfile.TemporaryDirectory() as tmp:
   result=subprocess.run([sys.executable,str(ROOT/'tools/probe_public_intraday_v1.py'),'--capture-dir',tmp],capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertIn('must be new',result.stderr)
if __name__=='__main__':unittest.main()
