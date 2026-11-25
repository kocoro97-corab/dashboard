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
test('requested k4 alone enters NH collector and successful NH quote reaches canonical Q',async()=>{const f=setup();Object.assign(f.ctx,{NHF:{k3:'A01',k4:'A06'},sess:()=> 'KR',hms:()=> 'test',fillNaver:async()=>{},fillQuotes:async()=>{},renderCards:()=>{},updateTickGauge:()=>{},generateScenario:()=>{}});let items;f.ctx.nhFetch=async value=>{items=value;return {ok:true,data:{k4:{p:1500,prev:1490,observedAt:Date.now()-30000,code:'A066C000',expiry:'20261210',contractVerified:true,volume:123}},errors:{}}};await f.ctx.refreshMarket(['k4']);assert.equal(items.length,1);assert.equal(items[0].k,'k4');assert.equal(items[0].c,'A06');assert.equal(vm.runInContext('Q.k4.p',f.ctx),1500);assert.equal(vm.runInContext('NQ.k4.p',f.ctx),1500);assert.equal(vm.runInContext('SRC.k4',f.ctx),'H');assert.ok(vm.runInContext('Q.k4.observedAt',f.ctx)>0);f.ctx.nhFetch=async()=>({ok:false});await f.ctx.fillNH(['k4']);assert.equal(vm.runInContext('Q.k4',f.ctx),undefined)});
test('wrong NH product cannot overwrite k4 and stale provider metadata is cleared',async()=>{const f=setup();Object.assign(f.ctx,{NHF:{k3:'A01',k4:'A06'},hms:()=> 'test'});vm.runInContext("Q.k4={p:1};SRC.k4='H';QT.k4=1",f.ctx);f.ctx.nhFetch=async()=>({ok:true,data:{k4:{p:100,prev:99,code:'A016C000'}},errors:{}});await f.ctx.fillNH(['k4']);assert.equal(vm.runInContext('Q.k4',f.ctx),undefined);assert.equal(vm.runInContext('SRC.k4',f.ctx),undefined);assert.equal(vm.runInContext('QT.k4',f.ctx),undefined)});
test('a futures response from the previous session is discarded before state/error mutation',async()=>{const f=setup();let token='a'.repeat(64),release;Object.assign(f.ctx,{LS:()=>token,NHF:{k4:'A06'},hms:()=> 'test'});f.ctx.nhFetch=()=>new Promise(r=>release=r);const job=f.ctx.fillNH(['k4']);token='b'.repeat(64);release({ok:true,data:{k4:{p:1500,prev:1490,code:'A066C000',expiry:'20261210',contractVerified:true,observedAt:Date.now()-30000}},errors:{}});assert.equal((await job).discarded,true);assert.equal(vm.runInContext('Q.k4',f.ctx),undefined)});
test('late fallback provider responses cannot repopulate a changed session',async()=>{
 for(const kind of ['futures','tick']){
  const f=setup();let session='old-session',finish;f.ctx.LS=()=>session;
  f.ctx.window.MyInvestMarketSourcePriority={resolve:()=>new Promise(r=>{finish=r})};
  const running=f.ctx.fillAuthorizedMarketSources(kind==='futures');session='new-session';
  finish({quote:{p:1200,prev:1190,observedAt:Date.now(),contractCode:'A066C000',expiry:'20261210',provider:kind==='futures'?'NH_PLUG_WS':'IBKR'},attempts:[]});await running;
  assert.equal(vm.runInContext('Q.k4',f.ctx),undefined);assert.equal(vm.runInContext('Q.TICK',f.ctx),undefined);
 }
});

