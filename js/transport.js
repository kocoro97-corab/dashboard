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
    return root.fetch(c.endpoint,{method:'POST',headers,body:JSON.stringify(data),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin',signal:options.signal}).then(async response=>{
      if(root.ReadStatus&&['nhAccounts','nhQuotes','nhExternalQuotes','externalHoldings','externalHistory','externalAccounts'].includes(data.action))root.ReadStatus.observeResponse(response,data.action,()=>payload.token===(typeof LS==='function'?LS('invest_session_token'):null));
      if(c.persistentRelay===true&&['saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'].includes(data.action)){let result;try{result=await response.clone().json()}catch{throw failure('RELAY_WRITE_OUTCOME_UNKNOWN')}if(!result||typeof result.success!=='boolean')throw failure('RELAY_WRITE_OUTCOME_UNKNOWN')}
      return response;
    }).catch(error=>{
      if(root.ReadStatus&&payload.token===(typeof LS==='function'?LS('invest_session_token'):null)&&['nhAccounts','nhQuotes','nhExternalQuotes','externalHoldings','externalHistory','externalAccounts'].includes(data.action))root.ReadStatus.note(error,{scope:data.action==='nhQuotes'?'public':'account',key:'account:'+data.action});
      if(['register','changePassword','approveUser','saveExternalHoldings','restoreExternalHoldings','saveExternalAccounts'].includes(data.action))throw failure('RELAY_WRITE_OUTCOME_UNKNOWN');
      throw error;
    });
  }
  async function publicRead(url,options){
    options=options||{};const token=typeof LS==='function'?LS('invest_session_token'):null,current=()=>token===(typeof LS==='function'?LS('invest_session_token'):null);
    const perform=async()=>{
      if(!isRelay()){const r=await root.fetch(MYP()+(MYP().includes('?')?'&':'?')+'url='+encodeURIComponent(url),options);if(!r.ok){const e=failure('GAS_HTTP');e.http=r.status;throw e}const text=await r.text();return {ok:true,status:r.status,text:async()=>text}}
      const response=await post({action:'publicFetch',url,token},options);let data;try{data=await response.json()}catch{const e=failure('RELAY_RESPONSE_INVALID');e.http=response.status;throw e}
      if(!response.ok||!data||data.success!==true||typeof data.text!=='string'){
        const safe=new Set(['AUTH_REQUIRED','RELAY_PUBLIC_URL_DENIED','RELAY_PUBLIC_FAILED','RELAY_RATE_LIMIT','RELAY_BUSY','RELAY_UPSTREAM_NETWORK','RELAY_REDIRECT_DENIED','RELAY_GAS_ACCESS_REQUIRED','RELAY_TARGET_MISMATCH','RELAY_ACCESS_CLOSED']);const e=failure(safe.has(data?.code)?data.code:'RELAY_PUBLIC_FAILED');e.http=response.status;if(['relay','gas','nh'].includes(data?.layer))e.verifiedLayer=data.layer;throw e;
      }
      return {ok:true,status:response.status,text:async()=>data.text};
    };
    return root.ReadStatus?root.ReadStatus.execute(url,perform,{current,signal:options.signal}):perform();
  }
  root.DashboardTransport=Object.freeze({post,publicRead,isRelay});
  if(typeof module==='object'&&module.exports)module.exports=root.DashboardTransport;
})(typeof globalThis!=='undefined'?globalThis:this);
