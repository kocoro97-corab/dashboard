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
      if(!loc||loc.origin!=='https://kocoro97-corab.github.io'||!['/dashboard-v2-dev/','/dashboard-v2-dev/index.html'].includes(loc.pathname)||loc.search||loc.hash)throw failure('RELAY_CONFIG_INVALID');
      headers['X-MyInvest-Dev-Client']='dashboard-v2-dev';
    }
    if(data.token!=null){
      if(typeof data.token!=='string'||!/^[a-fA-F0-9]{64}$/.test(data.token))throw failure('AUTH_REQUIRED');
      headers.Authorization='Bearer '+data.token;delete data.token;
    }
    return root.fetch(c.endpoint,{method:'POST',headers,body:JSON.stringify(data),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin',signal:options.signal}).catch(error=>{
      if(['register','changePassword','approveUser','saveExternalHoldings','restoreExternalHoldings'].includes(data.action))throw failure('RELAY_WRITE_OUTCOME_UNKNOWN');
      throw error;
    });
  }
  async function publicRead(url,options){
    if(!isRelay())return root.fetch(MYP()+(MYP().includes('?')?'&':'?')+'url='+encodeURIComponent(url),options);
    const token=typeof LS==='function'?LS('invest_session_token'):null;
    const response=await post({action:'publicFetch',url,token},options),data=await response.json();
    if(!response.ok||!data||data.success!==true||typeof data.text!=='string')throw failure('RELAY_PUBLIC_FAILED');
    return {ok:true,status:response.status,text:async()=>data.text};
  }
  root.DashboardTransport=Object.freeze({post,publicRead,isRelay});
  if(typeof module==='object'&&module.exports)module.exports=root.DashboardTransport;
})(typeof globalThis!=='undefined'?globalThis:this);
