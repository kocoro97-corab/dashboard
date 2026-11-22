"""Fixed public intraday capability diagnostic, NOT an application relay fallback.

No login/NH/GAS/Worker mutation, streaming subscription, signals or publication.
Only two public symbols, 1m/5m and range=1d. No redirects/retries/auth headers.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import json
import math
from pathlib import Path
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

SYMBOLS={'005930.KS':('KRW','KSC','Asia/Seoul'),'AAPL':('USD','NMS','America/New_York')}
INTERVALS={'1m':60,'5m':300}
LIMIT=2*1024*1024
def target(symbol,interval):
    if symbol not in SYMBOLS or interval not in INTERVALS:
        raise ValueError('UNSUPPORTED_PROBE_TARGET')
    return 'https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?interval='+interval+'&range=1d'
def number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
def epoch(value):
    return isinstance(value,int) and not isinstance(value,bool) and value>0
def inspect_payload(document,symbol,interval,received_at):
    """Project facts only; no inferred prices, zero filling or real-time claims."""
    target(symbol,interval)
    try:
        r=document['chart']['result'][0];m=r['meta'];q=r['indicators']['quote'][0]
        if document['chart'].get('error'):
            raise ValueError('PROVIDER_ERROR')
        currency,exchange,zone=SYMBOLS[symbol]
        if (m.get('symbol'),m.get('currency'),m.get('exchangeName'),m.get('exchangeTimezoneName'),m.get('instrumentType'),m.get('dataGranularity'))!=(symbol,currency,exchange,zone,'EQUITY',interval):
            raise ValueError('IDENTITY_CURRENCY_INTERVAL_MISMATCH')
        if not epoch(received_at):raise ValueError('INVALID_RECEIPT_TIME')
        times=r['timestamp'];step=INTERVALS[interval]
        if not isinstance(times,list) or not 2<=len(times)<=2000:
            raise ValueError('INVALID_TIMESTAMP_COUNT')
        if any(not epoch(t) or t*1000>received_at for t in times) or any(a>=b for a,b in zip(times,times[1:])):
            raise ValueError('INVALID_TIME_ORDER_OR_FUTURE')
        if any(not isinstance(q.get(k),list) or len(q[k])!=len(times) for k in ['open','high','low','close']):
            raise ValueError('INVALID_OHLC_ARRAYS')
        regular=m.get('currentTradingPeriod',{}).get('regular',{})
        start,end=regular.get('start'),regular.get('end')
        period_known=epoch(start) and epoch(end) and start<end
        quote_at=m.get('regularMarketTime');quote_at=quote_at if epoch(quote_at) and quote_at*1000<=received_at else None
        volumes=q.get('volume',[]);valid=[];rejected=terminal=outside=0
        for i,t in enumerate(times):
            o,h,l,c=(q[k][i] for k in ['open','high','low','close'])
            if not all(number(v) and v>0 for v in [o,h,l,c]) or h<max(o,c,l) or l>min(o,c,h):
                rejected+=1;continue
            if period_known and t==end:
                terminal+=1;continue # Closing boundary quote is not a full next bar.
            if period_known and not start<=t<end:
                outside+=1;continue
            v=volumes[i] if isinstance(volumes,list) and i<len(volumes) else None
            valid.append((t,v if number(v) and v>=0 else None))
        if len(valid)<2:raise ValueError('INSUFFICIENT_USABLE_BARS')
        deltas=[b[0]-a[0] for a,b in zip(valid,valid[1:])]
        if any(d%step for d in deltas):raise ValueError('TIME_GRID_MISMATCH')
        missing=sum(d//step-1 for d in deltas)
        unknown_volume=sum(v is None for _,v in valid)
        warnings=[]
        if not period_known:warnings.append('PROVIDER_SESSION_PERIOD_UNKNOWN')
        if quote_at is None:warnings.append('PROVIDER_QUOTE_TIME_UNKNOWN')
        if period_known and quote_at and quote_at>end+step:warnings.append('QUOTE_AFTER_PROVIDER_SESSION_END')
        if rejected or outside or missing:warnings.append('INCOMPLETE_OR_REJECTED_ROWS')
        if unknown_volume:warnings.append('BAR_VOLUME_UNKNOWN')
        z=ZoneInfo(zone)
        local=lambda t:datetime.fromtimestamp(t,z).isoformat() if t else None
        return {'symbol':symbol,'interval':interval,'range':'1d','status':'PARTIAL' if warnings else 'PASS_SOURCE_SNAPSHOT',
            'currency':currency,'exchange':exchange,'timezone':zone,'rawPoints':len(times),
            'usableBars':len(valid),'terminalBoundaryPointsExcluded':terminal,'invalidRows':rejected,
            'outsideProviderPeriod':outside,'missingIntervals':missing,
            'unknownVolumeBars':unknown_volume,'zeroVolumeBars':sum(v==0 for _,v in valid),
            'firstPointLocal':local(times[0]),'lastPointLocal':local(times[-1]),
            'lastUsableBarLocal':local(valid[-1][0]),'providerSessionStartLocal':local(start) if period_known else None,
            'providerSessionEndLocal':local(end) if period_known else None,'providerQuoteLocal':local(quote_at),
            'quoteToLastPointGapSeconds':quote_at-times[-1] if quote_at else None,
            'receivedAt':received_at,'pointAgeAtReceiptSeconds':received_at/1000-times[-1],'warnings':warnings,'realTimeVerified':False,
            'sessionCalendarVerified':False,'fullSessionCoverageVerified':False,'tradeVwapVerified':False}
    except (KeyError,TypeError,IndexError,OverflowError,AttributeError):
        raise ValueError('INVALID_PROVIDER_FORMAT') from None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def capture(pair):
    symbol,interval=pair;url=target(symbol,interval)
    try:
        req=urllib.request.Request(url,method='GET',headers={'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://finance.yahoo.com/'})
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as response:
            raw=response.read(LIMIT+1)
            if len(raw)>LIMIT:raise ValueError('RESPONSE_TOO_LARGE')
            if response.status!=200:raise ValueError('PROVIDER_HTTP')
        received=int(datetime.now(timezone.utc).timestamp()*1000)
        result=inspect_payload(json.loads(raw),symbol,interval,received)
        return symbol+'-'+interval,raw,result
    except urllib.error.HTTPError as e:
        code='PROVIDER_HTTP_'+str(e.code);e.close()
    except ValueError as e:code=str(e) if str(e).isupper() and len(str(e))<80 else 'INVALID_PROVIDER_JSON'
    except Exception:code='PROVIDER_UNAVAILABLE'
    return symbol+'-'+interval,None,{'symbol':symbol,'interval':interval,'status':'FAIL','code':code}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    group=p.add_mutually_exclusive_group(required=True)
    group.add_argument('--capture-dir',type=Path);group.add_argument('--inspect-dir',type=Path)
    a=p.parse_args();rows=[]
    if a.capture_dir:
        if a.capture_dir.exists():p.error('capture directory must be new')
        a.capture_dir.mkdir(parents=True)
        with ThreadPoolExecutor(max_workers=2) as pool:
            captured=list(pool.map(capture,[(s,i) for s in SYMBOLS for i in INTERVALS]))
        for name,raw,result in captured:
            if raw is not None:(a.capture_dir/(name+'.json')).write_bytes(raw)
            rows.append(result)
        (a.capture_dir/'results.json').write_text(json.dumps(rows,indent=2))
    else:
        for symbol in SYMBOLS:
            for interval in INTERVALS:
                file=a.inspect_dir/(symbol+'-'+interval+'.json')
                try:
                    if file.is_symlink() or not file.is_file() or file.stat().st_size>LIMIT:raise ValueError('INVALID_LOCAL_CAPTURE')
                    rows.append(inspect_payload(json.loads(file.read_text()),symbol,interval,int(datetime.now(timezone.utc).timestamp()*1000)))
                except (ValueError,OSError) as e:
                    code=str(e) if str(e).isupper() and len(str(e))<80 else 'INVALID_LOCAL_CAPTURE'
                    rows.append({'symbol':symbol,'interval':interval,'status':'FAIL','code':code})
    print(json.dumps({'mode':'DIRECT_PUBLIC_DIAGNOSTIC' if a.capture_dir else 'LOCAL_CAPTURE_REPLAY','results':rows,
        'relayPermissionsChanged':False,'appIntradayConnected':False,'actualNhCalls':0,'orderCalls':0,'published':False}))
    return int(any(r['status']=='FAIL' for r in rows))
if __name__=='__main__':raise SystemExit(main())
