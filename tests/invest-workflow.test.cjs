const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const saved=new Map(),ctx=vm.createContext({window:null,Event,Date,sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},dispatchEvent(){}});ctx.window=ctx;vm.runInContext(fs.readFileSync('js/invest-workflow.js','utf8'),ctx);return {api:ctx.InvestWorkflow,saved}}
function data(extra={}){return {symbol:'AAPL',exchange:'NMS',currency:'USD',bars:Array.from({length:80},()=>({c:100})),observedAt:Date.now()-86400000,receivedAt:Date.now(),metrics:{last:100,ma5:99,ma20:95,ma60:90,rsi:50,volumeRatio:1.4,high20:110,low20:80},...extra}}
test('shared selection restores public metadata only, expires and clears on logout',()=>{const f=setup();f.api.select('AAPL',{theme:'반도체',mode:'day',quantity:500,avgPrice:10,accountNumber:'SYNTHETIC',token:'SECRET'});assert.equal(f.api.current().theme,'반도체');assert.equal(f.api.current().mode,'day');assert.equal(f.saved.size,2);assert.ok(![...f.saved.values()].some(s=>/quantity|avgPrice|accountNumber|SECRET/.test(s)));for(const [k,v] of f.saved)f.saved.set(k,JSON.stringify({...JSON.parse(v),at:Date.now()-3600001}));assert.equal(f.api.current(),null);f.api.select('MSFT');f.api.clear();assert.equal(f.saved.size,0)});
test('conditional targets use observed levels and 1R/2R, never create daily-only intraday signals',()=>{const {api}=setup(),d=data(),selection={symbol:'AAPL',market:'US',mode:'swing',themeReturn:null};const cases=api.scenarios(d,selection);assert.equal(cases.length,2);assert.equal(cases[0].entry,110);assert.equal(cases[0].stop,80);assert.equal(cases[0].target1,140);assert.equal(cases[0].target2,170);assert.equal(api.scenarios(d,{...selection,mode:'day'}).length,0);for(const x of [data({bars:[{}]}),data({observedAt:null}),data({observedAt:Date.now()-5*86400000})])assert.equal(api.scenarios(x,selection).length,0);assert.equal(api.judge(d,{...selection,mode:'day'}).label,'판단 불가');assert.notEqual(api.judge(d,selection).label,'매수 후보')});
test('pending analysis is deduplicated, cached and invalidated by logout epoch',async()=>{const {api}=setup();let calls=0,release;api.registerAnalyzer(()=>{calls++;return new Promise(r=>release=r)});const first=api.ensure({symbol:'AAPL'}),second=api.ensure({symbol:'AAPL'});assert.equal(calls,1);release(data());assert.equal((await first).symbol,(await second).symbol);await api.ensure({symbol:'AAPL'});assert.equal(calls,1);const stale=api.ensure({symbol:'AAPL'},true);api.clear();release(data());await assert.rejects(stale,/SESSION_CHANGED/)});
test('holding comparison keeps per-account cost and rejects incompatible exchange/currency',()=>{const {api}=setup(),rows=[{code:'AAPL',market:'overseas',currency:'USD',instrumentId:'US:XNAS:AAPL',quantity:2,avgPrice:90},{code:'AAPL',market:'overseas',currency:'EUR',instrumentId:'DE:XETR:AAPL',quantity:1,avgPrice:80}],ctx={snapshot:()=>({details:rows,result:{rows:[{identity:true},{identity:true}]}})};assert.equal(api.holdings(ctx,{symbol:'AAPL'},data()).length,1);assert.equal(rows[0].avgPrice,90);assert.equal(api.judge(data(),{symbol:'AAPL',mode:'swing',themeReturn:null},ctx).label,'보유 관리');assert.equal(api.holdings({snapshot:()=>({details:rows,result:{rows:[]}})}).length,0)});

