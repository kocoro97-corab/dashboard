const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/market.js','utf8');
function scenario(hour,quotes={}){
  const nodes={};
  class MarketDate extends Date{getHours(){return hour}}
  const ctx=vm.createContext({Date:MarketDate,LS:()=>null,DEF:{KR:[],US:[]},FUT:{},$:id=>nodes[id]??={innerHTML:'',textContent:''}});
  vm.runInContext(source,ctx,{filename:'market.js'});
  ctx.syntheticQuotes=quotes;vm.runInContext('Q=syntheticQuotes;generateScenario()',ctx);
  return nodes.gv.textContent;
}
test('missing Korean and US quotes remain unknown rather than a fabricated flat market',()=>{
  for(const hour of [12,23]){
    const text=scenario(hour);assert.ok(text.includes('미확인'));assert.ok(!text.includes('0.00%'));
  }
});
test('a partial quote response preserves the available rate and identifies the missing index',()=>{
  const text=scenario(12,{'^KS11':{p:110,prev:100}});
  assert.ok(text.includes('코스피(10.00%)'));assert.ok(text.includes('코스닥(미확인)'));
});
test('zero change is retained only when both actual price inputs are available',()=>{
  const text=scenario(23,{'^IXIC':{p:100,prev:100},'^GSPC':{p:90,prev:100}});
  assert.ok(text.includes('나스닥(0.00%)'));assert.ok(text.includes('S&P500(-10.00%)'));
});
test('null, zero and nonfinite prices do not become numerical market evidence',()=>{
  for(const quote of [{p:null,prev:100},{p:100,prev:0},{p:0,prev:100},{p:NaN,prev:100},{p:Infinity,prev:100},{p:100,prev:Infinity}]){
    const text=scenario(12,{'^KS11':quote});assert.ok(text.includes('코스피(미확인)'));assert.ok(!text.includes('0.00%'));
  }
});
