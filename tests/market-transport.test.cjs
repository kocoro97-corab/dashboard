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
