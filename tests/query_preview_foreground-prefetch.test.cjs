const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {create,targets}=require('../js/view-idle-preload.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup(loadExtra,loadAccount){
 let time=0,idx=0,relay={active:0,queued:0,backpressureMs:0};const queue=new Map(),loads=[];
 const state={enabled:true,authenticated:true,publicConnected:true,visible:true,scope:'session',page:'home',revision:1,market:'KR',selection:{symbol:'005930',market:'KR'}};
 const scheduler=create({state:()=>({...state}),readState:()=>relay,loadAccount,now:()=>time,later:fn=>{queue.set(++idx,fn);return idx},clearLater:i=>queue.delete(i),
  load(item,signal){loads.push({item,signal});return loadExtra?.(item,signal)}});
 async function run(){time+=1100;const [i,job]=queue.entries().next().value||[];if(job){queue.delete(i);void job();await settle()}}
 return {scheduler,state,loads,queue,run,setRelay:v=>{relay={...relay,...v}}};
}
test('no background before the selected page finishes; idle runs the chosen market first then selected stock',async()=>{
 const {scheduler,loads,queue,run}=setup();
 await run();assert.equal(loads.length,0);
 const release=scheduler.hold();scheduler.schedule('home');await run();assert.equal(loads.length,0);assert.equal(queue.size,0);
 release();await run();assert.equal(loads.length,1);assert.deepEqual(loads[0].item,{kind:'benchmark',market:'KR'});
 await run();assert.deepEqual(loads[1].item,{kind:'stock',market:'KR',symbol:'005930'});
 await run();assert.equal(loads[2].item.kind,'market-inputs');
 await run();assert.equal(loads.length,3);
});
test('transport activity blocks warming; new foreground action cancels and retains no stale job',async()=>{
 let done;
 const {scheduler,loads,run,setRelay}=setup(()=>new Promise(r=>{done=r}));
 setRelay({active:1});scheduler.schedule('home');await run();assert.equal(loads.length,0);
 setRelay({active:0});scheduler.capacity();await run();assert.equal(loads[0].signal.aborted,false);
 const release=scheduler.hold();assert.equal(loads[0].signal.aborted,true);
 done();await settle();await run();assert.equal(loads.length,1);
 release();await run();assert.equal(loads.length,2);
 done();
});
test('private menus are never warmed; route change, detector visibility, logout, and throttle are fail closed',async()=>{
 const {scheduler,state,loads,run,setRelay}=setup();
 for(const page of ['accounts','news','settings','diagnostics'])assert.deepEqual(targets({...state,page}),[]);
 scheduler.schedule('home');state.page='accounts';state.revision++;scheduler.cancel();await run();assert.equal(loads.length,0);
 state.page='market';state.visible=false;assert.equal(scheduler.schedule('market'),false);
 state.visible=true;scheduler.schedule('market');setRelay({backpressureMs:2000});
 await run();await run();scheduler.clear();state.scope=null;await run();assert.equal(loads.length,0);
});
test('markets are not mixed and recent results do not trigger repeated background reads',async()=>{
 const {scheduler,state,loads,run}=setup();
 state.market='US';assert.equal(targets(state).length,2);
 scheduler.schedule('home');await run();await run();assert.equal(loads.length,2);
 scheduler.cancel();state.page='market';state.revision++;scheduler.schedule('market');await run();
 assert.equal(loads.length,2);
});
test('aborted speculative chart cannot override or clear a foreground chart cache',async()=>{
 const code=fs.readFileSync('js/invest-workflow.js','utf8');
 const part=code.slice(code.indexOf('function clear(){'),code.indexOf('function compatible('));
 const calls=[];
 const flow=vm.runInNewContext(part+'\n({ensure})',{epoch:0,analyses:new Map(),pending:new Map(),themeGroups:[],root:{},valid:()=>true,
 analyzer:(symbol,{signal})=>new Promise(resolve=>calls.push({signal,finish:tag=>resolve({symbol,bars:Array(21).fill(1),tag,receivedAt:Date.now()})}))});
 const c=new AbortController(),pref=flow.ensure({symbol:'AAPL'},false,{signal:c.signal,background:true});
 c.abort();
 const current=flow.ensure({symbol:'AAPL'});assert.equal(calls.length,2);
 calls[1].finish('foreground');await current;
 calls[0].finish('aborted');await assert.rejects(pref,/READ_CANCELLED/);
 assert.equal((await flow.ensure({symbol:'AAPL'})).tag,'foreground');
});
test('shell arms warming only in successful data completion and no legacy fan-out',()=>{
 const shell=fs.readFileSync('js/app-shell.js','utf8'),init=fs.readFileSync('js/init.js','utf8');
 assert.equal((shell.match(/idlePrefetch\?\.schedule/g)||[]).length,1);
 assert.match(shell,/refreshing\.then[\s\S]*?if\(!degraded\)\{root\.DevelopmentDiagnostics[\s\S]*?idlePrefetch\?\.schedule\(route\.page\)/);
 const legacy=init.slice(init.indexOf('async function initDashboard'),init.indexOf('async function loadProtectedHoldings'));
 assert.doesNotMatch(legacy,/loadNHAccounts|loadExternalAssets|fetchTopThemes|loadNews/);
});

test('authorized NH uses a spare lane without waiting for current screen completion; no duplicate per session',async()=>{
 const calls=[];
 const {scheduler,state,setRelay}=setup(null,()=>calls.push(state.scope));
 state.accountAllowed=true;state.singleReadConfirmed=true;setRelay({active:1,limit:1});
 scheduler.armAccount();await settle();assert.deepEqual(calls,[]);
 setRelay({active:1,limit:2,queued:1});scheduler.capacity();await settle();assert.deepEqual(calls,[]);
 setRelay({queued:0});scheduler.capacity();await settle();assert.deepEqual(calls,['session']);
 scheduler.cancel();state.page='market';state.revision++;scheduler.armAccount();await settle();assert.deepEqual(calls,['session']);
 scheduler.clear();state.authenticated=false;scheduler.armAccount();await settle();assert.deepEqual(calls,['session']);
});
