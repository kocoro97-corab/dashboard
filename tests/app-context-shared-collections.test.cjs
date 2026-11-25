'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/app-context.js','utf8');
function fixture(){
 let token='a'.repeat(64),resolveSector,sectorCalls=0,newsCalls=0,promotions=[];
 const root={
  window:{MYINVEST_TRANSPORT_CONFIG:{devSession:true,publicMarket:true,accountReads:false}},
  LS:()=>token,
  DashboardTransport:{promoteShared:tag=>promotions.push(tag)},
  fetchTopThemes:()=>{sectorCalls++;return new Promise(resolve=>{resolveSector=resolve})},
  loadNews:async()=>{newsCalls++},
  refreshMarket:async()=>{},
  QX:null
 };
 root.globalThis=root;
 vm.runInNewContext(source,root,{filename:'app-context.js'});
 return {ctx:root.AppContext.create(),finishSector:()=>resolveSector?.(),counters:()=>({sectorCalls,newsCalls,promotions:[...promotions]}),setToken:value=>{token=value}};
}
test('visible sectors joins background collection after navigation and reuses completed data',async()=>{
 const f=fixture();
 const background=f.ctx.sectors();
 await Promise.resolve();
 f.ctx.cancelPending({keepSharedPublic:true});
 const visible=f.ctx.sectors();
 assert.equal(f.counters().sectorCalls,1,'background and foreground must share collector');
 assert.deepEqual(f.counters().promotions,['sectors']);
 f.finishSector();
 await Promise.all([background,visible]);
 await f.ctx.sectors();
 assert.equal(f.counters().sectorCalls,1,'successful collection is cached by TTL');
});
test('shared public warmers never cause account reads and logout invalidates session',async()=>{
 const f=fixture();
 const pending=f.ctx.sectors();
 await Promise.resolve();
 await f.ctx.accounts();
 assert.equal(f.ctx.accountReads(),false);
 f.setToken('b'.repeat(64));
 f.ctx.clear();
 f.finishSector();await pending;
 const fresh=f.ctx.sectors();
 await Promise.resolve();
 assert.equal(f.counters().sectorCalls,2,'new session must fetch anew');
 f.finishSector();await fresh;
});
test('non-shared jobs are cancelled and never become reusable across navigation',async()=>{
 const f=fixture();
 let releases;
 const job=f.ctx.once('private-synthetic',()=>new Promise(resolve=>{releases=resolve}));
 await Promise.resolve();
 f.ctx.cancelPending({keepSharedPublic:true});
 releases();await job;
 let reruns=0;
 await f.ctx.once('private-synthetic',()=>{reruns++;return true});
 assert.equal(reruns,1);
 assert.equal(f.counters().sectorCalls,0);
});
