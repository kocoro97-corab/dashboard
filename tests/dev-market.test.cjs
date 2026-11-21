const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(enabled=true,persistent=false){
 const state={token:'a'.repeat(64),calls:[],releases:[],nhCalls:0,chartClears:0};
 const config={mode:'relay',publicMarket:enabled,endpoint:'https://synthetic-one.trycloudflare.com/api',persistentRelay:persistent};
 const nodes={appContainer:{style:{display:'block'}},devBanner:{textContent:''},status:{textContent:''}};
 const ctx=vm.createContext({URL,Event,Date,MYINVEST_TRANSPORT_CONFIG:config,MYINVEST_PERSISTENT_RELAY:{endpoint:config.endpoint},LS:()=>state.token,$:id=>nodes[id]??={textContent:'',style:{display:''}},document:{querySelectorAll:()=>[]},location:{hash:'#/market'},
  NH_STATUS:'',clearChartCache:()=>{state.chartClears++},fillNH:async()=>{state.nhCalls++},manualRefresh:()=>{},refreshMarket:async()=>{},showQ:()=>{},loadNews:async()=>{},renderCards:()=>{},
  fetch:async(url,options)=>{const body=JSON.parse(options.body);state.calls.push({url:body.url,token:state.token,endpoint:url});return new Promise(resolve=>state.releases.push(value=>resolve({ok:true,status:200,json:async()=>({success:true,text:value})})))}});
 vm.runInContext('window=globalThis',ctx);vm.runInContext(fs.readFileSync('js/transport.js','utf8'),ctx);
 ctx.getTxt=async url=>{try{return await(await ctx.DashboardTransport.publicRead(url)).text()}catch{return null}};const original=ctx.getTxt;
 vm.runInContext(fs.readFileSync('js/dev_market.js','utf8'),ctx);ctx.DevelopmentMarket.enable();return {ctx,state,config,original};
}
test('public reads execute one at a time and reserve relay capacity for authentication',async()=>{
  const f=setup();const a=f.ctx.getTxt('first'),b=f.ctx.getTxt('second');await tick();assert.equal(f.state.calls.length,1);
  f.state.releases.shift()('one');assert.equal(await a,'one');await tick();assert.equal(f.state.calls.length,2);
  f.state.releases.shift()('two');assert.equal(await b,'two');
});
test('logout cancels queued reads and discards the in-flight result',async()=>{
  const f=setup();const a=f.ctx.getTxt('first'),b=f.ctx.getTxt('second');await tick();f.state.token=null;
  f.state.releases.shift()('stale-public-data');assert.equal(await a,null);assert.equal(await b,null);assert.equal(f.state.calls.length,1);
});
test('queued reads cannot be replayed to a changed endpoint or new session',async()=>{
  for(const change of [f=>{f.config.endpoint='https://synthetic-two.trycloudflare.com/api'},f=>{f.state.token='different-session'}]){
    const f=setup();const a=f.ctx.getTxt('first'),b=f.ctx.getTxt('second');await tick();change(f);
    f.state.releases.shift()('stale');assert.equal(await a,null);assert.equal(await b,null);assert.equal(f.state.calls.length,1);
  }
});
test('the development public profile never invokes the NH collector',async()=>{
  const f=setup();const result=await f.ctx.fillNH();assert.equal(result.ok,0);assert.equal(result.fail,0);assert.equal(f.state.nhCalls,0);
});
test('missing server capability leaves existing collectors untouched',()=>{
  const f=setup(false);assert.equal(f.ctx.getTxt,f.original);
});
test('pending public reads are bounded and do not multiply upstream calls',async()=>{
  const f=setup();const pending=Array.from({length:129},(_,i)=>f.ctx.getTxt('q'+i));
  assert.equal(await f.ctx.getTxt('overflow'),null);await tick();assert.equal(f.state.calls.length,1);
  f.state.token=null;f.state.releases.shift()('stale');await Promise.all(pending);assert.equal(f.state.calls.length,1);
});
test('full manual refresh invalidates the chart cache before requesting fresh data',async()=>{
  const f=setup();await tick();const n=f.state.chartClears;await f.ctx.manualRefresh();assert.equal(f.state.chartClears,n+1);
});

test('persistent public reads use at most two slots and keep headroom available for authentication',async()=>{const f=setup(true,true);const jobs=['a','b','c','d'].map(s=>f.ctx.getTxt(s));await tick();assert.equal(f.state.calls.length,2);f.state.releases.shift()('one');await tick();assert.equal(f.state.calls.length,3);while(f.ctx.DashboardTransport.readState().active||f.ctx.DashboardTransport.readState().queued){while(f.state.releases.length)f.state.releases.shift()('done');await tick()}await Promise.all(jobs)});
test('persistent parallel queue discards logout results without starting waiting work',async()=>{const f=setup(true,true);const jobs=Array.from({length:9},(_,i)=>f.ctx.getTxt('q'+i));await tick();assert.equal(f.state.calls.length,2);f.state.token=null;while(f.state.releases.length)f.state.releases.shift()('stale');assert.ok((await Promise.all(jobs)).every(x=>x===null));assert.equal(f.state.calls.length,2)});
