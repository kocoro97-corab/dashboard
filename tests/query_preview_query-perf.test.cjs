const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const sector=fs.readFileSync('js/page-sectors.js','utf8'),stock=fs.readFileSync('js/page-stocks.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const section=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));
test('sector view requests domestic theme feed only for Korean or mixed theme selection',()=>{
 const r=section(sector,'const needsKrTheme','const legacy=DashboardPages.legacy');
 for(const [category,market,value] of [['theme','KR',true],['theme','MIX',true],['theme','US',false],['industry','KR',false],['industry','US',false]]){
  assert.equal(vm.runInNewContext(r+'\nneedsKrTheme()', {category,market}),value);
 }
});
test('benchmark and independent markets metadata begin concurrently, preserving data gates',async()=>{
 const text=section(sector,'   const n=PERIODS[period],benchmarkSymbol','   if(base===null)');
 for(const [market,category,expected] of [
 ['KR','industry',['^KS11','industry','master']],['US','theme',['SPY','universe']],['US','industry',['SPY']]]){
  const trace=[],b=deferred(),g=deferred(),c=deferred(),u=deferred();
  const ctx={market,category,PERIODS:{'5d':5},period:'5d',force:false,industryRows:[],context:{},series:(_c,key)=>{trace.push(key);return b.promise},
   loadIndustries:()=>{trace.push('industry');return g.promise},loadExternalMaster:()=>{trace.push('master');return c.promise},
   usUniverse:()=>{trace.push('universe');return u.promise},ret:()=>42};
  const run=vm.runInNewContext('(async()=>{'+text+'return {base,universeJob}})()',ctx);
  assert.deepEqual(trace,expected);
  if(market==='KR')ctx.industryRows.push({no:1}); b.resolve({bars:[1,2]});g.resolve();c.resolve();u.resolve({themes:[]});
  assert.equal((await run).base,42);
 }
});
test('stock analysis reuses the same fresh daily data across modes for KR and US; forced refresh still reads',async()=>{
 let reads=[];
 const wf=fs.readFileSync('js/invest-workflow.js','utf8');
 const code=section(wf,'function clear(){','function compatible(');
 const flow=vm.runInNewContext(code+'\n({ensure,clear})',{
  epoch:0,analyses:new Map(),pending:new Map(),themeGroups:[],root:{},valid:()=>true,
  analyzer:async symbol=>{reads.push(symbol);return {symbol,bars:Array(21).fill(1),receivedAt:Date.now()}}
 });
 const fn=section(stock,' async function analyze(sym,force=false)',' function selectStock');
 const calls=[];
 const analyze=vm.runInNewContext(fn+'\nanalyze',{
  symbol:null,lastAnalysis:null,sequence:0,mode:"day",active:true,results:{replaceChildren(){}},status:{},stockLabel:x=>x,
  holdingsFor:()=>({rows:[]}),renderHolding(){},display(){},root:{InvestWorkflow:{ensure:(selection,force)=>{calls.push(force);return flow.ensure(selection,force)},publish(){}}}
 });
 for(const s of ['005930','AAPL']){await analyze(s);await analyze(s);await analyze(s,true);}
 assert.deepEqual(reads,['005930','005930','AAPL','AAPL']);
 assert.deepEqual(calls,[false,false,true,false,false,true]);
});
