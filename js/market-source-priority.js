(function(root){
'use strict';
// Read-only, explicit adapter chain. Never copies quotes from TradingView iframes.
const ORDER=Object.freeze({futures:['NH_FUTURES','KIS','KOSCOM'],tick:['IBKR','DXFEED']});
const registry=new Map();
const dateEpoch=v=>{const n=typeof v==='number'?v:Date.parse(String(v||''));return Number.isFinite(n)?(n>0&&n<1e11?n*1000:n):null};
const validExpiry=s=>{const t=String(s||'').replace(/-/g,'');if(!/^\d{8}$/.test(t))return false;const y=+t.slice(0,4),m=+t.slice(4,6),d=+t.slice(6,8),utc=Date.UTC(y,m-1,d);return Number.isFinite(utc)&&new Date(utc).toISOString().slice(0,10)===t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)&&utc>=Date.now()-86400000};
function normalizeFutures(data,provider){
 if(!data||data.product!=='KOSDAQ150_FUT'||data.verified!==true||typeof data.contractCode!=='string'||!/^[A-Z0-9_-]{6,28}$/.test(data.contractCode)||!validExpiry(data.expiry))return null;
 const p=Number(data.price),prev=Number(data.previousClose),at=dateEpoch(data.observedAt),now=Date.now();
 if(!(p>0&&prev>0&&Number.isFinite(p)&&Number.isFinite(prev)&&at&&at<=now+60000&&at>=now-7*86400000))return null;
 return {p,prev,observedAt:at,expiry:String(data.expiry).replace(/-/g,''),contractCode:data.contractCode,contractVerified:true,provider,delayed:data.delayed===true,stale:now-at>15*60000};
}
function normalizeTick(data,provider){
 if(!data||!['TICK-NYSE','USI:TICK.NY'].includes(String(data.symbol||''))||data.verified!==true)return null;
 const p=Number(data.value),at=dateEpoch(data.observedAt),now=Date.now();
 if(!Number.isInteger(p)||Math.abs(p)>5000||!at||at>now+60000||at<now-10*60000)return null;
 return {p,observedAt:at,provider,delayed:data.delayed===true,stale:now-at>120000};
}
function tickContext(value){
 if(!Number.isFinite(value))return '실제 NYSE TICK 수치 미확인';
 if(value>=1000)return '강한 매수 우위 · 단기 과열/추세 지속 모두 가능, 가격 확인';
 if(value>=600)return '매수 우위 확대 · 상승 종목 참여도 확인';
 if(value>0)return '완만한 매수 우위 · 추세 확인 필요';
 if(value<=-1000)return '강한 매도 우위 · 투매/반등 가능성 모두 점검';
 if(value<=-600)return '매도 우위 확대 · 하락 위험 관리';
 if(value<0)return '완만한 매도 우위 · 방향 확인 필요';
 return '상승·하락 틱 균형';
}
function register(kind,provider,fetcher){
 if(!ORDER[kind]?.includes(provider)||typeof fetcher!=='function')return false;
 registry.set(kind+':'+provider,fetcher);return true;
}
async function resolve(kind){
 if(!ORDER[kind])return {quote:null,attempts:[]};
 const attempts=[];
 for(const provider of ORDER[kind]){
  const fn=registry.get(kind+':'+provider);
  if(!fn){attempts.push({provider,status:'NOT_CONFIGURED'});continue}
  try{
   const result=await fn();
   const quote=kind==='futures'?normalizeFutures(result,provider):normalizeTick(result,provider);
   if(quote){attempts.push({provider,status:'OK'});return {quote,attempts}}
   attempts.push({provider,status:'INVALID_OR_STALE'});
  }catch(e){attempts.push({provider,status:'FAILED',code:/^[A-Z0-9_]{3,60}$/.test(String(e?.code||''))?e.code:'PROVIDER_ERROR'})}
 }
 return {quote:null,attempts};
}
root.MyInvestMarketSourcePriority=Object.freeze({register,resolve,tickContext,normalizeFutures,normalizeTick,order:ORDER});
})(window);
