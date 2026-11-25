/* Development-only idle warming of already implemented public collections.
   No account/auth/write operations and no new provider endpoints. */
(function(root){'use strict';
 const NEXT=Object.freeze({home:'sectors',market:'sectors',sectors:'news',stocks:'news',strategy:'news'});
 function create({state,readState,load,later=(fn,ms)=>setTimeout(fn,ms),clearLater=id=>clearTimeout(id)}){
  if(typeof state!=='function'||typeof readState!=='function'||typeof load!=='function')throw Error('IDLE_WARM_CONFIG_INVALID');
  let timer=null,scope=null;
  const attempted=new Set();
  function cancel(){if(timer!==null){clearLater(timer);timer=null}}
  function clear(){cancel();attempted.clear();scope=null}
  function allowed(s){return !!s&&s.authenticated===true&&s.publicConnected===true&&s.visible===true&&typeof s.scope==='string'&&s.scope.length>0}
  function schedule(page){
   cancel();
   const target=NEXT[page],start=state();
   if(!target||!allowed(start)||start.page!==page)return false;
   if(scope!==start.scope){attempted.clear();scope=start.scope}
   if(attempted.has(target))return false;
   timer=later(()=>{
    timer=null;const current=state();
    if(!allowed(current)||current.scope!==start.scope||current.page!==page||current.revision!==start.revision)return;
    const relay=readState();
    if(!relay||relay.active!==0||relay.queued!==0||relay.backpressureMs!==0)return;
    attempted.add(target);
    Promise.resolve().then(()=>load(target)).catch(()=>{});
   },1400);
   return true;
  }
  return Object.freeze({schedule,cancel,clear});
 }
 const api=Object.freeze({create});
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.MYInvestIdlePrefetch=api;
})(globalThis);
