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
  const durations=items.filter(x=>x.page===page&&x.result==='ready').map(x=>x.elapsedMs).sort((a,b)=>a-b);
  if(!durations.length)continue;
  summary[page]={count:durations.length,medianMs:durations[Math.floor((durations.length-1)/2)],
   maxMs:durations.at(-1)};
 }
 return {schemaVersion:1,scope:'UI route elapsed time only, not API breakdown',samples:items,summary,
  memoryOnly:true,networkCalls:0,containsPrivateFields:false};
}
function clear(){pending.clear();results=[]}
const api=Object.freeze({begin,finish,snapshot,clear});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestWebPerformance=api;
})(globalThis);
