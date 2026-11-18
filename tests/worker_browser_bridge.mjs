/* Test-only loopback bridge for the real Worker handler and synthetic GAS. */
import http from 'node:http';
import fs from 'node:fs';
import {createHandler,RelayGate,allowedMarketUrl} from '../relay/worker/worker.mjs';
// Optional public-only captured/synthetic response map for focused UI review.
// No live credentials, supplier requests, or account fixtures are loaded here.
const publicFixtures=process.env.MYINVEST_TEST_PUBLIC_FIXTURE?JSON.parse(fs.readFileSync(process.env.MYINVEST_TEST_PUBLIC_FIXTURE,'utf8')):{};
const futuresFixture=process.env.MYINVEST_TEST_FUTURE_FIXTURE?JSON.parse(fs.readFileSync(process.env.MYINVEST_TEST_FUTURE_FIXTURE,'utf8')):null;let futureIndex=0;
const expected={freshTestEnvironment:true,testEnvironment:'nh-staging',scriptHash:'a'.repeat(64),sheetHash:'b'.repeat(64),sourceDigest:'c'.repeat(64),gatewayVersion:2,storeEngine:'account-store-v2'};
const host='myinvest-v2-dev-relay.synthetic.workers.dev',token='a'.repeat(64),store=new Map(),storage={get:async k=>structuredClone(store.get(k)),put:async(k,v)=>store.set(k,structuredClone(v)),transaction(fn){return fn(this)}};
const gate=new RelayGate({storage});let live=false;
const env={MYINVEST_ENABLED:'true',MYINVEST_GAS_URL:'https://script.google.com/macros/s/SYNTHETIC_WORKER/exec',MYINVEST_PUBLIC_HOST:host,MYINVEST_EXPECTED_METADATA:JSON.stringify(expected),MYINVEST_PUBLIC_MARKET:'true',MYINVEST_ACCOUNT_READS:'true',MYINVEST_EXTERNAL_STORE:'true',GATE:{idFromName:()=>1,get:()=>({fetch:(url,init)=>gate.fetch(new Request(url,init))})}};
if(futuresFixture)env.MYINVEST_PUBLIC_FUTURES='true';
const gateway={async verify(){return {...expected,success:true,version:'v11-nh-v2',externalAccountCatalogVersion:1}},async post(p){
 if(p.action==='login'){live=p.user==='synthetic'&&p.pass==='SYNTHETIC_PRIVATE_PASSWORD';return live?{success:true,token,user:'synthetic',isAdmin:true}:{success:false,code:'AUTH_REQUIRED'}}
 if(p.action==='logout'){live=false;return {success:true}}
 if(!live||p.token!==token)return {success:false,code:'AUTH_REQUIRED'};
 if(p.action==='nhQuotes'&&futuresFixture){const row=futuresFixture[Math.min(futureIndex++,futuresFixture.length-1)];if(row.delayMs)await new Promise(r=>setTimeout(r,row.delayMs));const data=Object.fromEntries(p.items.filter(x=>row.data?.[x.k]).map(x=>[x.k,row.data[x.k]]));return {success:true,data,errors:row.errors||{}}}
 if(p.action==='sessionInfo')return {success:true,user:'synthetic',isAdmin:true};
 if(p.action==='nhAccounts')return {success:true,accounts:[{accountKey:'a'.repeat(64),errors:[],domestic:{holdings:[{code:'035720',name:'Synthetic domestic',currency:'KRW',quantity:4,avgPrice:75,currentPrice:100,evalAmount:400,profit:100}]},overseas:{holdings:[{code:'TEST',name:'Synthetic foreign',instrumentId:'US:XNAS:TEST',currency:'USD',quantity:2,avgPrice:4,currentPrice:5,evalAmount:600,profit:-200}]}}],updatedAt:new Date().toISOString()};
 if(p.action==='externalHoldings')return {success:true,storeVersion:2,holdings:[],revision:'r1',externalAccountCatalogVersion:1};
 if(p.action==='externalAccounts')return {success:true,accounts:[],brokers:[],revision:'c1'};
 if(p.action==='externalHistory')return {success:true,history:[]};
 throw Error('UNEXPECTED_SYNTHETIC_ACTION');
},async public(url,t){if(!live||t!==token)throw Object.assign(Error(),{code:'AUTH_REQUIRED',status:401});if(Object.hasOwn(publicFixtures,url)){if(!allowedMarketUrl(url))throw Object.assign(Error(),{code:'RELAY_PUBLIC_URL_DENIED',status:403});const fixture=publicFixtures[url];if(typeof fixture==='object'){await new Promise(r=>setTimeout(r,Math.min(2000,Math.max(0,Number(fixture.delayMs)||0))));return fixture.text}return fixture}if(process.env.MYINVEST_TEST_STRICT_PUBLIC_FIXTURE==='1')return JSON.stringify({datas:[]});if(url.includes('/api/polling/worldstock/index'))return JSON.stringify({datas:['.INX','.IXIC','.DJI','.SOX','.VIX'].map(reutersCode=>({reutersCode,closePrice:'102',compareToPreviousClosePrice:'2',compareToPreviousPrice:{code:'2'}}))});if(url.includes('news.google.com'))return '<rss><channel></channel></rss>';if(url.includes('query1.finance.yahoo.com'))return JSON.stringify({chart:{result:[]}});return JSON.stringify({datas:[]})}};
const handler=createHandler({gatewayFactory:()=>gateway});
const server=http.createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const payload=JSON.parse(text);if(payload.publicFixture){const f=payload.publicFixture;if(!allowedMarketUrl(f.url)||typeof f.text!=='string'||f.text.length>2*1024*1024)throw Error('INVALID_PUBLIC_FIXTURE');publicFixtures[f.url]={text:f.text,delayMs:f.delayMs}}const headers={...payload.headers,'CF-Connecting-IP':'192.0.2.7'};const request=new Request('https://'+host+'/api',{method:payload.method,headers,body:payload.method==='POST'?payload.body:undefined});const result=await handler(request,env);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()}))}catch{res.writeHead(500);res.end('{"code":"TEST_BRIDGE_FAILED"}')}});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\n'));
