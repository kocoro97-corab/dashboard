(function(root){'use strict';
/* In-memory, anonymous UI latency measurement. Never sends or stores data. */
const ALLOWED=new Set(['home','market','sectors','stocks','strategy','news','accounts','settings','diagnostics']);
let now=()=>root.performance?.now?.()??Date.now();
let serial=0,results=[],pending=new Map();
function begin(page,phase='navigation'){
 if(!ALLOWED.has(page)||!['navigation','refresh'].includes(phase))return null;
 const token=++serial;
 pending.set(token,{page,phase,started:now()});
 if(pending.size>12)pending.delete(pending.keys().next().value);
 return token;
}
function finish(token,result='ready'){
 if(!Number.isSafeInteger(token)||!pending.has(token))return false;
 const item=pending.get(token);pending.delete(token);
 if(!['ready','failed','cancelled'].includes(result))result='failed';
 const ms=now()-item.started;
 if(!Number.isFinite(ms)||ms<0||ms>86400000)return false;
 results.push(Object.freeze({page:item.page,phase:item.phase,result,
  elapsedMs:Math.round(ms),atMs:Math.round(now())}));
 if(results.length>50)results=results.slice(-50);
 return true;
}
function snapshot(){
 const items=results.map(({page,phase,result,elapsedMs})=>({page,phase,result,elapsedMs}));
 const summary={};
 for(const page of ALLOWED){
  const pageItems=items.filter(x=>x.page===page);
  if(!pageItems.length)continue;
  const durations=pageItems.filter(x=>x.result==='ready').map(x=>x.elapsedMs).sort((a,b)=>a-b);
  const cancelled=pageItems.filter(x=>x.result==='cancelled').map(x=>x.elapsedMs);
  const failed=pageItems.filter(x=>x.result==='failed');
  summary[page]={count:durations.length,
   medianMs:durations.length?durations[Math.floor((durations.length-1)/2)]:null,
   maxMs:durations.at(-1)??null,
   cancelledCount:cancelled.length,cancelledMaxMs:cancelled.length?Math.max(...cancelled):null,
   failedCount:failed.length};
 }
 return {schemaVersion:1,scope:'UI route elapsed time only, not API breakdown',samples:items,summary,
  memoryOnly:true,networkCalls:0,containsPrivateFields:false};
}
// Navigation/Resource Timing provides local-browser evidence without exposing
// resource URLs, query parameters, account state or any request payload.
function browserSnapshot(){
 const perf=root.performance;
 const entries=type=>{try{const rows=perf?.getEntriesByType?.(type);return Array.isArray(rows)?rows:[]}catch{return []}};
 const nav=entries('navigation')[0],paint=entries('paint').find(x=>x.name==='first-contentful-paint');
 const resources=entries('resource');
 const ms=value=>Number.isFinite(value)&&value>0?Math.round(value):null;
 return {
  schemaVersion:1,scope:'CURRENT_BROWSER_DOCUMENT_SYNTHETIC_OR_REAL_UNLABELLED',
  navigation:{domContentLoadedMs:ms(nav?.domContentLoadedEventEnd),loadEventMs:ms(nav?.loadEventEnd),firstContentfulPaintMs:ms(paint?.startTime)},
  resourceCounts:{total:resources.length,firstPartyScripts:resources.filter(x=>typeof x.name==='string'&&x.name.includes('/js/')).length,
   ocrScripts:resources.filter(x=>typeof x.name==='string'&&x.name.includes('tesseract.min.js')).length,
   usInstrumentCatalog:resources.filter(x=>typeof x.name==='string'&&x.name.includes('/data/us-instruments.json')).length},
  resourceTimingAvailable:typeof perf?.getEntriesByType==='function',
  memoryOnly:true,networkCalls:0,containsPrivateFields:false
 };
}
function clear(){pending.clear();results=[]}
const api=Object.freeze({begin,finish,snapshot,browserSnapshot,clear});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestWebPerformance=api;
})(globalThis);
