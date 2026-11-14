const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../gas/Nhplug.gs'),'utf8');
const origin='https://api.nhplug.com:8443',docs='https://www.nhplug.com';
const canary='SYNTHETIC_PRIVATE_CANARY';
const inquiryPaths=['/n2/acctinfo','/krstock/inquiry/v1/balance','/gbstock/inquiry/v1/balance','/krstock/quote/v1/currentPrice','/gbstock/quote/v1/current','/krfuture/quote/v1/day'];
function backend(reply){
  const requests=[],logs=[],props={NHPLUG_APP_KEY:canary+'?key',NHPLUG_APP_SECRET:canary+'&secret'};
  const ctx=vm.createContext({Logger:{log:x=>logs.push(x)},Utilities:{sleep(){},formatDate:()=> 'synthetic timestamp'},
    sessionUser_:()=> 'synthetic-user',jsonResponse:x=>x,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    UrlFetchApp:{fetch:(url,options)=>{
      const request={url,options};requests.push(request);
      if(reply)return reply(request);
      return response(200,{access_token:canary,expires_in:86400,rsp_cd:'00000',Output_0:{}});
    }}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/NhGatewayV2.gs'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/NhAccountsV2.gs'),'utf8'),ctx);vm.runInContext(source,ctx);return {ctx,requests,logs,props};
}
function response(http,body){return {getResponseCode:()=>http,getContentText:()=>JSON.stringify(body),getHeaders:()=>({})};}
function denied(b,call,code='NH_PATH'){
  assert.throws(call,error=>{assert.equal(error.safeCode,code);assert.ok(!error.message.includes(canary));return true});
  assert.equal(b.requests.length,0,'denied request performed network I/O');
}
function cached(b){b.props.NHPLUG_TOKEN=canary;b.props.NHPLUG_TOKEN_EXP=String(Date.now()+3600000);}

test('token contract uses only exact HTTPS endpoint, encoded credentials, POST and no redirects',()=>{
  const b=backend();assert.equal(b.ctx.nhToken_(false),canary);assert.equal(b.requests.length,1);
  const r=b.requests[0],u=new URL(r.url);
  assert.equal(u.origin,origin);assert.equal(u.pathname,'/oauth2/token');assert.equal(u.hash,'');
  assert.deepEqual([...u.searchParams.keys()],['appkey','appsecretkey','grant_type','scope']);
  assert.equal(u.searchParams.get('appkey'),b.props.NHPLUG_APP_KEY);assert.equal(u.searchParams.get('appsecretkey'),b.props.NHPLUG_APP_SECRET);
  assert.equal(u.searchParams.get('grant_type'),'client_credentials');assert.equal(u.searchParams.get('scope'),'oob');
  assert.equal(r.options.method,'post');assert.equal(r.options.payload,'');assert.equal(r.options.headers,undefined);
  assert.equal(r.options.followRedirects,false);assert.equal(r.options.contentType,'application/x-www-form-urlencoded');assert.deepEqual(b.logs,[]);
});
for(const [i,p] of inquiryPaths.entries())test('approved inquiry route '+(i+1)+' preserves POST JSON and bearer scope',()=>{
  const b=backend();cached(b);b.ctx.nhCall_(p,{fixture:'synthetic'},{cts:'synthetic-continuation',cts_flag:'Y'});
  assert.equal(b.requests.length,1);const r=b.requests[0];assert.equal(r.url,origin+p);
  assert.equal(r.options.method,'post');assert.equal(r.options.followRedirects,false);assert.equal(r.options.contentType,'application/json');
  assert.equal(r.options.headers.Authorization,'Bearer '+canary);assert.equal(r.options.headers.cts,'synthetic-continuation');
  assert.deepEqual(JSON.parse(r.options.payload),{Input_0:{fixture:'synthetic'}});
});
const badPaths=[
  '/unknown','/n2/acctinfo-extra','/n2/acctinfo/extra','/n2/acctinfo/',
  '/krstock/inquiry/v1/balance/extra','/gbstock/inquiry/v1/balance-extra',
  '/krstock/quote/v1/currentPrice?order=true','/krfuture/quote/v1/day#fragment',
  '/n2/%61cctinfo','/n2/acctinfo%2fextra','/n2/acctinfo%252fextra','/n2/acctinfo/../order',
  '/n2/acctinfo?next=/order/place','/n2/acctinfo#fragment','/n2/acctinfo\r\nX-Test: value',
  '/krstock/order/v1/place','/krstock/order/v1/modify','/krstock/order/v1/cancel',
  '/krstock/inquiry/v1/../order/place','https://api.nhplug.com:8443/n2/acctinfo',
  '//api.nhplug.com:8443/n2/acctinfo','/oauth2/token'
];
for(const [i,p] of badPaths.entries())test('rejected path class '+(i+1)+' causes zero token or query fetches',()=>{
  const b=backend();denied(b,()=>b.ctx.nhCall_(p,{}));assert.equal(b.props.NHPLUG_TOKEN,undefined);
});
const badOrigins=['http://api.nhplug.com:8443','https://example.test','https://api.nhplug.com:8443.example.test',
  'https://api.nhplug.com:8443@example.test','https://api.nhplug.com','https://api.nhplug.com:8443/',
  'https://api.nhplug.com:8443?host=example.test'];
