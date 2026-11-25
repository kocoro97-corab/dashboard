'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('js/external_accounts.js','utf8');
function sample(date=new Date().toISOString()){
 return {source:{provider:'SYNTHETIC_KRX',fetchedAt:date},instruments:[{code:'000001',name:'Synthetic issuer'}]};
}
function fixture({stale=false}={}){
 let requests=0,release;
 const response=sample(stale?new Date(Date.now()-31*86400000).toISOString():new Date().toISOString());
 const ctx=vm.createContext({
   Date,console,window:{},$:()=>null,
   ExternalCore:{master:document=>({byCode:new Map(document.instruments.map(x=>[x.code,x]))})},
   SafeDiagnostics:{message:e=>e.message},
   fetch:async url=>{
     requests++;
     assert.equal(url,'data/krx-instruments.json');
     await new Promise(resolve=>release=resolve);
     return {ok:true,json:async()=>response};
   }
 });
 vm.runInContext(code,ctx,{filename:'js/external_accounts.js'});
 return {ctx,calls:()=>requests,release:()=>release?.()};
}
test('account and sector consumers share one pending verified KRX catalog fetch',async()=>{
 const f=fixture();
 const a=f.ctx.loadExternalMaster(),b=f.ctx.loadExternalMaster();
 assert.equal(f.calls(),1,'dedupe in-flight reads across consumers');
 f.release();
 await Promise.all([a,b]);
 assert.equal(vm.runInContext('EXT_MASTER.byCode.has("000001")',f.ctx),true);
 await f.ctx.loadExternalMaster();
 assert.equal(f.calls(),1,'recent verified catalog reused without another fetch');
});
test('expired or invalid KRX catalogs are never accepted as verified cache',async()=>{
 const f=fixture({stale:true});
 const first=f.ctx.loadExternalMaster();
 f.release();await first;
 assert.equal(vm.runInContext('EXT_MASTER',f.ctx),null);
 assert.match(vm.runInContext('EXT_MASTER_ERROR',f.ctx),/갱신 필요/);
 const next=f.ctx.loadExternalMaster();
 assert.equal(f.calls(),2,'stale catalog must be requested again, not cached');
 f.release();await next;
});
