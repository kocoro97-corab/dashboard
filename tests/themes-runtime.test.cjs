const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const nodes={themes:{innerHTML:'',addEventListener(){}},thS:{textContent:''}},calls=[];let fail=false;
const ctx=vm.createContext({Date,console,LS:()=> 'SYNTHETIC_TEST_SESSION',NET:{log:[]},H:[],Q:{},isKR:()=>false,openKR:()=>false,showQ(){},esc:String,nnum:v=>v==null?null:Number(String(v).replaceAll(',','')),nsgn:(o,n)=>n,$:id=>nodes[id],getJSON:async url=>{calls.push(url);if(fail)return null;return url.includes('/theme?')?{groups:[{no:12,name:'Synthetic verified theme',changeRate:'2.5'}]}:{stocks:[{itemCode:'005930',stockName:'Synthetic stock',fluctuationsRatio:'1.5',accumulatedTradingValue:'1,000',accumulatedTradingVolume:'10,000'}]}}});vm.runInContext(fs.readFileSync('js/themes.js','utf8'),ctx);return {ctx,calls,nodes,fail(){fail=true}}}
test('verified mobile groups and stocks populate existing ranking and cache',async()=>{const f=setup();await vm.runInContext('fetchTopThemes()',f.ctx);assert.equal(f.calls[0],'https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100');assert.equal(f.calls.length,2);assert.equal(vm.runInContext('THM[0].rows[0].code',f.ctx),'005930');assert.equal(vm.runInContext('THM[0].val',f.ctx),1000);await vm.runInContext('fetchTopThemes()',f.ctx);assert.equal(f.calls.length,2)});
test('failed refresh ends loading and explicitly marks preserved older data',async()=>{const f=setup();await vm.runInContext('fetchTopThemes()',f.ctx);f.fail();await vm.runInContext('THM_AT=0;fetchTopThemes()',f.ctx);assert.match(f.nodes.thS.textContent,/수신 실패.*이전 수신 자료 유지/);assert.equal(vm.runInContext('THM_BUSY',f.ctx),false);assert.equal(vm.runInContext('THM.length',f.ctx),1)});

test('verified theme list becomes visible before slow constituent detail is complete',async()=>{
  let finishDetails;
  const nodes={themes:{innerHTML:'',addEventListener(){}},thS:{textContent:''}};
  const ctx=vm.createContext({Date,console,LS:()=> 'SYNTHETIC_TEST_SESSION',NET:{log:[]},
    H:[],Q:{},isKR:()=>false,openKR:()=>false,showQ(){},esc:String,
    nnum:v=>v==null?null:Number(v),nsgn:(o,n)=>n,$:id=>nodes[id],
    getJSON:async url=>url.includes('/theme?')
      ?{groups:[{no:12,name:'Verified theme early',changeRate:'2.5'}]}
      :await new Promise(resolve=>{finishDetails=resolve})
  });
  vm.runInContext(fs.readFileSync('js/themes.js','utf8'),ctx);
  const inFlight=vm.runInContext('fetchTopThemes()',ctx);
  for(let i=0;i<5&&!finishDetails;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finishDetails,'function');
  assert.equal(vm.runInContext('THM_PREVIEW[0].name',ctx),'Verified theme early');
  assert.equal(vm.runInContext('THM.length',ctx),0,'unverified composite score must not be faked');
  assert.equal(vm.runInContext('THM_BUSY',ctx),true);
  finishDetails({stocks:[{itemCode:'005930',stockName:'Synthetic stock',fluctuationsRatio:'1.5',accumulatedTradingValue:1000,accumulatedTradingVolume:100}]});
  await inFlight;
  assert.equal(vm.runInContext('THM_PREVIEW.length',ctx),0);
  assert.equal(vm.runInContext('THM[0].rows[0].code',ctx),'005930');
});
