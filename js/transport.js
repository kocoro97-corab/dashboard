/* One explicit transport; never retry credentials or writes on another backend. */
(function(root){
  'use strict';
  function failure(code){const e=new Error(code);e.code=code;e.diagnostic={layer:'relay',code};return e}
  function config(){
    const c=root.MYINVEST_TRANSPORT_CONFIG||{mode:'direct'};
    if(c.mode==='direct')return c;
    if(c.mode!=='relay'||typeof c.endpoint!=='string')throw failure('RELAY_CONFIG_INVALID');
    let url;try{url=new URL(c.endpoint)}catch(e){throw failure('RELAY_CONFIG_INVALID')}
    const local=host=>['localhost','127.0.0.1'].includes(host);
    const development=c.development===true&&root.location&&root.location.protocol==='http:'&&local(root.location.hostname)&&local(url.hostname);
    if(c.persistentRelay===true&&c.endpoint!==root.MYINVEST_PERSISTENT_RELAY?.endpoint)throw failure('RELAY_CONFIG_INVALID');
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/api'||!(url.protocol==='https:'||development&&url.protocol==='http:'))throw failure('RELAY_CONFIG_INVALID');
    return c;
  }
  function isRelay(){return config().mode==='relay'}
  // Shared physical read budget. Auth and reviewed writes are never replayed.
  const reads=new Set(['publicFetch','nhQuotes','nhExternalQuotes','nhAccounts','externalHoldings','externalHistory','externalAccounts','googleCalendarStatus','googleCalendarList','googleCalendarEvents']);
  const waiting=[],running=new Set(),publicPending=new Map();let epoch=0,completed=0,cancelled=0,pauseUntil=0,pauseTimer=null;
  const readClock=()=>root.performance?.now?.()??Date.now();
  const abortError=()=>Object.assign(new Error('READ_CANCELLED'),{name:'AbortError',code:'READ_CANCELLED'});
  function cancelReads(){epoch++;for(const job of [...waiting,...running])job.cancel(failure('SESSION_CHANGED'));root.dispatchEvent?.(new Event('myinvest:cancel-reads'));pump()}
  function deferReads(ms){if(!Number.isFinite(ms)||ms<0)return;pauseUntil=Math.max(pauseUntil,readClock()+Math.min(ms,30000));pump()}
  function pump(){
    for(let i=0;i<waiting.length;){const job=waiting[i];if(job.cancelled||!job.current()){waiting.splice(i,1);job.cancel(failure('SESSION_CHANGED'));continue}i++}
    if(!waiting.length&&pauseTimer!==null){root.clearTimeout(pauseTimer);pauseTimer=null}
    if(waiting.length&&readClock()<pauseUntil){if(pauseTimer===null&&root.setTimeout)pauseTimer=root.setTimeout(()=>{pauseTimer=null;pump()},pauseUntil-readClock());return}
    while(waiting.length){if(running.size>=waiting[0].limit)return;
      const job=waiting.shift();if(job.cancelled||!job.current()){job.cancel(failure('SESSION_CHANGED'));continue}
      running.add(job);job.started=true;
      // Do not abort a physical request on navigation: Worker lease release may
      // lag a browser abort. Keep its slot until the server response settles.
      Promise.resolve().then(job.run).then(value=>{if(job.current()&&!job.cancelled)job.resolve(value);else job.cancel(failure('SESSION_CHANGED'))},error=>job.reject(error))
        .finally(()=>{job.detach();running.delete(job);completed++;pump()});
    }
  }
  function enqueueRead(run,current,signal,limit){
    if(waiting.length>=128)return Promise.reject(failure('READ_QUEUE_FULL'));
    return new Promise((resolve,reject)=>{
      const job={run,current,resolve,reject,limit,cancelled:false,started:false,detach(){signal?.removeEventListener('abort',onAbort)},cancel(error){if(this.cancelled)return;this.cancelled=true;cancelled++;this.detach();reject(error)}};
      const onAbort=()=>{job.cancel(abortError());pump()};
      if(signal?.aborted){job.cancel(abortError());return}
      signal?.addEventListener('abort',onAbort,{once:true});waiting.push(job);pump();
    });
  }
  function readState(){return {generation:epoch,active:running.size,queued:waiting.filter(j=>!j.cancelled).length,completed,cancelled,limit:config().persistentRelay===true?2:1}}
  function post(payload,options){
    const c=config();options=options||{};
    if(c.mode==='direct')return root.fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:options.signal});
    const data={...payload},headers={'Content-Type':'application/json'};
    if(c.devAccessCode!=null){
      if(!/^[A-Za-z0-9_-]{16,128}$/.test(c.devAccessCode))throw failure('DEV_ACCESS_REQUIRED');
      headers['X-MyInvest-Dev-Key']=c.devAccessCode;
    }
    if(c.devSession===true){
      const loc=root.location;
      const routeOK=!loc?.hash||root.AppRouter?.validHash(loc.hash)===true;
      if(!loc||loc.origin!=='https://kocoro97-corab.github.io'||!['/dashboard-v2-dev/','/dashboard-v2-dev/index.html'].includes(loc.pathname)||loc.search||!routeOK)throw failure('RELAY_CONFIG_INVALID');
      headers['X-MyInvest-Dev-Client']='dashboard-v2-dev';
    }
    if(data.token!=null){
      if(typeof data.token!=='string'||!/^[a-fA-F0-9]{64}$/.test(data.token))throw failure('AUTH_REQUIRED');
      headers.Authorization='Bearer '+data.token;delete data.token;
    }
    const queued=reads.has(data.action),endpoint=c.endpoint,generation=epoch,token=payload.token,route=root.location?.hash,access=c.devAccessCode;
    const current=()=>generation===epoch&&c===root.MYINVEST_TRANSPORT_CONFIG&&c.endpoint===endpoint&&c.mode==='relay'&&c.devAccessCode===access&&route===root.location?.hash&&!options.signal?.aborted&&(token==null||token===(typeof LS==='function'?LS('invest_session_token'):null));
    const send=()=>{
      const controller=queued&&typeof root.AbortController==='function'?new root.AbortController():null;
      const timer=controller&&root.setTimeout?root.setTimeout(()=>controller.abort(),35000):null;
      return root.fetch(endpoint,{method:'POST',headers,body:JSON.stringify(data),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin',signal:queued?controller?.signal:options.signal}).then(async response=>{
      if(queued&&typeof response.arrayBuffer==='function'&&typeof response.clone==='function')await response.clone().arrayBuffer();
      if(queued&&!current())throw failure('SESSION_CHANGED');
      if(root.ReadStatus&&['nhAccounts','nhQuotes','nhExternalQuotes','externalHoldings','externalHistory','externalAccounts'].includes(data.action))root.ReadStatus.observeResponse(response,data.action,()=>!queued||current());
      if(c.persistentRelay===true&&['saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'].includes(data.action)){let result;try{result=await response.clone().json()}catch{throw failure('RELAY_WRITE_OUTCOME_UNKNOWN')}if(!result||typeof result.success!=='boolean')throw failure('RELAY_WRITE_OUTCOME_UNKNOWN')}
      return response;
    }).catch(error=>{
      if(root.ReadStatus&&(!queued||current())&&payload.token===(typeof LS==='function'?LS('invest_session_token'):null)&&['nhAccounts','nhQuotes','nhExternalQuotes','externalHoldings','externalHistory','externalAccounts'].includes(data.action))root.ReadStatus.note(error,{scope:data.action==='nhQuotes'?'public':'account',key:'account:'+data.action});
      if(['register','changePassword','approveUser','saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'].includes(data.action))throw failure('RELAY_WRITE_OUTCOME_UNKNOWN');
      throw error;
    })
      .finally(()=>{if(timer!==null)root.clearTimeout(timer)});
    };
    return queued?enqueueRead(send,current,options.signal,c.persistentRelay===true?2:1):send();
  }

  async function publicRead(url,options){
    options=options||{};const started=config(),access=started.devAccessCode,mode=started.mode,token=typeof LS==='function'?LS('invest_session_token'):null,endpoint=started.endpoint,generation=epoch,route=root.location?.hash,current=()=>generation===epoch&&(mode!=='relay'||started===root.MYINVEST_TRANSPORT_CONFIG)&&mode===config().mode&&access===config().devAccessCode&&endpoint===config().endpoint&&route===root.location?.hash&&!options.signal?.aborted&&token===(typeof LS==='function'?LS('invest_session_token'):null);
    const prior=publicPending.get(url);if(prior&&prior.current()&&prior.signal===options.signal)return prior.promise;
    const perform=async()=>{
      if(!isRelay()){const r=await root.fetch(MYP()+(MYP().includes('?')?'&':'?')+'url='+encodeURIComponent(url),options);if(!r.ok){const e=failure('GAS_HTTP');e.http=r.status;throw e}const text=await r.text();return {ok:true,status:r.status,text:async()=>text}}
      const response=await post({action:'publicFetch',url,token},options);let data;try{data=await response.json()}catch{const e=failure('RELAY_RESPONSE_INVALID');e.http=response.status;throw e}
      if(!response.ok||!data||data.success!==true||typeof data.text!=='string'){
        const safe=new Set(['AUTH_REQUIRED','RELAY_PUBLIC_URL_DENIED','RELAY_PUBLIC_FAILED','RELAY_RATE_LIMIT','RELAY_BUSY','RELAY_UPSTREAM_NETWORK','RELAY_REDIRECT_DENIED','RELAY_GAS_ACCESS_REQUIRED','RELAY_TARGET_MISMATCH','RELAY_ACCESS_CLOSED']);const e=failure(safe.has(data?.code)?data.code:'RELAY_PUBLIC_FAILED');e.http=response.status;const hint=response.headers?.get?.('Retry-After');if(hint!=null)e.retryAfter=String(hint).slice(0,128);if(['relay','gas','nh'].includes(data?.layer))e.verifiedLayer=data.layer;throw e;
      }
      return {ok:true,status:response.status,text:async()=>data.text};
    };
    const promise=root.ReadStatus?root.ReadStatus.execute(url,perform,{current,signal:options.signal}):perform();
    const job={promise,current,signal:options.signal};publicPending.set(url,job);try{return await promise}finally{if(publicPending.get(url)===job)publicPending.delete(url)}
  }
  root.DashboardTransport=Object.freeze({post,publicRead,isRelay,cancelReads,readState,deferReads});
  if(typeof module==='object'&&module.exports)module.exports=root.DashboardTransport;
})(typeof globalThis!=='undefined'?globalThis:this);
