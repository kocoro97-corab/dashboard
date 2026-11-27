import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,verify} from 'node:crypto';
import {createDedicatedDriveArchiveReader,createServiceAccountToken,validDedicatedAccount} from '../relay/private-original/drive-archive.mjs';
import {createHandler} from '../relay/private-original/worker-dev.mjs';
const folder='syntheticFolderOwner00001',account='myinvest-reader@test-project.iam.gserviceaccount.com';
const {privateKey:pem,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const stamp=Date.parse('2026-11-27T04:30:00Z'),fingerprint='a'.repeat(64);
const text='\uFEFF오늘 원문\r\n<Cite refs={[]}/>\n';
const fileId='syntheticOriginal000000001',date='2026-11-27';
const row={id:fileId,name:date+'.txt',mimeType:'text/plain',size:String(Buffer.byteLength(text)),modifiedTime:'2026-11-26T22:20:00Z',parents:[folder]};
test('server token uses only the isolated service account, no owner impersonation or redirect',async()=>{
 let calls=0;assert.equal(validDedicatedAccount(account,pem,folder),true);assert.equal(validDedicatedAccount('owner@example.test',pem,folder),false);
 const get=createServiceAccountToken({email:account,pem,now:()=>stamp,fetcher:async(url,opts)=>{
  calls++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(opts.redirect,'error');
  const form=new URLSearchParams(opts.body),jwt=form.get('assertion'),[h,p,s]=jwt.split('.');
  assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'RS256');
  const claim=JSON.parse(Buffer.from(p,'base64url').toString());
  assert.equal(claim.iss,account);assert.equal(claim.scope,'https://www.googleapis.com/auth/drive.readonly');assert.equal(claim.sub,undefined);
  assert.equal(claim.aud,url);assert.equal(claim.exp-claim.iat,300);
  assert.equal(verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
  return Response.json({access_token:'synthetic-token-000001',token_type:'Bearer',expires_in:3600});
 }});
 assert.deepEqual(await Promise.all([get(),get(),get()]),Array(3).fill('synthetic-token-000001'));assert.equal(calls,1);
});
test('reads exact dated text from the pinned archive; does not expose IDs or token',async()=>{
 const requests=[];
 const read=createDedicatedDriveArchiveReader({folderId:folder,now:()=>stamp,getToken:async()=> 'synthetic-token-000001',fetcher:async(url,opts)=>{
  requests.push(url);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  if(url.pathname.endsWith('/files')){assert.equal(url.searchParams.get('q'),"'"+folder+"' in parents and trashed = false");return Response.json({files:[row]});}
  assert.equal(url.pathname,'/drive/v3/files/'+fileId);return new Response(text);
 }});
 const x=await read({mode:'date',date});assert.equal(x.report.content,text);assert.equal(x.report.contentSha256,createHash('sha256').update(text).digest('hex'));
 assert.equal(x.cacheable,false);assert.ok(!JSON.stringify(x).includes(folder));assert.ok(!JSON.stringify(x).includes(fileId));assert.equal(requests.length,2);
});
test('archive is never contacted for anonymous, wrong owner, admin without explicit owner grant, or stale password',async()=>{
 const host='myinvest-test.synthetic.workers.dev',expected={freshTestEnvironment:true,testEnvironment:'nh-staging',gatewayVersion:2,storeEngine:'account-store-v2',scriptHash:fingerprint,sheetHash:'b'.repeat(64),sourceDigest:'c'.repeat(64)};
 const gate={idFromName:()=>0,get:()=>({fetch:async url=>Response.json(url.endsWith('/acquire')?{lease:'fixture'}:{})})};
 const env={MYINVEST_ENABLED:'true',MYINVEST_EXPECTED_METADATA:JSON.stringify(expected),MYINVEST_PUBLIC_HOST:host,
  MYINVEST_GAS_URL:'https://script.google.com/macros/s/SYNTHETIC_TEST/exec',MYINVEST_PUBLIC_MARKET:'false',MYINVEST_ACCOUNT_READS:'false',MYINVEST_EXTERNAL_STORE:'false',
  MYINVEST_PRIVATE_BRIEFINGS:'true',MYINVEST_PRIVATE_BRIEFING_PROVIDER:'dedicated-drive',MYINVEST_NEWS_READER_EMAIL:account,MYINVEST_NEWS_READER_PEM:pem,MYINVEST_NEWS_FOLDER_ID:folder,GATE:gate};
 let reads=0,auth=[],owner;
 const handler=createHandler({gatewayFactory:()=>({verify:async()=>({...expected,features:['privateMorningBriefing']}),post:async v=>{auth.push(v.action);return owner}}),
 privateArchiveFactory:({folderId})=>{assert.equal(folderId,folder);return async ({mode,date:d})=>{reads++;assert.equal(mode,'date');assert.equal(d,date);return {success:true,report:{date:d,content:text}}}}});
 const req=(auth=true)=>new Request('https://'+host+'/api',{method:'POST',headers:{Origin:'https://kocoro97-corab.github.io','X-MyInvest-Dev-Client':'dashboard-v2-dev','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...(auth?{Authorization:'Bearer '+fingerprint}:{})},body:JSON.stringify({action:'privateMorningBriefing',mode:'date',date})});
 assert.equal((await handler(req(false),env)).status,401);
 for(const fields of [{success:false},{isAdmin:true},{isAdmin:false,canReadPrivateBriefing:true},{isAdmin:true,canReadPrivateBriefing:true,mustChangePassword:true}]){
  owner={success:true,mustChangePassword:false,...fields};
  assert.equal((await (await handler(req(),env)).json()).code,'PRIVATE_BRIEFING_FORBIDDEN');
 }
 assert.equal(reads,0);
 owner={success:true,isAdmin:true,canReadPrivateBriefing:true,mustChangePassword:false};
 const res=await handler(req(),env);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await res.json()).report.content,text);
 assert.equal(reads,1);assert.ok(auth.every(x=>x==='sessionInfo'));
 const broken=await handler(req(),{...env,MYINVEST_NEWS_READER_PEM:undefined});assert.equal(broken.status,503);assert.equal(reads,1);
});
test('rejects duplicate dates, foreign parents, invalid UTF-8, changed size and false timestamps',async()=>{
 for(const kind of ['duplicate','foreign','utf8','size','time']){
  const entry={...row,parents:kind==='foreign'?['anotherSyntheticFolder0001']:[folder],
   size:kind==='utf8'?'2':kind==='size'?String(Buffer.byteLength(text)+1):row.size,
   modifiedTime:kind==='time'?'not-a-timestamp':row.modifiedTime};
  const read=createDedicatedDriveArchiveReader({folderId:folder,now:()=>stamp,getToken:async()=> 'synthetic-token-000001',fetcher:async(url,opts)=>{
   assert.equal(opts.method,'GET');
   return url.pathname.endsWith('/files')?Response.json({files:kind==='duplicate'?[entry,entry]:[entry]}):new Response(kind==='utf8'?new Uint8Array([0xc3,0x28]):text);
  }});
  const result=await read({mode:'date',date});assert.equal(result.success,false,kind);
  assert.ok(!JSON.stringify(result).includes(text));assert.ok(!JSON.stringify(result).includes(folder));
 }
});
test('service account token never accepts a broader returned scope',async()=>{
 const get=createServiceAccountToken({email:account,pem,now:()=>stamp,fetcher:async()=>Response.json({access_token:'synthetic-token-000001',token_type:'Bearer',expires_in:3600,scope:'https://www.googleapis.com/auth/drive'})});
 await assert.rejects(get(),/archive authorization/);
});
