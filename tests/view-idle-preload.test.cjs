'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Idle=require('../js/view-idle-preload.js');
function fixture(){
 let next=0;
 const timers=new Map(),calls=[];
 const state={page:'home',revision:1,scope:'synthetic-session-A',authenticated:true,publicConnected:true,visible:true};
 const relay={active:0,queued:0,backpressureMs:0};
 const warm=Idle.create({state:()=>({...state}),readState:()=>({...relay}),
  load:async kind=>{calls.push(kind)},
  later:fn=>{const id=++next;timers.set(id,fn);return id},
  clearLater:id=>timers.delete(id)});
 async function fire(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve))}
 return {state,relay,warm,calls,fire,timers};
}
test('only permitted public target is prepared after foreground and idle',async()=>{
 const f=fixture();
 assert.equal(f.warm.schedule('home'),true);
 assert.deepEqual(f.calls,[]);
 await f.fire();
 assert.deepEqual(f.calls,['sectors']);
 assert.equal(f.warm.schedule('home'),false,'duplicate prefetch is suppressed');
 f.state.page='sectors';f.state.revision++;
 assert.equal(f.warm.schedule('sectors'),true);
 await f.fire();
 assert.deepEqual(f.calls,['sectors','news']);
 for(const page of ['accounts','settings','diagnostics']){
  f.state.page=page;f.state.revision++;
  assert.equal(f.warm.schedule(page),false,'private and diagnostic pages never prefetch');
 }
});
test('navigation, hidden tab and logout cancel pending idle work',async()=>{
 const f=fixture();
 assert.equal(f.warm.schedule('home'),true);
 f.warm.cancel();
 await f.fire();
 assert.deepEqual(f.calls,[]);
 assert.equal(f.warm.schedule('home'),true);
 f.state.page='market';f.state.revision++;
 await f.fire();
 assert.deepEqual(f.calls,[]);
 f.state.visible=false;
 assert.equal(f.warm.schedule('market'),false);
 f.state.visible=true;
 assert.equal(f.warm.schedule('market'),true);
 f.state.authenticated=false;
 await f.fire();
 assert.deepEqual(f.calls,[]);
 f.warm.clear();
 assert.equal(f.timers.size,0);
});
test('relay queue, congestion or missing transport state prevent idle fetches',async()=>{
 const f=fixture();
 for(const key of ['active','queued','backpressureMs']){
  f.relay[key]=1;
  assert.equal(f.warm.schedule('home'),true);
  await f.fire();
  assert.deepEqual(f.calls,[]);
  f.relay[key]=0;
 }
 assert.equal(f.warm.schedule('home'),true);
 await f.fire();
 assert.deepEqual(f.calls,['sectors']);
});
test('a new authorized session resets one-time prefetch without persisting private data',async()=>{
 const f=fixture();
 f.warm.schedule('home');await f.fire();
 f.state.scope='synthetic-session-B';
 f.state.revision++;
 f.warm.schedule('home');await f.fire();
 assert.deepEqual(f.calls,['sectors','sectors']);
 assert.equal(typeof f.warm.snapshot,'undefined');
 assert.equal(typeof f.warm.send,'undefined');
});
