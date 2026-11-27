/* Development-only, bounded warming of verified public inputs, and the authorized general-account read. */
(function(root){'use strict';
const routes=new Set(['home','market','sectors','stocks','strategy']);
function targets({page,market,selection}){
 if(!routes.has(page)||!['KR','US'].includes(market))return [];
 const stock=selection?.market===market&&/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(selection?.symbol??'');
 const result=[];
 if(page==='sectors'&&stock)result.push({kind:'stock',market,symbol:selection.symbol});
 result.push({kind:'benchmark',market});
 if(['home','market'].includes(page)&&stock)result.push({kind:'stock',market,symbol:selection.symbol});
 if(['home','market'].includes(page))result.push({kind:'market-inputs',market});
 return result;
}
function create({state,readState,load,loadAccount,later=(fn,ms)=>setTimeout(fn,ms),clearLater=id=>clearTimeout(id),now=Date.now}){
 let timer=null,run=null,ready=null,retries=0,session=null,accountScope=null,accountJob=null,accountArmed=false;const holds=new Set(),recent=new Map();
 const valid=s=>s?.enabled===true&&s.authenticated===true&&s.publicConnected===true&&s.visible===true&&!!s.scope;
 const same=(s,t)=>valid(s)&&t&&s.scope===t.scope&&s.page===t.page&&s.revision===t.revision;
 function stopWork(){if(timer!==null){clearLater(timer);timer=null}if(run){run.abort();run=null}}
 function cancel(){stopWork();ready=null;holds.clear();accountArmed=false}
 function clear(){cancel();recent.clear();session=null;accountScope=null;accountJob=null}
 function queue(){
  if(timer!==null||run||holds.size||!same(state(),ready))return;
  timer=later(tick,0);
 }
 async function tick(){
  timer=null;const s=state();
  if(holds.size||!same(s,ready))return;
  const r=readState();
  if(!r||r.active!==0||r.queued!==0||r.backpressureMs!==0){
   if(r?.backpressureMs>0&&++retries<3)timer=later(tick,Math.min(r.backpressureMs+10,30010));
   return;
  }
  const route=ready,item=targets(s).find(t=>!route.attempted.has(key(t))&&(recent.get(key(t))??-Infinity)<=now());
  if(!item)return;
  route.attempted.add(key(item));const controller=new AbortController();run=controller;
  try{
   await load(item,controller.signal);
   if(!controller.signal.aborted&&same(state(),route)){
    recent.set(key(item),now()+120000);
    if(recent.size>32)recent.delete(recent.keys().next().value);
   }
  }catch{}finally{if(run===controller){run=null;queue()}}
 }
 const key=item=>[item.kind,item.market,item.symbol??''].join(':');
 function schedule(page){
  const s=state();
  if(!valid(s)||s.page!==page||!routes.has(page))return false;
  if(session!==s.scope){recent.clear();session=s.scope}
  ready={scope:s.scope,revision:s.revision,page,attempted:new Set()};retries=0;capacity();return true;
 }
 function accountCapacity(){
  const s=state();
  if(!accountArmed||!s?.enabled||!s.authenticated||!s.visible||!s.scope||!s.accountAllowed||
    s.page==='accounts'||accountScope===s.scope||accountJob||!loadAccount)return;
  const r=readState();
  if(!r||r.queued!==0||r.backpressureMs!==0||r.active>=(r.limit??1))return;
  // A free slot may be needed by the next wave of a multi-stage visible read.
  // Only an explicitly proven one-request remainder can share before it finishes.
  if(!same(s,ready)&&(r.active===0||s.singleReadConfirmed!==true))return;
  accountScope=s.scope;
  const scope=s.scope,job=Promise.resolve().then(()=>{
   const current=state();
   if(current.scope!==scope||!current.authenticated||!current.visible||!current.accountAllowed||current.page==='accounts'){if(accountScope===scope)accountScope=null;return false;}
   return loadAccount();
  });
  accountJob=job;
  job.catch(()=>{}).finally(()=>{if(accountJob===job){accountJob=null;queue()}});
 }
 function capacity(){accountCapacity();queue()}
 function armAccount(){accountArmed=true;Promise.resolve().then(capacity)}
 function hold(){
  const id={};holds.add(id);stopWork();
  return ()=>{if(holds.delete(id)&&!holds.size){retries=0;queue()}};
 }
 return Object.freeze({schedule,hold,cancel,clear,suspend:stopWork,resume:capacity,armAccount,capacity});
}
const api=Object.freeze({create,targets});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestIdlePrefetch=api;
})(globalThis);