for(const [i,host] of badOrigins.entries())test('rejected origin class '+(i+1)+' has zero fetches',()=>{
  const b=backend();denied(b,()=>b.ctx.nhRequest_(host,'/n2/acctinfo','post','inquiry',{token:canary}));
  denied(b,()=>b.ctx.nhRequest_(host,'/oauth2/token','post','token',{key:canary,secret:canary}));
});
test('wrong methods, purposes and credential scope are refused before fetch',()=>{
  for(const method of ['get','put','delete','POST','post\r\n']){
    const b=backend();denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo',method,'inquiry',{token:canary}));
    denied(b,()=>b.ctx.nhRequest_(origin,'/oauth2/token',method,'token',{key:canary,secret:canary}));
  }
  const b=backend();
  denied(b,()=>b.ctx.nhRequest_(origin,'/oauth2/token','post','inquiry',{token:canary}));
  denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo','post','token',{key:canary,secret:canary}));
  denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo','post','inquiry',{key:canary,token:canary}),'NH_CONFIG');
  denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo','post','inquiry',{token:'x\r\n'+canary}),'NH_CONFIG');
  denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo','post','inquiry',{token:canary,cts:'x\r\nAuthorization: '+canary}),'NH_CONFIG');
  denied(b,()=>b.ctx.nhRequest_(origin,'/n2/acctinfo','post','inquiry',{token:canary,cts:'synthetic',cts_flag:'Y\r\n'+canary}),'NH_CONFIG');
  denied(b,()=>b.ctx.nhRequest_(docs,'/openapi-docs/krstock/openapi.json','get','spec',{token:canary}),'NH_CONFIG');
});
test('token caller cannot append query, fragment, encoding or extra segments',()=>{
  for(const suffix of ['?appkey='+canary,'#'+canary,'/extra','%3fkey','/../order']){
    const b=backend();denied(b,()=>b.ctx.nhRequest_(origin,'/oauth2/token'+suffix,'post','token',{key:canary,secret:canary}));
  }
});
for(const http of [301,302,303,307,308])test('redirect status '+http+' never reads Location/body, retries, caches or leaks',()=>{
  for(const kind of ['token','inquiry','spec']){
    const b=backend(()=>({getResponseCode:()=>http,getContentText:()=>{throw Error('body read forbidden')},getHeaders:()=>{throw Error('Location read forbidden')}}));
    if(kind==='inquiry')cached(b);
    if(kind==='spec')assert.equal(b.ctx.nhFetchSpec_('krstock'),null);
    else assert.throws(()=>kind==='token'?b.ctx.nhToken_(false):b.ctx.nhCall_('/n2/acctinfo',{}),e=>e.safeCode==='NH_HTTP'&&e.safeHttp===http);
    assert.equal(b.requests.length,1);assert.equal(b.requests[0].options.followRedirects,false);
    assert.ok(!JSON.stringify(b.logs).includes(canary));
    if(kind==='token')assert.equal(b.props.NHPLUG_TOKEN,undefined);
  }
});
test('public specifications have exact GET routes, no credentials, and no redirects',()=>{
  const b=backend();for(const group of ['krstock','gbstock','krfuture','gbfuture'])b.ctx.nhFetchSpec_(group);
  assert.equal(b.requests.length,4);for(const r of b.requests){assert.ok(r.url.startsWith(docs+'/openapi-docs/'));assert.equal(r.options.method,'get');assert.equal(r.options.followRedirects,false);assert.equal(r.options.headers,undefined);assert.equal(r.options.payload,undefined)}
  const x=backend();denied(x,()=>x.ctx.nhFetchSpec_('krstock/../../order'));
});
test('401 refresh keeps token and inquiry boundaries and retries inquiry once',()=>{
  let inquiries=0;
  const b=backend(r=>r.url.includes('/oauth2/token?')?response(200,{access_token:canary,expires_in:3600}):response(++inquiries===1?401:200,{rsp_cd:'00000'}));
  cached(b);assert.equal(b.ctx.nhCall_('/n2/acctinfo',{}).http,200);assert.equal(b.requests.length,3);
  for(const r of b.requests)assert.equal(r.options.followRedirects,false);
  assert.equal(b.requests.filter(r=>r.url===origin+'/n2/acctinfo').length,2);
});
test('transport exceptions reveal only fixed code and no request credentials',()=>{
  const b=backend(()=>{throw Error(canary)});cached(b);
  assert.throws(()=>b.ctx.nhCall_('/n2/acctinfo',{}),e=>e.message==='NH_NETWORK');
  b.ctx.nhTestAccounts();assert.ok(!JSON.stringify(b.logs).includes(canary));
});
test('domestic and overseas mapping survives boundary and partial failure',()=>{
  for(const fail of [null,'domestic','overseas']){
    const b=backend(r=>{
      const domestic=r.url===origin+'/krstock/inquiry/v1/balance';
      if((domestic?'domestic':'overseas')===fail)return response(503,{});
      return response(200,{rsp_cd:'00000',Output_0:{},Output_1:[{iem_cd:'SYN001',iem_nm:'Synthetic',itg_bnc_qty:2,cns_bse_bnc_qty:3,phs_pr:10,fc_avg_phs_pr:20,now_pr:12,fc_sec_end_pr:22,cur_cd:'USD'}]});
    });cached(b);
    const r=b.ctx.nhAccountBalance_('SYNTHETIC_ACCOUNT','01');
    if(fail!=='domestic'){assert.equal(r.domestic.holdings[0].quantity,2);assert.equal(r.domestic.holdings[0].avgPrice,10);assert.equal(r.domestic.holdings[0].currency,'KRW')}
    if(fail!=='overseas'){assert.equal(r.overseas.holdings[0].quantity,3);assert.equal(r.overseas.holdings[0].avgPrice,20);assert.equal(r.overseas.holdings[0].currency,'USD')}
    if(fail){assert.equal(r[fail],null);assert.equal(r.errors.length,1)}else assert.equal(r.errors.length,0);
  }
});
test('all NH network calls use the single guarded transport',()=>{
  assert.equal((source.match(/UrlFetchApp\.fetch\(/g)||[]).length,1);assert.ok(source.includes('createNhGatewayV2_'));
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/pr-tests.yml'),'utf8');
  assert.ok(workflow.includes("github.head_ref != 'feat/nh-integration-v2'"));
});