test('legacy TICK gauge never estimates market breadth from index price changes',()=>{
 const f=setup();f.ctx.$('tin').value='';f.ctx.$('tm').style={};
 vm.runInContext('Q["^IXIC"]={p:150,prev:100};Q["^GSPC"]={p:120,prev:100};updateTickGauge()',f.ctx);
 assert.equal(vm.runInContext('TS.g.ok',f.ctx),false);assert.equal(f.ctx.$('tm').hidden,true);assert.match(f.ctx.$('tl2').textContent,/미연결/);
});
test('legacy TICK gauge accepts dated verified provider values including zero, and clears stale samples',()=>{
 const f=setup();f.ctx.$('tin').value='';f.ctx.$('tm').style={};
 vm.runInContext('Q.TICK={p:-700,observedAt:Date.now()};SRC.TICK="X";updateTickGauge()',f.ctx);
 assert.match(f.ctx.$('tl2').textContent,/-700/);assert.match(vm.runInContext('TS.g.src',f.ctx),/dxFeed/);assert.equal(f.ctx.$('tm').hidden,false);
 vm.runInContext('Q.TICK.p=0;updateTickGauge()',f.ctx);assert.match(f.ctx.$('tl2').textContent,/관측값: 0/);
 vm.runInContext('Q.TICK.observedAt=Date.now()-121000;updateTickGauge()',f.ctx);assert.equal(vm.runInContext('TS.g.ok',f.ctx),false);assert.equal(f.ctx.$('tm').hidden,true);
 vm.runInContext('Q.TICK.observedAt=Date.now();SRC.TICK="M";updateTickGauge()',f.ctx);assert.equal(vm.runInContext('TS.g.ok',f.ctx),false);
});
test('manual TICK remains explicit and does not become an authenticated provider observation',()=>{
 const f=setup();f.ctx.$('tin').value='125';f.ctx.$('tm').style={};f.ctx.$('tm').hidden=true;f.ctx.setTick();
 assert.equal(f.ctx.$('tm').hidden,false);assert.match(f.ctx.$('tl2').textContent,/입력값: 125/);assert.equal(vm.runInContext('Q.TICK',f.ctx),undefined);
});
test('failed refresh keeps the last quote and original receipt with an explicit stale marker',async()=>{
 const f=setup();vm.runInContext('Q.AAA={p:100,prev:99,observedAt:123};QT.AAA=77;SRC.AAA="Y"',f.ctx);f.ctx.quote=async()=>null;await f.ctx.fillQuotes(['AAA']);assert.equal(vm.runInContext('Q.AAA.p',f.ctx),100);assert.equal(vm.runInContext('QT.AAA',f.ctx),77);assert.equal(vm.runInContext('Q.AAA.refreshFailed',f.ctx),true);
 f.ctx.quote=async()=>({p:101,prev:99,observedAt:456});await f.ctx.fillQuotes(['AAA']);assert.equal(vm.runInContext('Q.AAA.refreshFailed',f.ctx),undefined);assert.equal(vm.runInContext('Q.AAA.p',f.ctx),101);
});
test('departed market bulk collector does not start the rest of an old route queue',async()=>{
 const f=setup();f.ctx.window.location={hash:'#/market'};const release=[],calls=[];f.ctx.quote=s=>{calls.push(s);return new Promise(r=>release.push(r))};const running=f.ctx.fillQuotes(['AAA','BBB','CCC','DDD','EEE','FFF']);f.ctx.window.location.hash='#/news';release.forEach(r=>r({p:100,prev:99}));await running;assert.equal(calls.length,4);assert.equal(vm.runInContext('Object.keys(Q).length',f.ctx),0);
});


test('an obsolete sector view can abort its public read without a fallback or a failure counter',async()=>{
 const f=setup({body:'{"synthetic":true}'});
 const controller=new AbortController();
 let forwarded=null,calls=0;
 f.ctx.DashboardTransport.publicRead=(url,options)=>{
  calls++;forwarded=options?.signal;
  return new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(Object.assign(Error('READ_CANCELLED'),{code:'READ_CANCELLED'})),{once:true});
  });
 };
 const promise=f.ctx.getTxt('https://synthetic.public.example/cancellable',{signal:controller.signal});
 assert.strictEqual(forwarded,controller.signal);
 controller.abort();
 assert.equal(await promise,null);
 assert.equal(calls,1);
 assert.equal(vm.runInContext('NET.fail',f.ctx),0);
});

test('first Naver quote is published while another Naver source is still pending',async()=>{
 const f=setup(),seen=[];let release;
 f.ctx.getJSON=url=>{
  if(url.includes('domestic/index/KOSDAQ'))return new Promise(resolve=>{release=resolve});
  if(url.includes('domestic/index/KOSPI'))return Promise.resolve([{closePrice:'2500',compareToPreviousClosePrice:'20'}]);
  return Promise.resolve({});
 };
 const found=new Set();
 const pending=f.ctx.fillNaver(['^KS11','^KQ11'],found,symbol=>seen.push(symbol));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(seen,['^KS11']);
 assert.equal(vm.runInContext('Q["^KS11"].p',f.ctx),2500);
 release([{closePrice:'800',compareToPreviousClosePrice:'5'}]);
 await pending;
 assert.deepEqual(seen,['^KS11','^KQ11']);
});

test('visible market renders first valid quote before remaining fallback work settles',async()=>{
 const f=setup(),seen=[];let finishFallback;
 const pendingFallback=new Promise(resolve=>{finishFallback=resolve});
 Object.assign(f.ctx,{
  fillNaver:async (requested,found,onQuote)=>{
   assert.ok(requested.includes('AAA'));
   vm.runInContext('Q.AAA={p:100,prev:98}',f.ctx);
   found.add('AAA');onQuote('AAA');
  },
  fillQuotes:async()=>{seen.push('fallback-start');await pendingFallback},
  fillAuthorizedMarketSources:async()=>{},
  renderCards:()=>seen.push('render'),updateTickGauge:()=>{},generateScenario:()=>{}
 });
 const running=f.ctx.refreshMarket(['AAA']);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(seen.slice(0,2),['render','fallback-start']);
 finishFallback();await running;
 assert.equal(seen.at(-1),'render','final state should still be displayed');
});
