import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHandler,RelayGate} from '../relay/private-original/worker-dev.mjs';
const host='myinvest-private.synthetic.workers.dev',owner='fixture-owner';
const expected={freshTestEnvironment:true,testEnvironment:'nh-staging',gatewayVersion:2,storeEngine:'account-store-v2',scriptHash:'1'.repeat(64),sheetHash:'2'.repeat(64),sourceDigest:'3'.repeat(64)};
function fixture(archiveFailure=null){
 const rows=new Map(),sessions=new Map(),calls=[];let serial=0,reads=0,forbidden=false,revoked=false,reset=false,broken=false;
 const storage={get:async key=>structuredClone(rows.get(key)),put:async(key,v)=>rows.set(key,structuredClone(v)),transaction:async fn=>fn(storage)};
 const actor=new RelayGate({storage}),gate={fetch:async(url,opts)=>{
  if(broken&&url.endsWith('/owner-bind'))return new Response(null,{status:503});
  return actor.fetch(new Request(url,opts));
 }};
 const env={MYINVEST_ENABLED:'true',MYINVEST_GAS_URL:'https://script.google.com/macros/s/SYNTHETIC_ISOLATED/exec',MYINVEST_PUBLIC_HOST:host,MYINVEST_EXPECTED_METADATA:JSON.stringify(expected),MYINVEST_PUBLIC_MARKET:'false',MYINVEST_ACCOUNT_READS:'false',MYINVEST_EXTERNAL_STORE:'false',MYINVEST_PRIVATE_BRIEFINGS:'true',MYINVEST_PRIVATE_BRIEFING_PROVIDER:'dedicated-drive',MYINVEST_NEWS_AUTHORITY:'gas-login-owner-v1',MYINVEST_NEWS_OWNER_USER:owner,MYINVEST_NEWS_DEPLOYMENT_MARKER:'7'.repeat(32),MYINVEST_NEWS_READER_EMAIL:'fixture-reader@synthetic-project.iam.gserviceaccount.com',MYINVEST_NEWS_READER_PEM:'-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----',MYINVEST_NEWS_FOLDER_ID:'fixturePrivateFolder0000001',GATE:{idFromName:()=>1,get:()=>gate}};
 const gateway={verify:async()=>({...expected,success:true,features:['changePassword']}),post:async body=>{
  calls.push(body.action);
  if(body.action==='login'){
   if(body.pass!=='SYNTHETIC_PASSWORD')return {success:false,code:'AUTH_REQUIRED'};
   const token=String(++serial).padStart(64,'a');sessions.set(token,body.user);
   return {success:true,token,isAdmin:body.user!=='member',mustChangePassword:false};
  }
  if(body.action==='logout'){sessions.delete(body.token);return {success:true}}
  if(body.action==='sessionInfo')return {success:sessions.has(body.token)&&!revoked,isAdmin:sessions.get(body.token)!=='member',mustChangePassword:reset,...(forbidden?{canReadPrivateBriefing:false}:{})};
  throw Error('UNEXPECTED_GAS_CALL');
 }};
 const handler=createHandler({gatewayFactory:()=>gateway,privateArchiveFactory:()=>async()=>{reads++;if(archiveFailure)return archiveFailure;return {success:true,private:true,cacheable:false,report:{content:'SYNTHETIC_VERBATIM_ORIGINAL'}}}});
 const request=(body,token)=>new Request('https://'+host+'/api',{method:'POST',headers:{Origin:'https://kocoro97-corab.github.io','X-MyInvest-Dev-Client':'dashboard-v2-dev','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 return {rows,sessions,calls,actor,env,get reads(){return reads},set forbidden(v){forbidden=v},set revoked(v){revoked=v},set reset(v){reset=v},set broken(v){broken=v},async send(body,token){return handler(request(body,token),env)},async login(user=owner){return (await (await handler(request({action:'login',user,pass:'SYNTHETIC_PASSWORD'}),env)).json()).token}};
}
test('same GAS mints sessions; only configured owner logins get server-side hashed proof',async()=>{
 const f=fixture(),token=await f.login();
 let body=await (await f.send({action:'privateMorningBriefing',mode:'latest'},token)).json();
 assert.equal(body.report.content,'SYNTHETIC_VERBATIM_ORIGINAL');assert.equal(f.reads,1);
 for(const user of ['other-admin','member']){
  const other=await f.login(user);body=await (await f.send({action:'privateMorningBriefing',mode:'latest'},other)).json();
  assert.equal(body.code,'PRIVATE_BRIEFING_FORBIDDEN');
 }
 const originalPrimary='d'.repeat(64);f.sessions.set(originalPrimary,owner);
 body=await (await f.send({action:'privateMorningBriefing',mode:'latest'},originalPrimary)).json();assert.equal(body.code,'PRIVATE_BRIEFING_FORBIDDEN');
 assert.equal(f.reads,1);assert.ok(!JSON.stringify([...f.rows]).includes(token));
 const proof=f.rows.get('private-news-owner-bindings-v1');assert.ok(proof[createHash('sha256').update(token).digest('hex')]);
 assert.ok(f.calls.every(x=>['login','logout','sessionInfo'].includes(x)));
 const meta=await (await f.send({action:'appVersion'})).json();assert.equal(meta.developmentPrivateBriefingAuthority,'gas-login-owner-v1');assert.equal(meta.developmentPrivateBriefingRevision,'7'.repeat(32));
 assert.deepEqual(meta.features,['changePassword'],'do not pretend the GAS implements a new reader');
});
test('revocation, password reset, explicit GAS denial and logout immediately deny the archive',async()=>{
 const f=fixture(),token=await f.login();
 for(const property of ['revoked','reset','forbidden']){
  f[property]=true;const r=await (await f.send({action:'privateMorningBriefing',mode:'latest'},token)).json();assert.equal(r.code,'PRIVATE_BRIEFING_FORBIDDEN');f[property]=false;
 }
 assert.equal(f.reads,0);await f.send({action:'logout'},token);
 assert.equal((await (await f.send({action:'privateMorningBriefing',mode:'latest'},token)).json()).code,'PRIVATE_BRIEFING_FORBIDDEN');
 assert.deepEqual(f.rows.get('private-news-owner-bindings-v1'),{});
});
test('private worker never accepts NH, holdings, registrations or arbitrary owner assertions',async()=>{
 const f=fixture(),token=await f.login();
 for(const action of ['nhAccounts','nhQuotes','externalHoldings','register','saveExternalHoldings','publicFetch','owner-bind'])assert.equal((await f.send({action},token)).status,403);
 assert.equal((await f.send({action:'privateMorningBriefing',mode:'latest',owner:true},token)).status,400);
 assert.equal(f.reads,0);
});
test('unconfirmed proof storage logs out the newly minted GAS token without exposing it',async()=>{
 const f=fixture();f.broken=true;
 const r=await f.send({action:'login',user:owner,pass:'SYNTHETIC_PASSWORD'});
 assert.equal(r.status,503);assert.equal(f.sessions.size,0);assert.equal(f.calls.at(-1),'logout');
 const text=await r.text();assert.ok(!text.includes('token'));assert.equal(f.reads,0);
});
test('proof expires at the absolute cap; malformed internal assertions cannot create a proof',async()=>{
 const f=fixture(),token=await f.login(),proof=f.rows.get('private-news-owner-bindings-v1');
 for(const key of Object.keys(proof))proof[key]=Date.now()-1;
 f.rows.set('private-news-owner-bindings-v1',proof);
 assert.equal((await (await f.send({action:'privateMorningBriefing',mode:'latest'},token)).json()).code,'PRIVATE_BRIEFING_FORBIDDEN');
 const r=await f.actor.fetch(new Request('https://gate/owner-bind',{method:'POST',body:JSON.stringify({tokenHash:'1'.repeat(64),owner:true})}));
 assert.equal(r.status,400);assert.deepEqual(f.rows.get('private-news-owner-bindings-v1'),{});
});

test('runtime diagnostic metadata reaches only the attested owner and never contains arbitrary provider fields',async()=>{
 const f=fixture({success:false,code:'PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE',archiveDiagnostic:{stage:'TOKEN_RESPONSE',http:400,body:'PRIVATE_BODY_CANARY',token:'PRIVATE_TOKEN_CANARY'}});
 const anonymous=await f.send({action:'privateMorningBriefing',mode:'latest'});
 assert.equal(anonymous.status,401);assert.equal(f.reads,0);
 const member=await f.login('member');
 const denied=await (await f.send({action:'privateMorningBriefing',mode:'latest'},member)).json();
 assert.equal(denied.code,'PRIVATE_BRIEFING_FORBIDDEN');assert.equal(denied.archiveDiagnostic,undefined);assert.equal(f.reads,0);
 const token=await f.login();
 const result=await (await f.send({action:'privateMorningBriefing',mode:'latest'},token)).json();
 assert.deepEqual(result.archiveDiagnostic,{stage:'TOKEN_RESPONSE',http:400});
 assert.ok(!JSON.stringify(result).includes('CANARY'));
});
