"""Offline NAVER five-minute snapshot qualification. No fetch, relay or signals.

A local request declaration is not independent network or provider-identity proof.
Keep clock-reference events separate from certified session candles/volume.
"""
import argparse
from datetime import datetime,timezone
import hashlib,json,re
from pathlib import Path
from zoneinfo import ZoneInfo
from probe_public_intraday_v1 import number,epoch,inspect_payload,LIMIT

ROOT=Path(__file__).resolve().parents[1]
ZONE=ZoneInfo('Asia/Seoul')
FIELDS={'requestUrl','responseUrl','httpStatus','redirected','payloadSha256','masterSha256','receivedAt'}
CODES=set('INVALID_DATE INVALID_LOCAL_TIME INVALID_PROVENANCE CAPTURE_DIGEST_MISMATCH MASTER_DIGEST_MISMATCH LISTING_PROVENANCE_INVALID LISTING_IDENTITY_UNRESOLVED INVALID_INSPECTION_TIME INVALID_RECEIPT_TIME INVALID_PROVIDER_WRAPPER INVALID_PROVIDER_WINDOW INVALID_POINT_COUNT INVALID_POINT_TIME INVALID_OHLC INVALID_VOLUME INVALID_PROVIDER_CLOCK COMPARISON_YAHOO_INVALID INVALID_LOCAL_CAPTURE'.split())
def local_time(value):
    if not isinstance(value,str) or not re.fullmatch(r'[0-9]{14}',value):raise ValueError('INVALID_LOCAL_TIME')
    try:
        d=datetime.strptime(value,'%Y%m%d%H%M%S').replace(tzinfo=ZONE)
        if d.strftime('%Y%m%d%H%M%S')!=value:raise ValueError()
        return d
    except ValueError:raise ValueError('INVALID_LOCAL_TIME') from None

def target(day):
    try:
        if not isinstance(day,str) or not re.fullmatch(r'[0-9]{8}',day):raise ValueError()
        datetime.strptime(day,'%Y%m%d')
    except ValueError:raise ValueError('INVALID_DATE') from None
    return 'https://api.stock.naver.com/chart/domestic/item/005930/minute5?startDateTime='+day+'0000&endDateTime='+day+'2359&wrapper=true'

