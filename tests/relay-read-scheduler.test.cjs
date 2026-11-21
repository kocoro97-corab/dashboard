'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const token='a'.repeat(64),host='myinvest-v2-dev-relay.synthetic.workers.dev',origin='https://kocoro97-corab.github.io';
const source=fs.readFileSync('js/transport.js','utf8');
const expected={freshTestEnvironment:true,testEnvironment:'nh-staging',scriptHash:'a'.repeat(64),sheetHash:'b'.repeat(64),sourceDigest:'c'.repeat(64),gatewayVersion:2,storeEngine:'account-store-v2'};
async function server(){
 const api=await import('../relay/worker/worker.mjs'),saved=new Map();let tail=Promise.resolve(),active=0,max=0,busy=0,calls=0;
 const storage={get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v)),transaction(fn){const p=tail.then(()=>fn(this));tail=p.catch(()=>{});return p}};
 const gate=new api.RelayGate({storage}),env={MYINVEST_ENABLED:'true',MYINVEST_GAS_URL:'https://script.google.com/macros/s/SYNTHETIC/exec',MYINVEST_PUBLIC_HOST:host,MYINVEST_EXPECTED_METADATA:JSON.stringify(expected),MYINVEST_PUBLIC_MARKET:'true',MYINVEST_ACCOUNT_READS:'false',MYINVEST_EXTERNAL_STORE:'false',GATE:{idFromName:()=>1,get:()=>({fetch:(u,o)=>gate.fetch(new Request(u,o))})}};
 const handler=api.createHandler({gatewayFactory:()=>({verify:async()=>({...expected,success:true}),post:async()=>({success:true}),public:async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return 'public'}})});
 const fetch=async(url,options)=>{const response=await handler(new Request(url,{...options,headers:{...options.headers,Origin:origin,'X-MyInvest-Dev-Client':'dashboard-v2-dev','CF-Connecting-IP':'192.0.2.1'}}),env);if(response.status===503)busy++;return response};
 return {fetch,stats:()=>({active,max,busy,calls,leases:Object.keys(saved.get('quota')?.leases||{}).length})};
}
function client(fetch){let session=token;const endpoint='https://'+host+'/api',ctx=vm.createContext({URL,Event,Date,AbortController,setTimeout,clearTimeout,MYINVEST_TRANSPORT_CONFIG:{mode:'relay',endpoint,persistentRelay:true},MYINVEST_PERSISTENT_RELAY:{endpoint},LS:()=>session,location:{hash:'#/market'},fetch});vm.runInContext(source,ctx);return {api:ctx.DashboardTransport,ctx,session(v){session=v}}}
const url=i=>'https://query1.finance.yahoo.com/v8/finance/chart/S'+i+'?interval=1d&range=1y';
test('real gate model reproduces fifth simultaneous lease busy and releases all leases',async()=>{
 const s=await server();const result=await Promise.all(Array.from({length:9},(_,i)=>s.fetch('https://'+host+'/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'publicFetch',url:url(i)})})));
 assert.equal(result.filter(r=>r.status===200).length,4);assert.equal(result.filter(r=>r.status===503).length,5);assert.equal(s.stats().leases,0);
});
test('shared transport admits 32 distinct reads without busy, loss or lease leaks',async()=>{
 const s=await server(),c=client(s.fetch);const values=await Promise.all(Array.from({length:32},(_,i)=>c.api.publicRead(url(i))));
 assert.equal(values.length,32);assert.equal(s.stats().calls,32);assert.equal(s.stats().busy,0);assert.ok(s.stats().max<=2);assert.equal(s.stats().leases,0);
});
test('same symbol and range joins one physical request without a diagnostics dependency',async()=>{
 const s=await server(),c=client(s.fetch);const values=await Promise.all(Array.from({length:20},()=>c.api.publicRead(url(1))));
 assert.equal(s.stats().calls,1);assert.equal(values.length,20);assert.equal(await values[0].text(),'public');assert.equal(await values[1].text(),'public');
});
test('auth retains immediate capacity and is never retried while read queue is full',async()=>{
 let finish,calls=[];const c=client(async(u,o)=>{const p=JSON.parse(o.body);calls.push(p.action);if(p.action==='publicFetch')await new Promise(r=>{(finish??=[]).push(r)});return new Response(JSON.stringify({success:true,text:'public'}))});
 const reads=Array.from({length:8},(_,i)=>c.api.publicRead(url(i)));await new Promise(r=>setImmediate(r));await c.api.post({action:'login',user:'synthetic',pass:'SYNTHETIC'});
 assert.equal(calls.filter(x=>x==='login').length,1);assert.equal(calls.filter(x=>x==='publicFetch').length,2);
 const settled=Promise.allSettled(reads);c.api.cancelReads();assert.equal((await settled).filter(x=>x.status==='rejected').length,8);for(const r of finish)r();
});
test('route cancellation drops queued reads but holds physical slots until old responses finish',async()=>{
 const releases=[],seen=[];const c=client(async(u,o)=>{seen.push(JSON.parse(o.body).url);await new Promise(r=>releases.push(r));return new Response(JSON.stringify({success:true,text:'public'}))});
 const old=Promise.allSettled(Array.from({length:6},(_,i)=>c.api.publicRead(url(i))));await new Promise(r=>setImmediate(r));c.ctx.location.hash='#/sectors';c.api.cancelReads();await old;
 const fresh=c.api.publicRead(url(99));await new Promise(r=>setImmediate(r));assert.equal(seen.length,2);for(const r of releases.splice(0))r();await new Promise(r=>setTimeout(r,5));assert.equal(seen.length,3);releases.splice(0).forEach(r=>r());await fresh;assert.equal(c.api.readState().queued,0);
});
test('endpoint and session changes never replay queued reads to a different backend',async()=>{
 const releases=[],seen=[];const c=client(async(u)=>{seen.push(u);await new Promise(r=>releases.push(r));return new Response(JSON.stringify({success:true,text:'public'}))});
 const old=Promise.allSettled(Array.from({length:5},(_,i)=>c.api.publicRead(url(i))));await new Promise(r=>setImmediate(r));c.session('b'.repeat(64));c.ctx.MYINVEST_TRANSPORT_CONFIG.endpoint='https://other.synthetic.workers.dev/api';c.api.cancelReads();await old;releases.forEach(r=>r());assert.equal(seen.length,2);assert.ok(seen.every(x=>x==='https://'+host+'/api'));
});
