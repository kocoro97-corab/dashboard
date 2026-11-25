const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(enabled=true){
  const state={token:'a'.repeat(64),remaining:300000,now:1000,calls:[],fail:false},nodes={};
  const config={devSession:enabled,publicMarket:enabled,endpoint:'https://synthetic-chart.trycloudflare.com/api'};
  class Clock extends Date{static now(){return state.now}}
  const node=id=>nodes[id]??={textContent:'',innerHTML:'',style:{},classList:{toggle(){}},addEventListener(){},clientWidth:0};
  const ctx=vm.createContext({Date:Clock,window:{MYINVEST_TRANSPORT_CONFIG:config,addEventListener(){}},document:{querySelectorAll:()=>[]},
    $:node,LS:()=>state.token,sessionLeftMs:()=>state.remaining,isKR:x=>/^\d{6}$/.test(x),KY:{},CFG:{KR:[],US:[]},nf:x=>String(x),
    nnum:x=>x==null?null:Number(String(x).replace(/,/g,'')),getJSON:async url=>{
      state.calls.push(url);if(state.fail)return null;
      if(url.includes('/price?'))return [{localTradedAt:'2026-11-12',closePrice:'100'},{localTradedAt:'2026-11-13',closePrice:'102'}];
      return {chart:{result:[{timestamp:[1794441600,1794528000],indicators:{quote:[{open:[99,100],high:[101,103],low:[98,99],close:[100,102]}]}}]}};
    }});
  vm.runInContext(fs.readFileSync('js/chart.js','utf8'),ctx,{filename:'chart.js'});
  const load=(symbol='^KS11',i=0)=>{ctx.symbol=symbol;ctx.period=i;return vm.runInContext('QX={y:symbol,name:"Synthetic chart",t:""};loadQ(period)',ctx)};
  return {ctx,state,config,nodes,load};
}
test('revisiting the same public daily chart avoids both network reads and labels its age',async()=>{
  const f=setup();await f.load();assert.equal(f.state.calls.length,2);
  f.state.now+=15000;await f.load();assert.equal(f.state.calls.length,2);assert.ok(f.nodes.qi.textContent.includes('캐시 · 15초 전 수신'));
});
test('cache expires from the original receipt, not from the last selection',async()=>{
  const f=setup();await f.load();f.state.now+=15000;await f.load();f.state.now+=16000;await f.load();assert.equal(f.state.calls.length,4);
});
test('US chart cache is separated by symbol and chart period',async()=>{
  const f=setup();await f.load('SYNTHA',1);await f.load('SYNTHB',1);await f.load('SYNTHA',2);assert.equal(f.state.calls.length,3);
  await f.load('SYNTHA',1);assert.equal(f.state.calls.length,3);
});
test('a changed login session or relay cannot reuse the previous cache',async()=>{
  for(const change of [f=>{f.state.token='b'.repeat(64)},f=>{f.config.endpoint='https://different-chart.trycloudflare.com/api'}]){
    const f=setup();await f.load();change(f);await f.load();assert.equal(f.state.calls.length,4);
  }
});
test('logout and local session expiry remove cached results from eligibility',async()=>{
  for(const change of [f=>{f.state.token=null},f=>{f.state.remaining=0}]){
    const f=setup();await f.load();change(f);assert.equal(vm.runInContext('chartCacheScope()',f.ctx),null);
    assert.equal(vm.runInContext('Q_CACHE.size',f.ctx),0);
  }
});
test('explicit full refresh invalidates cached chart data',async()=>{
  const f=setup();await f.load();f.ctx.clearChartCache();await f.load();assert.equal(f.state.calls.length,4);
});
test('the normal nondevelopment path keeps its existing network behavior',async()=>{
  const f=setup(false);await f.load();await f.load();assert.equal(f.state.calls.length,4);
});
test('failed responses are not cached as successful chart data',async()=>{
  const f=setup();f.state.fail=true;await f.load();const n=f.state.calls.length;await f.load();assert.equal(f.state.calls.length,2*n);assert.equal(vm.runInContext('Q_CACHE.size',f.ctx),0);
});
test('public chart cache stays bounded',async()=>{
  const f=setup();for(let i=0;i<15;i++)await f.load('SYNTH'+i,1);assert.equal(vm.runInContext('Q_CACHE.size',f.ctx),12);
});
test('a response started under an old session is not cached for the next login',async()=>{
  const f=setup(),release=[];f.ctx.getJSON=()=>new Promise(resolve=>release.push(resolve));
  const loading=f.load();f.state.token='b'.repeat(64);
  for(const resolve of release)resolve([{localTradedAt:'2026-11-12',closePrice:'100'},{localTradedAt:'2026-11-13',closePrice:'102'}]);
  await loading;assert.equal(vm.runInContext('Q_CACHE.size',f.ctx),0);
});