test('P3 sector-to-stock context persists public-only relative strength without account fields',()=>{
 const {api,saved}=setup(),asOf=Date.now()-86400000;
 const selection=api.select('TSLA',{name:'Tesla',theme:'로보틱스',source:'theme',mode:'swing',period:'20d',dataScope:'us_theme_sample',benchmark:'SPY',coveragePct:80,stockReturn:4.1,stockRelativeStrength:3.2,relativeStrength:2.0,observedAt:asOf,themeReceivedAt:Date.now(),avgPrice:999,quantity:5,token:'SECRET',accountNumber:'123'});
 assert.equal(selection.dataScope,'us_theme_sample');assert.equal(selection.benchmark,'SPY');assert.equal(selection.coveragePct,80);
 assert.equal(selection.stockRelativeStrength,3.2);assert.equal(api.current().observedAt,asOf);
 assert.ok(![...saved.values()].some(s=>/avgPrice|quantity|token|SECRET|accountNumber/.test(s)));
 const chart=data({symbol:'TSLA'}),result=api.opportunity(api.current(),chart,null);
 assert.equal(result.status,'qualified_watch');
 assert.equal(result.track,'candidate_unconfirmed');
 assert.match(result.label,/스윙 상대강세/);
 assert.ok(result.checks.some(s=>s.includes('80.0%')));
 assert.ok(result.warnings.some(s=>s.includes('미보유로 단정하지 않습니다')));
});
test('P3 never upgrades stale, incomplete or ETF proxy observations to qualified stock leadership',()=>{
 const {api}=setup(),asOf=Date.now()-86400000;
 const common={name:'Tesla',theme:'혁신',mode:'swing',source:'theme',dataScope:'us_theme_sample',benchmark:'SPY',coveragePct:80,relativeStrength:3,stockRelativeStrength:4,observedAt:asOf};
 const chart=data({symbol:'TSLA'});
 const below=api.opportunity(api.select('TSLA',{...common,coveragePct:40}),chart);
 assert.equal(below.status,'insufficient');assert.ok(below.warnings.some(s=>s.includes('60% 미만')));
 const stale=api.opportunity(api.select('TSLA',{...common,observedAt:Date.now()-6*86400000}),chart);
 assert.equal(stale.status,'insufficient');assert.ok(stale.warnings.some(s=>s.includes('관측일')));
 const unknown=api.opportunity(api.select('TSLA',{...common,relativeStrength:null}),chart);
 assert.equal(unknown.status,'insufficient');assert.ok(unknown.warnings.some(s=>s.includes('상대강도')));
 const etf=api.opportunity(api.select('XLK',{...common,industry:'정보기술',theme:'',dataScope:'us_sector_etf'}),data({symbol:'XLK'}));
 assert.equal(etf.status,'insufficient');assert.ok(etf.warnings.some(s=>s.includes('ETF 가격')));
 const intraday=api.opportunity(api.select('TSLA',{...common,mode:'day'}),chart);
 assert.equal(intraday.status,'intraday_unverified');assert.ok(intraday.warnings.some(s=>s.includes('분봉')));
});
test('P3 verified holdings are explicitly management track; unknown accounts are never called empty',()=>{
 const {api}=setup(),asOf=Date.now()-86400000;
 const selected=api.select('TSLA',{name:'Tesla',theme:'로보틱스',mode:'swing',source:'theme',dataScope:'us_theme_sample',benchmark:'SPY',coveragePct:90,relativeStrength:3,stockRelativeStrength:4,observedAt:asOf});
 const chart=data({symbol:'TSLA'});
 const ctx={snapshot:()=>({details:[{code:'TSLA',market:'overseas',currency:'USD',instrumentId:'US:XNAS:TSLA',quantity:3,avgPrice:120}],result:{rows:[{identity:true}]}})};
 const own=api.opportunity(selected,chart,ctx);assert.equal(own.track,'holding');assert.equal(own.status,'holding');assert.match(own.label,/보유종목 관리/);
 const unknown=api.opportunity(selected,chart,{snapshot:()=>null});assert.equal(unknown.track,'candidate_unconfirmed');assert.match(unknown.warnings.join(' '),/미보유로 단정/);
});
