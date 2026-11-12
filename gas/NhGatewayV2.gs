// NH Read-Only Gateway V2. Injected transport; no account data or raw errors in diagnostics.
function createNhGatewayV2_(io) {
  const api = 'https://api.nhplug.com:8443', docs = 'https://www.nhplug.com';
  const routes = [
    [api,'/oauth2/token','post','token'],
    [api,'/n2/acctinfo','post','inquiry'],
    [api,'/krstock/inquiry/v1/balance','post','inquiry'],
    [api,'/gbstock/inquiry/v1/balance','post','inquiry'],
    [api,'/krstock/quote/v1/currentPrice','post','inquiry'],
    [api,'/gbstock/quote/v1/current','post','inquiry'],
    [api,'/krfuture/quote/v1/day','post','inquiry'],
    [docs,'/openapi-docs/krstock/openapi.json','get','spec'],
    [docs,'/openapi-docs/gbstock/openapi.json','get','spec'],
    [docs,'/openapi-docs/krfuture/openapi.json','get','spec'],
    [docs,'/openapi-docs/gbfuture/openapi.json','get','spec']
  ];
  function fail(code,http){const e=new Error(code);e.safeCode=code;if(Number.isInteger(http)&&http>=100&&http<=599)e.safeHttp=http;throw e}
  function validate(origin,path,method,purpose){
    if(!routes.some(r=>origin===r[0]&&path===r[1]&&method===r[2]&&purpose===r[3]))fail('NH_PATH');
  }
  function request(origin,path,method,purpose,data){
    validate(origin,path,method,purpose);data=data||{};
    const options={method:method,followRedirects:false,muteHttpExceptions:true};let url=origin+path;
    if(purpose==='token'){
      if(typeof data.key!=='string'||!data.key||typeof data.secret!=='string'||!data.secret||data.token)fail('NH_CONFIG');
      // Existing verified token contract; queries are built here, never supplied by a caller.
      url+='?appkey='+encodeURIComponent(data.key)+'&appsecretkey='+encodeURIComponent(data.secret)+'&grant_type=client_credentials&scope=oob';
      options.contentType='application/x-www-form-urlencoded';options.payload='';
    }else if(purpose==='inquiry'){
      if(data.key||data.secret||typeof data.token!=='string'||!data.token||/[\r\n]/.test(data.token))fail('NH_CONFIG');
      options.contentType='application/json';options.headers={Authorization:'Bearer '+data.token};
      if(data.cts){
        const flag=data.cts_flag||'Y';
        if(typeof data.cts!=='string'||/[\r\n]/.test(data.cts)||typeof flag!=='string'||/[\r\n]/.test(flag))fail('NH_CONFIG');
        options.headers.cts=data.cts;options.headers.cts_flag=flag;
      }
      options.payload=JSON.stringify({Input_0:data.input||{}});
    }else if(data.token||data.key||data.secret)fail('NH_CONFIG');
    let response;
    try{response=io.fetch(url,options)}catch(e){fail(purpose==='token'?'NH_TOKEN':'NH_NETWORK')}
    const http=response.getResponseCode();
    if(http>=300&&http<400)fail('NH_HTTP',http); // No Location/body read and no redirect retry.
    return response;
  }
  function token(force){
    const p=io.properties();
    function cached(){const t=p.getProperty('NHPLUG_TOKEN'),exp=Number(p.getProperty('NHPLUG_TOKEN_EXP'));return t&&Number.isFinite(exp)&&io.now()<exp-600000?t:null}
    if(!force){const t=cached();if(t)return t}
    return io.withLock(function(){
      if(!force){const t=cached();if(t)return t}
      const r=request(api,'/oauth2/token','post','token',{key:p.getProperty('NHPLUG_APP_KEY'),secret:p.getProperty('NHPLUG_APP_SECRET')});
      let b;try{b=JSON.parse(r.getContentText())}catch(e){fail('NH_TOKEN',r.getResponseCode())}
      if(r.getResponseCode()!==200||!b||typeof b.access_token!=='string'||!b.access_token||/[\r\n]/.test(b.access_token))fail('NH_TOKEN',r.getResponseCode());
      const seconds=b.expires_in==null?86400:Number(b.expires_in);
      if(!Number.isFinite(seconds)||seconds<=0||seconds>604800)fail('NH_TOKEN');
      p.setProperty('NHPLUG_TOKEN',b.access_token);p.setProperty('NHPLUG_TOKEN_EXP',String(io.now()+seconds*1000));return b.access_token;
    });
  }
  function read(path,input,continuation,loadToken){
    validate(api,path,'post','inquiry'); // Must precede even token fetches.
    let bearer=loadToken(false);
    for(let attempt=0;attempt<2;attempt++){
      const r=request(api,path,'post','inquiry',{token:bearer,input:input,cts:continuation&&continuation.cts,cts_flag:continuation&&continuation.cts_flag});
      const http=r.getResponseCode();
      if(http===401&&attempt===0){bearer=loadToken(true);continue}
      io.sleep(220);
      let body;try{body=JSON.parse(r.getContentText())}catch(e){body={rsp_cd:'PARSE'}}
      if(!body||typeof body!=='object'||Array.isArray(body))body={rsp_cd:'PARSE'};
      const h=r.getHeaders();const header=name=>{const k=Object.keys(h).find(k=>k.toLowerCase()===name);return k?h[k]:''};
      return {http:http,body:body,cts:header('cts'),cts_flag:header('cts_flag')};
    }
  }
  return {validate:validate,request:request,token:token,read:read};
}
