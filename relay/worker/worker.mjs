/* Persistent runtime adapter. GAS remains the authentication/account authority.
 * Fixed upstream only; no browser-to-GAS fallback, accounts, tokens or body logs.
 */
import policy from './policy.json' with {type:'json'};
const ORIGIN='https://kocoro97-corab.github.io',TOKEN=/^[a-fA-F0-9]{64}$/,MAX_RESPONSE=2*1024*1024;
const failure=(code,status=502)=>Object.assign(new Error(code),{code,status});
const auth=new Set(policy.auth),reads=new Set(policy.reads),writes=new Set(policy.writes);
const safeMessages=new Set(['로그인 정보 또는 계정 승인 상태를 확인하세요.','소유자 NH 계좌 잔고는 관리자만 조회할 수 있습니다.','12자 이상 비밀번호로 변경한 후 이용하세요.','로그인 시도가 많습니다. 15분 후 다시 시도하세요.','계정 정보가 변경됐습니다. 다시 로그인하세요.','다시 로그인하세요.']);
const safeCode=new Set(['AUTH_REQUIRED','STORE_CONFLICT','STORE_CONFIRM','STORE_INVALID','STORE_DUPLICATE','STORE_NOT_FOUND','STORE_SCHEMA','STORE_WRITE_FAILED','STORE_RECOVERY_REQUIRED','STORE_ACCOUNT_IN_USE','STORE_CATALOG_LIMIT','STORE_CLIENT_UPGRADE_REQUIRED']);
const publicCodes=new Set(["AUTH_REQUIRED", "DEV_PAGE_REQUIRED", "INVALID_CODES", "RELAY_ACCESS_CLOSED", "RELAY_BAD_REQUEST", "RELAY_BAD_RESPONSE", "RELAY_BUSY", "RELAY_CONFIG_INVALID", "RELAY_CONTENT_TYPE", "RELAY_GAS_ACCESS_REQUIRED", "RELAY_HTTPS_REQUIRED", "RELAY_ISOLATION_REQUIRED", "RELAY_METHOD_DENIED", "RELAY_NON_JSON", "RELAY_ORIGIN_DENIED", "RELAY_PATH_DENIED", "RELAY_PREFLIGHT_DENIED", "RELAY_PUBLIC_FAILED", "RELAY_PUBLIC_URL_DENIED", "RELAY_RATE_LIMIT", "RELAY_REDIRECT_DENIED", "RELAY_REQUEST_SIZE", "RELAY_RESPONSE_INVALID", "RELAY_RESPONSE_TOO_LARGE", "RELAY_SCOPE_BLOCKED", "RELAY_TARGET_MISMATCH", "RELAY_UPSTREAM_HTTP", "RELAY_UPSTREAM_NETWORK", "RELAY_WRITE_OUTCOME_UNKNOWN", "STORE_CONFIRM"]);
function equalKeys(value,keys){return Object.keys(value).sort().join('|')===[...keys].sort().join('|')}
export function configuration(env){
 if(env.MYINVEST_ENABLED!=='true')throw failure('RELAY_ACCESS_CLOSED',503);
 let expected;try{expected=JSON.parse(env.MYINVEST_EXPECTED_METADATA)}catch{throw failure('RELAY_CONFIG_INVALID',503)}
 const match=/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/.exec(env.MYINVEST_GAS_URL||'');
 if(!match||match[1]===policy.productionDeployment||expected.freshTestEnvironment!==true||expected.testEnvironment!=='nh-staging'||expected.gatewayVersion!==2||expected.storeEngine!=='account-store-v2'||expected.sheetHash===policy.productionSheetHash||['scriptHash','sheetHash','sourceDigest'].some(k=>!TOKEN.test(expected[k])))throw failure('RELAY_ISOLATION_REQUIRED',503);
 if(!/^[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}\.workers\.dev$/.test(env.MYINVEST_PUBLIC_HOST||''))throw failure('RELAY_CONFIG_INVALID',503);
 for(const k of ['MYINVEST_PUBLIC_MARKET','MYINVEST_ACCOUNT_READS','MYINVEST_EXTERNAL_STORE'])if(!['true','false'].includes(env[k]))throw failure('RELAY_CONFIG_INVALID',503);
 if(env.MYINVEST_EXTERNAL_STORE==='true'&&env.MYINVEST_ACCOUNT_READS!=='true'||!env.GATE)throw failure('RELAY_CONFIG_INVALID',503);
 return {upstream:env.MYINVEST_GAS_URL,host:env.MYINVEST_PUBLIC_HOST,expected,market:env.MYINVEST_PUBLIC_MARKET==='true',futures:env.MYINVEST_PUBLIC_MARKET==='true'&&env.MYINVEST_PUBLIC_FUTURES==='true',accounts:env.MYINVEST_ACCOUNT_READS==='true',store:env.MYINVEST_EXTERNAL_STORE==='true'};
}
export function allowedMarketUrl(value){
 if(typeof value!=='string'||value.length>2048||!/^https:\/\/[^/?#]+\//i.test(value)||/[\x00-\x20\\]/.test(value)||/%(?![a-fA-F0-9]{2})/.test(value))return false;
 try{
  const u=new URL(value);const rawPath=value.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1]||'/';if(decodeURIComponent(rawPath).split('/').some(x=>x==='.'||x==='..')||/(?:&&|&$|^\?&)/.test(u.search))return false;if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)return false;
  const entries=[...u.searchParams];if(new Set(entries.map(x=>x[0])).size!==entries.length)return false;
  const q=Object.fromEntries(entries),p=decodeURIComponent(u.pathname),host=u.hostname;if(/[%\\?#\x00-\x20]/.test(p))return false;
  const shape=expected=>JSON.stringify(Object.entries(q).sort())===JSON.stringify(Object.entries(expected).sort());
  if(host==='polling.finance.naver.com')return !entries.length&&/^\/api\/realtime\/domestic\/(?:index\/(?:KOSPI|KOSDAQ)|stock\/[0-9]{6}(?:,[0-9]{6}){0,19})$/.test(p);
  if(host==='stock.naver.com'){
   if(p==='/api/polling/worldstock/index')return equalKeys(q,['reutersCodes'])&&/^\.(?:INX|IXIC|DJI|SOX|VIX)(?:,\.(?:INX|IXIC|DJI|SOX|VIX)){0,4}$/.test(q.reutersCodes);
   if(['/api/securityService/marketindex/majors/rpc','/api/securityService/marketindex/majors/bond','/api/securityService/marketindex/energy','/api/securityFe/api/index/KOSPI/integration'].includes(p))return !entries.length;
   if(p==='/api/domestic/market/theme/list')return shape({startIdx:'0',pageSize:'100',sortType:'changeRate'});
   if(/^\/api\/domestic\/market\/theme\/[0-9]{1,6}\/stocklist$/.test(p))return shape({marketType:'ALL',orderType:'priceTop',startIdx:'0',pageSize:'100'});
  }
  if(host==='m.stock.naver.com'){
   if(p==='/api/stocks/theme')return shape({page:'1',pageSize:'100'});
   if(/^\/api\/(?:stock\/[0-9]{6}|index\/(?:KOSPI|KOSDAQ))\/price$/.test(p))return equalKeys(q,['pageSize','page'])&&q.pageSize==='60'&&/^(?:[1-9]|1[0-2])$/.test(q.page);
   if(/^\/api\/stocks\/theme\/[0-9]{1,6}$/.test(p))return shape({page:'1',pageSize:'100'});
  }
  if(host==='query1.finance.yahoo.com')return /^\/v8\/finance\/chart\/[A-Za-z0-9^=.-]{1,32}$/.test(p)&&equalKeys(q,['interval','range'])&&['1d','1wk','1mo'].includes(q.interval)&&['1d','3mo','1y','2y','5y','10y','max'].includes(q.range);
  if(host==='news.google.com'&&p==='/rss/search')return equalKeys(q,['q','hl','gl','ceid'])&&policy.newsQueries.includes(q.q)&&q.hl==='ko'&&q.gl==='KR'&&q.ceid==='KR:ko';
  return host==='finance.daum.net'&&p==='/api/home/sec'&&equalKeys(q,['path'])&&/^\/api\/futures\/KR[A-Z0-9]{10}$/.test(q.path);
 }catch{return false}
}
async function bounded(response,limit=MAX_RESPONSE){
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw failure('RELAY_RESPONSE_TOO_LARGE');chunks.push(value)}}catch(error){await reader.cancel().catch(()=>{});throw error}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw failure('RELAY_RESPONSE_INVALID')}
}
export function createGateway(config,fetcher=fetch,proof={}){
 async function post(payload){
  let url=config.upstream,options={method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8','Accept':'application/json'},body:JSON.stringify({...payload,stagingBinding:config.expected.sheetHash}),redirect:'manual',signal:AbortSignal.timeout(120000)};
  for(let hop=0;hop<4;hop++){
   let response;try{response=await fetcher(url,options)}catch{throw failure('RELAY_UPSTREAM_NETWORK')}
   if(response.status>=300&&response.status<400){
    const location=response.headers.get('Location');response.body?.cancel().catch(()=>{});let next;try{next=new URL(location)}catch{throw failure('RELAY_REDIRECT_DENIED')}
    if(next.hostname==='accounts.google.com')throw failure('RELAY_GAS_ACCESS_REQUIRED');
    if(![301,302,303].includes(response.status)||hop===3||next.protocol!=='https:'||next.hostname!=='script.googleusercontent.com'||next.pathname!=='/macros/echo'||next.username||next.password||next.port||next.hash)throw failure('RELAY_REDIRECT_DENIED');
    // Preserve the signed Location bytes. Never replay a body or auth to redirects.
    url=location;options={method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(120000)};continue;
   }
   if(response.status!==200)throw failure('RELAY_UPSTREAM_HTTP');
   if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw failure('RELAY_NON_JSON');
   let result;try{result=JSON.parse(await bounded(response))}catch(error){if(error.code)throw error;throw failure('RELAY_RESPONSE_INVALID')}
   if(!result||Array.isArray(result)||typeof result.success!=='boolean')throw failure('RELAY_RESPONSE_INVALID');return result;
  }
  throw failure('RELAY_REDIRECT_DENIED');
 }
 return {post,async verify(){const key=config.upstream+'|'+JSON.stringify(config.expected);if(proof.key===key&&proof.until>Date.now())return proof.data;if(proof.key===key&&proof.pending)return proof.pending;proof.key=key;proof.pending=(async()=>{const data=await post({action:'appVersion'});if(data.success!==true||Object.entries(config.expected).some(([k,v])=>data[k]!==v))throw failure('RELAY_TARGET_MISMATCH',503);proof.data=data;proof.until=Date.now()+30000;return data})();try{return await proof.pending}finally{proof.pending=null}},async public(url,token){
  if(!allowedMarketUrl(url))throw failure('RELAY_PUBLIC_URL_DENIED',403);
  const session=await post({action:'sessionInfo',token});if(session.success!==true||session.mustChangePassword)throw failure('AUTH_REQUIRED',401);
  let r;try{const host=new URL(url).hostname,referer=host==='news.google.com'?'https://news.google.com/':host==='query1.finance.yahoo.com'?'https://finance.yahoo.com/':host==='finance.daum.net'?'https://finance.daum.net/':'https://stock.naver.com/';r=await fetcher(url,{method:'GET',headers:{Accept:'*/*','User-Agent':'Mozilla/5.0','Referer':referer},redirect:'manual',signal:AbortSignal.timeout(20000)})}catch{throw failure('RELAY_UPSTREAM_NETWORK')}
  if(r.status>=300&&r.status<400)throw failure('RELAY_REDIRECT_DENIED');if(r.status!==200)throw failure('RELAY_PUBLIC_FAILED');return bounded(r);
 }};
}
function validatePayload(body){
 const action=body.action,keys=['action'];if(action==='login'){keys.push('user','pass');if(typeof body.user!=='string'||body.user.length>64||typeof body.pass!=='string'||body.pass.length>256)throw failure('RELAY_BAD_REQUEST',400)}
 else if(!['appVersion'].includes(action))keys.push('token');
 if(action==='publicFetch'){keys.push('url');if(!allowedMarketUrl(body.url))throw failure('RELAY_PUBLIC_URL_DENIED',403)}
 if(action==='nhQuotes'){keys.push('items');if(!Array.isArray(body.items)||body.items.length<1||body.items.length>2||new Set(body.items.map(x=>x?.k)).size!==body.items.length||body.items.some(x=>!x||!equalKeys(x,['k','t','c'])||x.t!=='fut'||!({k3:'A01',k4:'A06'}[x.k])||x.c!==({k3:'A01',k4:'A06'}[x.k])))throw failure('RELAY_BAD_REQUEST',403)}
 if(action==='nhExternalQuotes'){keys.push('codes');if(!Array.isArray(body.codes)||body.codes.length<1||body.codes.length>40||body.codes.some(x=>typeof x!=='string'||!/^[A-Z0-9]{6}$/.test(x)))throw failure('INVALID_CODES',403)}
 if(action==='saveExternalAccounts')keys.push('accounts','brokers','expectedRevision','confirmReplace');
 if(action==='saveExternalHoldings'){keys.push('holdings','expectedRevision','confirmReplace');if(body.externalAccountsVersion===1)keys.push('externalAccountsVersion')}
 if(action==='restoreExternalHoldings')keys.push('snapshotId','expectedRevision','confirmReplace');
 if(!equalKeys(body,keys))throw failure('RELAY_BAD_REQUEST',400);
 if(writes.has(action)&&(body.confirmReplace!==true||typeof body.expectedRevision!=='string'||!body.expectedRevision))throw failure('STORE_CONFIRM',403);
}
function futureResult(result,items){if(result?.success!==true)return result;const data={},errors={};for(const item of items){const q=result.data?.[item.k],prefix=item.c,name=String(q?.name||'').replace(/\s/g,'');const observed=Number.isFinite(q?.observedAt)&&q.observedAt>0&&q.observedAt<=Date.now()+300000&&Date.now()-q.observedAt<=4*86400000?q.observedAt:null;if(q&&(item.k!=='k4'||observed!==null)&&q.contractVerified===true&&/^\d{8}$/.test(q.expiry||'')&&Number.isFinite(q.p)&&q.p>0&&Number.isFinite(q.prev)&&q.prev>0&&new RegExp('^'+prefix+'[0-9][1-9ABC]000$').test(q.code||'')&&(prefix==='A06'?/코스닥150|KOSDAQ150/i:/코스피200|KOSPI200/i).test(name)){data[item.k]={p:q.p,prev:q.prev,basis:Number.isFinite(q.basis)?q.basis:null,code:q.code,name:prefix==='A06'?'코스닥150 선물':'코스피200 선물',t:/^[0-9:]{6,8}$/.test(q.t||'')?q.t:'',expiry:/^\d{8}$/.test(q.expiry||'')?q.expiry:null,contractVerified:q.contractVerified===true&&/^\d{8}$/.test(q.expiry||''),observedAt:observed,observationKind:observed?'trade':null,marketState:'UNVERIFIED',delayStatus:'UNVERIFIED',receivedAt:new Date().toISOString(),volume:Number.isFinite(q.volume)?q.volume:null,turnover:Number.isFinite(q.turnover)?q.turnover:null}}else{const raw=String(result.errors?.[item.k]||''),match=/^(NH_(?:TOKEN|CONFIG|NETWORK|JSON|HTTP|RSP|NO_PRICE|CONTRACT|OBSERVATION|STALE|UNSUPPORTED|UPSTREAM|SYMBOL_MISMATCH))(?: \/ HTTP ([1-5][0-9]{2}))?$/.exec(raw);errors[item.k]=match?match[1]+(match[2]?' / HTTP '+match[2]:''):'NH_NO_PRICE'}}return {success:true,data,errors}}
export function createHandler({fetcher=fetch,gatewayFactory=createGateway}={}){const proof={};return async function(request,env){
 let lease=null,gate=null,attemptedWrite=false;const origin=request.headers.get('Origin')===ORIGIN;
 const headers={'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','Vary':'Origin','X-Content-Type-Options':'nosniff','Strict-Transport-Security':'max-age=31536000'};
 if(origin)headers['Access-Control-Allow-Origin']=ORIGIN;
 const reply=(status,value)=>new Response(status===204?null:JSON.stringify(value),{status,headers});
 try{
  const url=new URL(request.url);if(url.protocol!=='https:')throw failure('RELAY_HTTPS_REQUIRED',403);
  const config=configuration(env);if(url.hostname!==config.host||url.pathname!=='/api'||url.search)throw failure('RELAY_PATH_DENIED',404);
  if(!origin)throw failure('RELAY_ORIGIN_DENIED',403);
  if(request.method==='OPTIONS'){
   const requested=(request.headers.get('Access-Control-Request-Headers')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
   if(request.headers.get('Access-Control-Request-Method')!=='POST'||requested.some(x=>!['authorization','content-type','x-myinvest-dev-client'].includes(x)))throw failure('RELAY_PREFLIGHT_DENIED',403);
   headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type, Authorization, X-MyInvest-Dev-Client';return reply(204,{});
  }
  if(request.method!=='POST')throw failure('RELAY_METHOD_DENIED',405);
  if(request.headers.get('X-MyInvest-Dev-Client')!=='dashboard-v2-dev')throw failure('DEV_PAGE_REQUIRED',403);
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw failure('RELAY_CONTENT_TYPE',415);
  const declared=request.headers.get('Content-Length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>65536))throw failure('RELAY_REQUEST_SIZE',413);
  let raw;try{raw=await bounded(request,65536)}catch(error){if(error.code==='RELAY_RESPONSE_TOO_LARGE')throw failure('RELAY_REQUEST_SIZE',413);throw error}let body;try{body=JSON.parse(raw)}catch{throw failure('RELAY_BAD_REQUEST',400)}
  if(!body||Array.isArray(body)||typeof body!=='object'||['token','backendUrl','gasUrl','targetUrl','stagingBinding'].some(k=>k in body))throw failure('RELAY_BAD_REQUEST',400);
  const action=body.action,allowed=auth.has(action)||config.market&&action==='publicFetch'||config.futures&&action==='nhQuotes'||config.accounts&&reads.has(action)||config.store&&writes.has(action);
  if(!allowed)throw failure('RELAY_SCOPE_BLOCKED',403);
  const bearer=request.headers.get('Authorization');if(['appVersion','login'].includes(action)){if(bearer)throw failure('RELAY_BAD_REQUEST',400)}else{if(!/^Bearer [a-fA-F0-9]{64}$/.test(bearer||''))throw failure('AUTH_REQUIRED',401);body.token=bearer.slice(7)}
  validatePayload(body);
  gate=env.GATE.get(env.GATE.idFromName('isolated-relay-gate-v1'));
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)throw failure('RELAY_CONFIG_INVALID',503);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.expected.scriptHash+'|'+ip));const ipHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const quota=await gate.fetch('https://gate/acquire',{method:'POST',body:JSON.stringify({ipHash,login:action==='login'})});
  if(!quota.ok)throw failure(quota.status===429?'RELAY_RATE_LIMIT':'RELAY_BUSY',quota.status);
  lease=(await quota.json()).lease;if(typeof lease!=='string')throw failure('RELAY_CONFIG_INVALID',503);
  const gateway=gatewayFactory(config,fetcher,proof),metadata=await gateway.verify();let result;
  if(action==='appVersion')result={...metadata,relayProfile:'persistent',developmentPublicMarket:config.market,developmentPublicFutures:config.futures,developmentAccountReads:config.accounts,developmentExternalStore:config.store,developmentExternalTestStore:false};
  else if(action==='publicFetch')result={success:true,text:await gateway.public(body.url,body.token)};
  else{attemptedWrite=writes.has(action);result=await gateway.post(body);if(action==='nhQuotes')result=futureResult(result,body.items)}
  if(result.success!==true)result={success:false,code:safeCode.has(result.code)?result.code:'GAS_REJECTED',layer:['gas','storage','nh'].includes(result.layer)?result.layer:'gas',...(safeMessages.has(result.message)?{message:result.message}:{}),mustChangePassword:result.mustChangePassword===true};
  return reply(200,result);
 }catch(error){const code=attemptedWrite?'RELAY_WRITE_OUTCOME_UNKNOWN':publicCodes.has(error.code)?error.code:'RELAY_BAD_RESPONSE';return reply(Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:502,{success:false,code,layer:'relay'})}
 finally{if(lease&&gate)await gate.fetch('https://gate/release',{method:'POST',body:JSON.stringify({lease})}).catch(()=>{})}
}}
export class RelayGate{
 constructor(state){this.state=state}
 async fetch(request){
  let input;try{input=await request.json()}catch{return new Response(null,{status:400})}
  const now=Date.now(),release=new URL(request.url).pathname==='/release';
  return this.state.storage.transaction(async tx=>{
   let state=await tx.get('quota')||{start:now,total:0,login:0,ips:{},leases:{}};
   if(now-state.start>=60000)state={...state,start:now,total:0,login:0,ips:{}};
   for(const [id,expiry] of Object.entries(state.leases))if(expiry<=now)delete state.leases[id];
   if(release){if(typeof input.lease==='string')delete state.leases[input.lease];await tx.put('quota',state);return new Response('{}',{headers:{'Content-Type':'application/json'}})}
   if(!/^[a-f0-9]{64}$/.test(input.ipHash)||typeof input.login!=='boolean')return new Response(null,{status:400});
   if(state.total>=240||input.login&&state.login>=30)return new Response('{}',{status:429});
   const ip=state.ips[input.ipHash]||{total:0,login:0};state.total++;ip.total++;if(input.login){state.login++;ip.login++}state.ips[input.ipHash]=ip;
   let status=200;if(state.total>240||ip.total>120||state.login>30||ip.login>6)status=429;else if(Object.keys(state.leases).length>=4)status=503;
   const lease=status===200?crypto.randomUUID():null;if(lease)state.leases[lease]=now+130000;await tx.put('quota',state);
   return new Response(JSON.stringify({lease}),{status,headers:{'Content-Type':'application/json'}});
  });
 }
}
export default {fetch:createHandler()};
