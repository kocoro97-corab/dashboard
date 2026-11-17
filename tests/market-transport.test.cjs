const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup({relay=true,body='[]',ok=true}={}){
  const nodes={},calls=[];const ctx=vm.createContext({LS:()=>null,DEF:{KR:[],US:[]},FUT:{},$:id=>nodes[id]??={innerHTML:'',textContent:''},
    MYP:()=>'',window:{MYINVEST_TRANSPORT_CONFIG:{publicMarket:true}},AbortController,setTimeout:()=>1,clearTimeout:()=>{},
    DashboardTransport:{isRelay:()=>relay,publicRead:async url=>{calls.push(url);return {ok,text:async()=>body}}},fetch:()=>{throw Error('UNEXPECTED_DIRECT_REQUEST')}});
  vm.runInContext(fs.readFileSync('js/market.js','utf8'),ctx);return {ctx,calls};
}
test('the explicit relay works without an exported operating GAS default',async()=>{
  const f=setup({body:'{"synthetic":true}'});assert.equal(await f.ctx.getTxt('https://synthetic.public.example/data'),'{"synthetic":true}');assert.equal(f.calls.length,1);
});
test('valid short JSON including empty chart pages is not a network failure',async()=>{
  for(const body of ['[]','{}']){const f=setup({body});assert.equal(await f.ctx.getTxt('https://synthetic.public.example/data'),body);assert.equal(vm.runInContext('NET.fail',f.ctx),0)}
});
test('missing direct configuration does not create a fallback request',async()=>{
  const f=setup({relay:false});assert.equal(await f.ctx.getTxt('https://synthetic.public.example/data'),null);assert.equal(f.calls.length,0);
});
test('empty bodies and HTTP failures remain failures rather than quote data',async()=>{
  for(const options of [{body:'   '},{ok:false}]){const f=setup(options);assert.equal(await f.ctx.getTxt('https://synthetic.public.example/data'),null);assert.equal(vm.runInContext('NET.fail',f.ctx),1)}
});
test('V2 requested symbols extend existing collector without using unsupported indicator IDs as Yahoo symbols',async()=>{const f=setup(),wanted=[];Object.assign(f.ctx,{sess:()=> 'KR',hms:()=> 'synthetic-time',NHF:{},fillNaver:async list=>{wanted.push(...list)},fillQuotes:async()=>{},renderCards:()=>{},updateTickGauge:()=>{},generateScenario:()=>{}});await f.ctx.refreshMarket(['GC=F','^IRX','k3','k4','TICK','https://private.invalid','GC=F']);assert.deepEqual(wanted,['GC=F','^IRX']);assert.equal(f.calls.length,0)});
test('received Daum future is adapted for V2 without changing the legacy future record',async()=>{const f=setup();f.ctx.FUT.k3='KR4A016C0004';f.ctx.getJSON=async()=>({tradePrice:360,prevClosingPrice:358});f.ctx.hms=()=> 'synthetic-time';await f.ctx.fillFutures();assert.equal(vm.runInContext('Q.k3.p',f.ctx),360);assert.equal(vm.runInContext('Q.k3.prev',f.ctx),358);assert.equal(vm.runInContext('FQ.k3.p',f.ctx),360);assert.equal(vm.runInContext('SRC.k3',f.ctx),'D')});
test('Yahoo quote identity and finite positive price must match the requested market symbol',async()=>{const f=setup();for(const meta of [{symbol:'WRONG',regularMarketPrice:100},{symbol:'GC=F',regularMarketPrice:null},{symbol:'GC=F',regularMarketPrice:-1}]){f.ctx.getJSON=async()=>({chart:{result:[{meta}]}});assert.equal(await f.ctx.quote('GC=F'),null)}f.ctx.getJSON=async()=>({chart:{result:[{meta:{symbol:'GC=F',regularMarketPrice:100,chartPreviousClose:99,regularMarketTime:1000}}]}});assert.equal((await f.ctx.quote('GC=F')).observedAt,1000000)});
test('Naver price without a change retains an unknown comparison rather than fabricating flat',()=>{const f=setup();assert.equal(vm.runInContext('nq({closePrice:"100"}).prev',f.ctx),null);assert.equal(vm.runInContext('nq({closePrice:"100",compareToPreviousClosePrice:"0"}).prev',f.ctx),100)});