def inspect_snapshot(raw,context,master_raw,day,now,*,yahoo=None):
    url=target(day)
    if not epoch(now):raise ValueError('INVALID_INSPECTION_TIME')
    if not isinstance(raw,bytes) or not 0<len(raw)<=LIMIT or not isinstance(master_raw,bytes) or not 0<len(master_raw)<=8*LIMIT:raise ValueError('INVALID_LOCAL_CAPTURE')
    if (not isinstance(context,dict) or set(context)!=FIELDS or context.get('requestUrl')!=url or context.get('responseUrl')!=url or type(context.get('httpStatus')) is not int or context['httpStatus']!=200 or context.get('redirected') is not False):raise ValueError('INVALID_PROVENANCE')
    for key,data,code in [('payloadSha256',raw,'CAPTURE_DIGEST_MISMATCH'),('masterSha256',master_raw,'MASTER_DIGEST_MISMATCH')]:
        if context.get(key)!=hashlib.sha256(data).hexdigest():raise ValueError(code)
    receipt=context['receivedAt']
    if receipt is not None and (not epoch(receipt) or receipt>now):raise ValueError('INVALID_RECEIPT_TIME')
    try:master=json.loads(master_raw);doc=json.loads(raw)
    except (ValueError,UnicodeError):raise ValueError('INVALID_LOCAL_CAPTURE') from None
    source=master.get('source') if isinstance(master,dict) else None
    expected={'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip','https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip'}
    if (not isinstance(source,dict) or type(master.get('schema')) is not int or master['schema']!=1 or source.get('provider')!='한국투자증권 공식 배포 KRX 상장종목 마스터' or not isinstance(source.get('archives'),list) or len(source['archives'])!=2 or any(not isinstance(a,dict) or not isinstance(a.get('url'),str) or not isinstance(a.get('sha256'),str) or not re.fullmatch('[a-f0-9]{64}',a['sha256']) for a in source['archives']) or {a.get('url') for a in source['archives']}!=expected):raise ValueError('LISTING_PROVENANCE_INVALID')
    try:
        fetched=datetime.fromisoformat(source['fetchedAt'])
        if fetched.tzinfo is None or fetched.timestamp()*1000>now:raise ValueError()
    except (ValueError,TypeError,KeyError,OverflowError):raise ValueError('LISTING_PROVENANCE_INVALID') from None
    listings=master.get('instruments')
    if not isinstance(listings,list):raise ValueError('LISTING_IDENTITY_UNRESOLVED')
    matches=[r for r in listings if isinstance(r,dict) and r.get('code')=='005930']
    if len(matches)!=1 or matches[0].get('market')!='KOSPI' or matches[0].get('type')!='STOCK':raise ValueError('LISTING_IDENTITY_UNRESOLVED')
    if not isinstance(doc,dict) or doc.get('stockExchangeType')!='KRX':raise ValueError('INVALID_PROVIDER_WRAPPER')
    # The body does not normally echo code/currency. Contradictory echoes cannot
    # be ignored; their absence is kept explicit rather than invented.
    if any(key in doc and doc[key]!='005930' for key in ['symbol','itemCode','code']) or ('currency' in doc and doc['currency']!='KRW'):raise ValueError('INVALID_PROVIDER_WRAPPER')
    start,end=local_time(doc.get('openTime')),local_time(doc.get('closeTime'))
    if start>=end or start.strftime('%Y%m%d')!=day or end.strftime('%Y%m%d')!=day:raise ValueError('INVALID_PROVIDER_WINDOW')
    rows=doc.get('priceInfos')
    if not isinstance(rows,list) or not 2<=len(rows)<=1000:raise ValueError('INVALID_POINT_COUNT')
    points=[];prior=None;volumes=[];unknown_volume=0
    for r in rows:
        if not isinstance(r,dict):raise ValueError('INVALID_PROVIDER_WRAPPER')
        t=local_time(r.get('localDateTime'));millis=int(t.timestamp()*1000)
        if (not start<=t<=end or t.strftime('%Y%m%d')!=day or (t.minute*60+t.second)%300 or millis>(receipt if receipt is not None else now) or (prior is not None and t<=prior)):raise ValueError('INVALID_POINT_TIME')
        o,h,l,c=(r.get(k) for k in ['openPrice','highPrice','lowPrice','currentPrice'])
        if not all(number(v) and v>0 for v in [o,h,l,c]) or h<max(o,c,l) or l>min(o,c,h):raise ValueError('INVALID_OHLC')
        volume=r.get('accumulatedTradingVolume')
        if volume is not None and (not number(volume) or volume<0):raise ValueError('INVALID_VOLUME')
        if volume is None:unknown_volume+=1
        else:volumes.append(volume)
        points.append((t,millis,c,volume));prior=t
    clock=local_time(doc['localDateTimeNow']) if doc.get('localDateTimeNow') is not None else None
    if clock and (clock<points[-1][0] or clock.timestamp()*1000>(receipt if receipt is not None else now)):raise ValueError('INVALID_PROVIDER_CLOCK')
    missing=sum(int((b[0]-a[0]).total_seconds()/300)-1 for a,b in zip(points,points[1:]))
    buckets={'before1530':0,'at1530':0,'after1530Before1600':0,'atOrAfter1600':0}
    for t,*_ in points:
        hhmm=t.strftime('%H%M');key='before1530' if hhmm<'1530' else 'at1530' if hhmm=='1530' else 'after1530Before1600' if hhmm<'1600' else 'atOrAfter1600';buckets[key]+=1
    warnings=['LOCAL_REQUEST_DECLARATION_ONLY','PROVIDER_IDENTITY_AND_CURRENCY_NOT_CERTIFIED','ROW_VENUE_COVERAGE_UNVERIFIED','SESSION_EVENT_SEMANTICS_UNVERIFIED','PROVIDER_TIMEZONE_NOT_ECHOED','BAR_TIMESTAMP_MEANING_UNVERIFIED','VOLUME_SEMANTICS_UNVERIFIED','HISTORICAL_LISTING_SNAPSHOT']
    if receipt is None:warnings.append('RECEIPT_TIME_UNKNOWN')
    if clock is None:warnings.append('PROVIDER_CLOCK_UNKNOWN')
    if missing:warnings.append('GRID_SLOTS_WITHOUT_POINTS_NOT_FILLED')
    if unknown_volume:warnings.append('VOLUME_VALUES_MISSING')
    if buckets['at1530'] or buckets['after1530Before1600'] or buckets['atOrAfter1600']:warnings.append('MULTIPLE_CLOCK_RANGES_NOT_MERGED')
    out={
        'mode':'OFFLINE_KR_PROVIDER_SNAPSHOT_FACTS', 'status':'PARTIAL',
        'formatValidated':True, 'symbol':'005930', 'listingMarket':'KOSPI',
        'listingType':'STOCK', 'currencyContext':'KRW',
        'listingSnapshotAt':fetched.isoformat(), 'source':'NAVER public chart',
        'interval':'5m', 'requestedDate':day, 'providerExchangeLabel':'KRX',
        'requestBinding':'LOCAL_DECLARATION_WITH_DIGEST',
        'providerIdentityVerified':False, 'timezoneContext':'Asia/Seoul',
        'providerTimezoneVerified':False, 'barTimeMeaningVerified':False,
        'receiptAt':receipt, 'inspectionAt':now,
        'providerClock':clock.isoformat() if clock else None,
        'providerWindowStart':start.isoformat(), 'providerWindowEnd':end.isoformat(),
        'firstPoint':points[0][0].isoformat(), 'lastPoint':points[-1][0].isoformat(),
        'rawPoints':len(points), 'clockReferenceCounts':buckets,
        'absentFiveMinuteGridSlots':missing,
        'terminalBoundaryPoints':sum(p[0]==end for p in points),
        'unknownVolumePoints':unknown_volume, 'zeroVolumePoints':sum(v==0 for v in volumes),
        'volumeValuesMonotone':None if unknown_volume else all(a<=b for a,b in zip(volumes,volumes[1:])),
        'warnings':warnings, 'realTimeVerified':False, 'sessionCalendarVerified':False,
        'rowVenueVerified':False, 'volumeSemanticsVerified':False, 'tradeVwapVerified':False,
        'fullSessionCoverageVerified':False, 'signalReady':False,
        'relayPermissionsChanged':False, 'actualNhCalls':0, 'orderCalls':0,
    }
    if yahoo is not None:
        try:
            facts=inspect_payload(yahoo,'005930.KS','5m',now)
            if facts['invalidRows'] or facts['outsideProviderPeriod'] or facts['providerSessionStartLocal'] is None:raise ValueError()
            r=yahoo['chart']['result'][0];q=r['indicators']['quote'][0];end_second=r['meta']['currentTradingPeriod']['regular']['end'];start_second=r['meta']['currentTradingPeriod']['regular']['start']
            if any(datetime.fromtimestamp(t,ZONE).strftime('%Y%m%d')!=day for t in [start_second,end_second]):raise ValueError()
            native={ms//1000:(close,volume) for _,ms,close,volume in points}
            pairs=[];yvol=q.get('volume') if isinstance(q.get('volume'),list) else []
            for i,t in enumerate(r['timestamp']):
                v=yvol[i] if i<len(yvol) else None
                if start_second<=t<end_second and t in native and number(v) and v>0:pairs.append((q['close'][i],v,*native[t]))
            out['comparison']={
                'mode':'DECLARED_SEOUL_TIMESTAMP_FACTS_ONLY',
                'yahooSourceSnapshotStatus':facts['status'],
                'nonzeroYahooVolumePairs':len(pairs),
                'matchingClosePairs':sum(a==c for a,b,c,d in pairs),
                'knownNativeVolumePairs':sum(number(d) for a,b,c,d in pairs),
                'unknownNativeVolumePairs':sum(d is None for a,b,c,d in pairs),
                'matchingVolumePairs':sum(number(d) and b==d for a,b,c,d in pairs),
                'timestampShiftApplied':False, 'sourcesStitched':False, 'vwapCalculated':False,
            }
        except (ValueError,KeyError,IndexError,TypeError):raise ValueError('COMPARISON_YAHOO_INVALID') from None
    return out

def read_file(path,limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>limit:raise ValueError('INVALID_LOCAL_CAPTURE')
    return path.read_bytes()
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--payload',type=Path,required=True);p.add_argument('--context',type=Path,required=True);p.add_argument('--date',required=True);p.add_argument('--compare-yahoo',type=Path);a=p.parse_args()
    try:
        raw=read_file(a.payload,LIMIT);context=json.loads(read_file(a.context,8192));master=read_file(ROOT/'data/krx-instruments.json',8*LIMIT);other=json.loads(read_file(a.compare_yahoo,LIMIT)) if a.compare_yahoo else None
        report=inspect_snapshot(raw,context,master,a.date,int(datetime.now(timezone.utc).timestamp()*1000),yahoo=other)
    except Exception as e:report={'status':'FAIL','code':str(e) if isinstance(e,ValueError) and str(e) in CODES else 'INVALID_LOCAL_CAPTURE','networkCalls':0,'relayPermissionsChanged':False,'actualNhCalls':0,'orderCalls':0}
    print(json.dumps(report,ensure_ascii=False));return int(report['status']=='FAIL')
if __name__=='__main__':raise SystemExit(main())
