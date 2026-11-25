/* Disabled pilot candidate, not imported by the app or relay.
 * Requires an explicitly supplied existing authenticated transport and capability.
 * No direct fetch/fallback, storage, account data, VWAP or trading signals.
 */
(function(root){
'use strict';
const URL5='https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m&range=1d';
const STEP=300000;
const fail=(code,transportCalls=0)=>({ok:false,code,transportCalls,canPlaceOrder:false});
const epoch=n=>Number.isSafeInteger(n)&&n>0;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function plan(symbol){
 if(symbol==='005930'||symbol==='005930.KS')return fail('KR_SESSION_WINDOW_UNRESOLVED');
 if(symbol!=='AAPL')return fail('UNVERIFIED_INTRADAY_PILOT');
 return {ok:true,status:'DISABLED_CANDIDATE',url:URL5,interval:'5m',range:'1d',requiresApprovedRelayCapability:true};
}
function candidateUrl(value){return typeof value==='string'&&value===URL5}
function parse(payload,now=Date.now()){
 if(!epoch(now))return fail('INVALID_CLOCK');
 const r=payload?.chart?.result?.[0],m=r?.meta,q=r?.indicators?.quote?.[0];
 if(payload?.chart?.error||!m||!q)return fail('INVALID_CHART');
 if(m.symbol!=='AAPL'||m.currency!=='USD'||m.exchangeName!=='NMS'||m.exchangeTimezoneName!=='America/New_York'||m.instrumentType!=='EQUITY'||m.dataGranularity!=='5m')return fail('IDENTITY_CURRENCY_TIMEFRAME_MISMATCH');
 const times=r.timestamp,period=m.currentTradingPeriod?.regular;
 if(!Array.isArray(times)||times.length<2||times.length>1000||!period||!epoch(period.start)||!epoch(period.end)||period.end<=period.start||period.end-period.start>86400)return fail('INVALID_PROVIDER_WINDOW');
 for(const key of ['open','high','low','close','volume'])if(!Array.isArray(q[key])||q[key].length!==times.length)return fail('INVALID_OHLCV_ARRAYS');
 const candles=[];let prior=0,terminal=0,incomplete=0;
 for(let i=0;i<times.length;i++){
  const second=times[i],t=second*1000;
  if(!epoch(second)||!epoch(t)||t>now||t<=prior||second<period.start||second>period.end)return fail('INVALID_BAR_TIME');
  prior=t;
  if((second-period.start)%300)return fail('TIME_GRID_MISMATCH');
  if(second!==period.end&&t+STEP>now){incomplete++;continue}
  const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume[i];
  if(![o,h,l,c].every(n=>finite(n)&&n>0)||h<Math.max(o,c,l)||l>Math.min(o,c,h)||!finite(v)||v<0)return fail('INVALID_OHLCV');
  if(second===period.end){if(v!==0)return fail('TERMINAL_VOLUME_UNVERIFIED');terminal++;continue}
  if(candles.length&&(t-candles.at(-1).t)%STEP)return fail('TIME_GRID_MISMATCH');
  candles.push({t,o,h,l,c,v});
 }
 if(candles.length<2||!candles.some(b=>b.v>0))return fail('INSUFFICIENT_CLOSED_BARS_OR_VOLUME');
 const warnings=[];
 const gaps=candles.slice(1).reduce((n,b,i)=>n+(b.t-candles[i].t)/STEP-1,0);
 const full=gaps===0&&candles[0].t===period.start*1000&&candles.at(-1).t+STEP===period.end*1000;
 if(!full)warnings.push('PROVIDER_WINDOW_NOT_FULLY_OBSERVED');
 if(incomplete)warnings.push('OPEN_BAR_EXCLUDED');
 if(now-candles.at(-1).t>4*86400000)warnings.push('OLD_REFERENCE_SESSION');
 return {ok:true,status:warnings.length?'REFERENCE_PARTIAL':'REFERENCE_ONLY',transportCalls:0,
  data:{kind:'public-five-minute-reference-v1',instrument:{symbol:'AAPL',currency:'USD',exchange:'NMS',timezone:'America/New_York'},
   interval:'5m',source:'Yahoo Finance',candles,barTimeMeaning:'PROVIDER_INTERVAL_START',receivedAt:now,
   receiptTimeMeaning:'ADAPTER_RECEIPT_ONLY',providerFetchAt:null,
   providerPeriodStart:period.start*1000,providerPeriodEnd:period.end*1000,providerWindowFullyObserved:full,
   terminalPointsExcluded:terminal,incompleteBarsExcluded:incomplete,missingIntervals:gaps},warnings,
  realTimeVerified:false,exchangeSessionVerified:false,priceFinalizedVerified:false,tradeVwapVerified:false,
  signalReady:false,accountConnected:false,canPlaceOrder:false};
}
function create({readJSON,capability=()=>false,now=Date.now}={}){
 let alive=true,generation=0,pending=null;
 function read(symbol){
  if(!alive)return Promise.resolve(fail('DESTROYED'));
  const request=plan(symbol);if(!request.ok)return Promise.resolve(request);
  let enabled=false;try{enabled=capability()===true}catch{}
  if(!enabled)return Promise.resolve(fail('INTRADAY_NOT_ACTIVATED'));
  if(typeof readJSON!=='function')return Promise.resolve(fail('AUTHENTICATED_TRANSPORT_REQUIRED'));
  if(pending)return pending;
  const current=generation;
  const job=(async()=>{
   try{
    const payload=await readJSON(request.url);
    if(!alive||current!==generation)return fail('STALE_RESULT_DISCARDED',1);
    let stillEnabled=false;try{stillEnabled=capability()===true}catch{}
    if(!stillEnabled)return fail('STALE_RESULT_DISCARDED',1);
    return {...parse(payload,now()),transportCalls:1};
   }catch{return fail(!alive||current!==generation?'STALE_RESULT_DISCARDED':'INTRADAY_READ_FAILED',1)}
  })();
  pending=job;job.finally(()=>{if(pending===job)pending=null});return job;
 }
 return {read,invalidate(){generation++;pending=null},destroy(){alive=false;generation++;pending=null}};
}
const api=Object.freeze({plan,candidateUrl,parse,create});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestFiveMinuteReadCandidateV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
