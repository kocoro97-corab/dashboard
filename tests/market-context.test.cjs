const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){let token='synthetic-a';const calls=[],release=[];const ctx=vm.createContext({window:{MYINVEST_TRANSPORT_CONFIG:{devSession:true,publicMarket:true}},LS:()=>token,refreshMarket:async symbols=>{calls.push(symbols);await new Promise(r=>release.push(r))}});vm.runInContext(fs.readFileSync('js/app-context.js','utf8'),ctx);return {api:ctx.AppContext.create(),calls,release,setToken:t=>{token=t}}}
test('changing visible market symbol sets queues collectors and deduplicates identical sets',async()=>{const f=setup(),a=f.api.market(false,['^KS11','GC=F']),same=f.api.market(false,['GC=F','^KS11']),b=f.api.market(false,['NQ=F']);await tick();assert.equal(f.calls.length,1);f.release.shift()();await a;await same;await tick();assert.equal(f.calls.length,2);f.release.shift()();await b;assert.equal(JSON.stringify(f.calls),JSON.stringify([['GC=F','^KS11'],['NQ=F']]))});
test('logout discards a pending market job before another credential or request is used',async()=>{const f=setup(),a=f.api.market(false,['^KS11']),b=f.api.market(false,['NQ=F']);await tick();f.setToken(null);f.api.clear();f.release.shift()();await Promise.all([a,b]);assert.equal(f.calls.length,1)});
test('market symbols are bounded and cannot carry target URLs or arbitrary query parameters',async()=>{const f=setup(),p=f.api.market(false,['GC=F','https://private.invalid','token=PRIVATE&x=1',null,'GC=F']);await tick();assert.equal(JSON.stringify(f.calls[0]),'["GC=F"]');f.release.shift()();await p});

test('completed market requests respect cache and explicit refresh',async()=>{
 const f=setup();
 const first=f.api.market(false,['^KS11']);await tick();f.release.shift()();await first;
 await f.api.market(false,['^KS11']);assert.equal(f.calls.length,1,'recent identical market data must be reused');
 const forced=f.api.market(true,['^KS11']);await tick();assert.equal(f.calls.length,2);
 f.release.shift()();await forced;
});
test('a changed session never reuses a prior market cache entry',async()=>{
 const f=setup();
 const first=f.api.market(false,['^KS11']);await tick();f.release.shift()();await first;
 f.setToken('synthetic-b');
 const second=f.api.market(false,['^KS11']);await tick();
 assert.equal(f.calls.length,2,'new session must perform its own read');
 f.release.shift()();await second;
});
test('failed market read is not kept as a successful cache entry',async()=>{
 let token='synthetic-a',count=0,fail=true;
 const context=vm.createContext({window:{MYINVEST_TRANSPORT_CONFIG:{devSession:true,publicMarket:true}},LS:()=>token,refreshMarket:async()=>{
  count++;if(fail){fail=false;throw Error('SYNTHETIC_FAILURE')}
 }});
 vm.runInContext(fs.readFileSync('js/app-context.js','utf8'),context);
 const api=context.AppContext.create();
 await assert.rejects(api.market(false,['^KS11']),/SYNTHETIC_FAILURE/);
 await api.market(false,['^KS11']);
 assert.equal(count,2);
});
