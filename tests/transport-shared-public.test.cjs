'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/transport.js','utf8');
const endpoint='https://synthetic-shared-relay.workers.dev/api';
const token='a'.repeat(64);
const sectorUrl='https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100';
const newsUrl='https://news.google.com/rss/search?q=test&hl=ko&gl=KR&ceid=KR:ko';
function fixture({development=true}={}){
 let authToken=token, requestId=0;
 const releases=[],calls=[];
 const location=new URL('https://kocoro97-corab.github.io/dashboard-v2-dev/');
 location.hash='#/home';
 const ctx=vm.createContext({
   URL,Response,AbortController,Event,performance:{now:()=>5000},
   location,AppRouter:{validHash:()=>true},
   MYINVEST_PERSISTENT_RELAY:{endpoint},
   MYINVEST_TRANSPORT_CONFIG:{mode:'relay',endpoint,devSession:development,publicMarket:development,persistentRelay:true},
   LS:()=>authToken,dispatchEvent:()=>{},
   setTimeout:()=>1,clearTimeout:()=>{},
   fetch:async(url,options)=>{
     assert.equal(url,endpoint);
     assert.equal(options.credentials,'omit');
     assert.equal(options.redirect,'error');
     const body=JSON.parse(options.body);
     calls.push(body);
     return new Promise(resolve=>releases.push((status=200,code=null)=>resolve(new Response(JSON.stringify(
       status===200?(body.action==='publicFetch'?{success:true,text:'{"groups":[]}'}:{success:true,accounts:[]}):
       {success:false,code}
     ),{status,headers:{'Content-Type':'application/json'}}))));
   }
 });
 vm.runInContext(source,ctx,{filename:'transport.js'});
 const api=ctx.DashboardTransport;
 const tick=async()=>{await new Promise(resolve=>setImmediate(resolve))};
 return {api,calls,releases,location,tick,setToken:value=>{authToken=value}};
}
test('shared themes request survives navigation and is joined instead of repeated',async()=>{
 const f=fixture();
 const first=f.api.publicRead(sectorUrl,{sharedPublic:true,sharedTag:'sectors'});
 await f.tick();
 assert.equal(f.calls.length,1);
 f.location.hash='#/sectors';
 f.api.cancelReads({keepSharedPublic:true});
 const same=f.api.publicRead(sectorUrl,{sharedPublic:true,sharedTag:'sectors'});
 await f.tick();
 assert.equal(f.calls.length,1,'navigation must not reissue an in-flight public request');
 assert.equal(f.api.readState().sharedActive,1);
 assert.equal(f.api.readState().sharedJoins,1);
 f.releases[0]();
 const [a,b]=await Promise.all([first,same]);
 assert.equal(await a.text(),'{"groups":[]}');
 assert.equal(await b.text(),'{"groups":[]}');
 assert.equal(f.api.readState().sharedActive,0);
});
test('logout invalidates an in-flight shared request before its data can be used',async()=>{
 const f=fixture();
 const req=f.api.publicRead(newsUrl,{sharedPublic:true,sharedTag:'news'});
 await f.tick();
 f.setToken('b'.repeat(64));
 f.api.cancelReads();
 await assert.rejects(req,/SESSION_CHANGED/);
 f.releases[0]();
 await f.tick();
 assert.equal(f.api.readState().sharedActive,0);
});
test('NH account read cannot survive route navigation even when public warmers are kept',async()=>{
 const f=fixture();
 const req=f.api.post({action:'nhAccounts',token});
 await f.tick();
 f.location.hash='#/market';
 f.api.cancelReads({keepSharedPublic:true});
 await assert.rejects(req,/SESSION_CHANGED/);
 f.releases[0]();
 await f.tick();
 assert.equal(f.api.readState().sharedActive,0);
});
test('request retention is restricted to explicitly approved public RSS/themes URLs',async()=>{
 const f=fixture();
 const bad='https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y';
 const req=f.api.publicRead(bad,{sharedPublic:true,sharedTag:'sectors'});
 await assert.rejects(req,/RELAY_CONFIG_INVALID/);
 assert.equal(f.calls.length,0,'unauthorized shared mode cannot issue a network request');
 assert.equal(f.api.readState().sharedActive,0);
});
test('pending foreground reads move ahead of queued background requests without extra network calls',async()=>{
 const f=fixture();f.location.hash='#/sectors';
 const a=f.api.publicRead(sectorUrl,{sharedPublic:true,sharedTag:'sectors'});
 const b=f.api.publicRead(newsUrl,{sharedPublic:true,sharedTag:'news'});
 await f.tick();assert.equal(f.calls.length,2);
 const c=f.api.publicRead('https://news.google.com/rss/search?q=more&hl=ko&gl=KR&ceid=KR:ko',{sharedPublic:true,sharedTag:'news'});
 const d=f.api.post({action:'nhAccounts',token});
 await f.tick();
 assert.equal(f.calls.length,2);
 assert.ok(f.api.readState().sharedQueued>=1);
 f.releases[0]();await f.tick();await f.tick();
 assert.equal(f.calls[2].action,'nhAccounts','current foreground access must precede idle background');
 f.releases[2]();await f.tick();await f.tick();
 assert.equal(f.calls[3].url,'https://news.google.com/rss/search?q=more&hl=ko&gl=KR&ceid=KR:ko');
 f.releases[1]();f.releases[3]();
 await Promise.all([a,b,c,d]);
});

test('production relay ignores development-only sharing flags and still cancels on navigation',async()=>{
 const f=fixture({development:false});
 const req=f.api.publicRead(sectorUrl,{sharedPublic:true,sharedTag:'sectors'});
 await f.tick();
 assert.equal(f.calls.length,1);
 assert.equal(f.api.readState().sharedActive,0);
 f.location.hash='#/news';
 f.api.cancelReads({keepSharedPublic:true});
 await assert.rejects(req,/SESSION_CHANGED/);
 f.releases[0]();
 await f.tick();
});

test('background public prefetch reserves one read slot for the visible menu',async()=>{
 const f=fixture();
 const first=f.api.publicRead(sectorUrl,{sharedPublic:true,sharedTag:'sectors'});
 const second=f.api.publicRead(newsUrl,{sharedPublic:true,sharedTag:'news'});
 await f.tick();
 assert.equal(f.calls.length,1,'only one unrelated background request may occupy transport');
 assert.equal(f.api.readState().sharedQueued,1);
 const urgent=f.api.post({action:'nhAccounts',token});
 await f.tick();await f.tick();
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[1].action,'nhAccounts','current view retains a physical read slot');
 f.releases[1]();await f.tick();await f.tick();
 assert.equal(f.calls.length,3,'queued background work resumes once capacity returns');
 f.releases[0]();f.releases[2]();
 await Promise.all([first,second,urgent]);
});
