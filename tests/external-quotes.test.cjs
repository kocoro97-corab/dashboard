const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');

function frontend(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{},after(){},replaceChildren(){this.textContent=''},appendChild(){},append(){}});
    return elements.get(id);
  };
  const storage={invest_session_token:'test-session'};
  const ctx=vm.createContext({console,Date,setInterval,clearInterval,window:{},
    document:{createElement:()=>({style:{},textContent:''})},
    $:element,LS:key=>storage[key],MYP:()=>'/test-gas',
    NH_ACCOUNTS:[],NH_ACCOUNT_UPDATED:'2026-11-10 12:00:00',
    NH_ACCOUNT_FETCHED_AT:Date.now(),NH_ACCOUNT_SESSION:'test-session',
    fetch:async()=>{throw Error('unexpected request')},
  });
  ctx.ExternalCore=require('../js/external_core.js');
  vm.runInContext(source('js/external_accounts.js'),ctx);
  ctx.testMaster=ctx.ExternalCore.master({schema:1,source:{},instruments:[{code:'035720',name:'카카오',type:'STOCK'},{code:'344820',name:'KCC글라스',type:'STOCK'},{code:'123456',name:'다른종목',type:'STOCK'}]});
  vm.runInContext('EXT_MASTER=testMaster',ctx);
  return {ctx,element,storage,run:code=>vm.runInContext(code,ctx)};
}
function backend(body,http=200){
  const requests=[];
  const ctx=vm.createContext({sessionUser_:token=>token==='test-session'?'tester':null,
    jsonResponse:x=>x,Utilities:{formatDate:()=> '2026-11-10 12:00:00'},
  });
  vm.runInContext(source('gas/Nhplug.gs'),ctx);
  ctx.nhCall_=(api,input)=>{requests.push({api,input});return {http,body}};
  return {ctx,requests,quote:codes=>ctx.handleNhExternalQuotes('test-session',codes)};
}

test('GAS authentication and code validation reject requests before NH access',()=>{
  const b=backend({});
  assert.equal(b.ctx.handleNhExternalQuotes('', ['035720']).success,false);
  assert.equal(b.quote(Array(41).fill('035720')).success,false);
  assert.ok(b.quote(['A035720','35720']).errors.A035720);
  assert.equal(b.requests.length,0);
});
test('GAS reads official and legacy prices, including array blocks and comma formatting',()=>{
  for(const Output_0 of [{stck_prpr:'12,300',now_pr:999},[{stck_prpr:12300}],{now_pr:'12,300'}]){
    const b=backend({rsp_cd:'00000',Output_0});
    assert.equal(b.quote(['035720','035720']).prices['035720'].price,12300);
    assert.equal(b.requests.length,1);
    assert.equal(b.requests[0].api,'/krstock/quote/v1/currentPrice');
    assert.equal(b.requests[0].input.market_cd,'UNT');
  }
});
test('GAS rejects HTTP errors, application errors, mismatched codes, and missing or invalid prices',()=>{
  const cases=[
    [{rsp_cd:'ERROR',Output_0:{stck_prpr:100}},200],
    [{Output_0:{stck_prpr:100}},500],
    [{Output_0:{iem_cd:'005930',stck_prpr:100}},200],
    [{},200],...[0,-1,'invalid','12oops','Infinity'].map(stck_prpr=>[{Output_0:{stck_prpr}},200])
  ];
  for(const [body,http] of cases){
    const r=backend(body,http).quote(['035720']);
    assert.equal(r.prices['035720'],undefined);
    assert.ok(r.diagnostics['035720'].code.startsWith('NH_'));
    assert.ok(r.errors['035720']);
  }
});
test('GAS selects the requested symbol from an array response',()=>{
  const r=backend({Output_0:[{iem_cd:'005930',stck_prpr:500},{iem_cd:'035720',stck_prpr:100}]}).quote(['035720']);
  assert.equal(r.prices['035720'].price,100);
});
test('saved rows are retained for review; no cash deletion or OCR alias code guessing occurs during render',()=>{
  const f=frontend();
  f.run("EXT_ASSETS=[{name:'현금'},{name:'신용'},{name:'KCC2atA'},{name:'카카오'},{name:'미확인종목'}].map(x=>({...x,accountType:'ISA'}));extResolveCodes()");
  const rows=JSON.parse(f.run('JSON.stringify(EXT_ASSETS)'));
  assert.equal(rows.length,5);assert.equal(rows[0].match.status,'invalid');
  assert.equal(rows[2].code,undefined);assert.equal(rows[2].match.status,'unmatched');
  assert.equal(rows[3].match.proposedCode,'035720');assert.equal(rows[3].code,undefined);
});
test('fresh domestic NH prices are reused, overseas holdings are excluded',async()=>{
  const f=frontend();let requested=[];
  f.ctx.NH_ACCOUNTS=[{domestic:{holdings:[{code:'035720',currentPrice:100}]},overseas:{holdings:[{code:'123456',currentPrice:999}]}}];
  f.ctx.fetch=async(url,opt)=>{requested=JSON.parse(opt.body).codes;return {text:async()=>JSON.stringify({success:true,prices:{'123456':{price:200}}})}};
  f.run("EXT_ASSETS=[{name:'카카오',code:'035720',quantity:2,avgPrice:80,accountType:'ISA'},{name:'다른종목',code:'123456',quantity:1,avgPrice:150,accountType:'ISA'}]");
  await f.run('refreshExternalPrices(true)');
  assert.deepEqual(requested,['123456']);
  assert.equal(f.run("EXT_PRICES['035720'].price"),100);
  assert.match(f.element('externalStatus').textContent,/일반계좌 재사용 1종목/);
});
test('NH price reuse expires after five minutes and is isolated to the session',()=>{
  const f=frontend();
  f.ctx.NH_ACCOUNTS=[{domestic:{holdings:[{code:'035720',currentPrice:100}]}}];
  f.ctx.NH_ACCOUNT_FETCHED_AT=Date.now()-300001;
  assert.equal(f.run('Object.keys(extNHPrices()).length'),0);
  f.ctx.NH_ACCOUNT_FETCHED_AT=Date.now();f.storage.invest_session_token='other-session';
  assert.equal(f.run('Object.keys(extNHPrices()).length'),0);
});
test('failed quotes discard the previous price and show partial totals',async()=>{
  const f=frontend();
  f.ctx.fetch=async()=>({text:async()=>JSON.stringify({success:true,prices:{'123456':{price:200}},errors:{'035720':'HTTP 500'}})});
  f.run("EXT_ASSETS=[{name:'카카오',code:'035720',quantity:2,avgPrice:80,accountType:'ISA'},{name:'다른종목',code:'123456',quantity:1,avgPrice:150,accountType:'ISA'}];EXT_PRICES={'035720':{price:9999}}");
  await f.run('refreshExternalPrices(true)');
  assert.equal(f.run("EXT_PRICES['035720']"),undefined);
  assert.match(f.element('externalSummaryCards').innerHTML,/부분 합계/);
  assert.doesNotMatch(f.element('externalSummaryCards').innerHTML,/19,998/);
  assert.match(f.element('externalAssetRows').innerHTML,/시세 미확인/);
  assert.match(f.element('externalStatus').textContent,/HTTP 500/);
});
test('network failure clears stale prices and the next successful refresh clears errors',async()=>{
  const f=frontend();
  f.run("EXT_ASSETS=[{name:'카카오',code:'035720',quantity:2,avgPrice:80,accountType:'ISA'}];EXT_PRICES={'035720':{price:9999}}");
  f.ctx.fetch=async()=>{throw Error('offline')};
  await f.run('refreshExternalPrices(true)');
  assert.equal(f.run('Object.keys(EXT_PRICES).length'),0);
  assert.match(f.element('externalStatus').textContent,/프런트엔드 연결 실패/);
  assert.equal(f.ctx.window.EXT_LAST_QUOTE_DIAGNOSTICS['035720'].code,'FRONTEND_NETWORK');
  f.ctx.fetch=async()=>({text:async()=>JSON.stringify({success:true,prices:{'035720':{price:100}}})});
  await f.run('refreshExternalPrices(true)');
  assert.equal(f.run('Object.keys(window.EXT_LAST_QUOTE_ERRORS).length'),0);
});
test('NH completion during a quote request queues one refresh and reuses its result',async()=>{
  const f=frontend();let release;
  f.ctx.fetch=()=>new Promise(resolve=>{release=resolve});
  f.run("EXT_ASSETS=[{name:'카카오',code:'035720',quantity:2,avgPrice:80,accountType:'ISA'}]");
  const request=f.run('refreshExternalPrices(true)');
  f.ctx.NH_ACCOUNTS=[{domestic:{holdings:[{code:'035720',currentPrice:100}]}}];
  f.run('extSyncWithNH()');
  release({text:async()=>JSON.stringify({success:true,prices:{},errors:{'035720':'failed'}})});
  await request;
  assert.equal(f.run("EXT_PRICES['035720'].price"),100);
  assert.equal(f.run('EXT_PRICE_BUSY'),false);
});
test('legacy and untrusted endpoints migrate; valid Google web app URLs remain',()=>{
  const storage={};const ctx=vm.createContext({document:{readyState:'loading',addEventListener(){}},localStorage:{getItem:k=>storage[k]||null}});
  vm.runInContext(source('js/auth.js'),ctx);
  const target=vm.runInContext('DEFAULT_GAS_URL',ctx);
  assert.match(target,/AKfycbxySfUKUai/);
  assert.equal(vm.runInContext('MYP()',ctx),target);
  storage.invest_myproxy=JSON.stringify(vm.runInContext('LEGACY_GAS_URL',ctx));
  assert.equal(vm.runInContext('MYP()',ctx),target);
  storage.invest_myproxy=JSON.stringify('https://example.com/custom');
  assert.equal(vm.runInContext('MYP()',ctx),target);
  storage.invest_myproxy=JSON.stringify('https://script.google.com/macros/s/test-custom/exec');
  assert.equal(vm.runInContext('MYP()',ctx),'https://script.google.com/macros/s/test-custom/exec');
});

test('upstream exception credentials are classified and never echoed',()=>{
  const b=backend({});b.ctx.nhCall_=()=>{throw Error('https://example.test/oauth2/token?appkey=SYNTHETIC_SECRET')};
  const result=b.quote(['035720']);assert.equal(result.diagnostics['035720'].code,'GAS_TOKEN');assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));
});
test('frontend/GAS HTTP, non-JSON, and application failures have separate diagnostic codes',async()=>{
  const cases=[
    [async()=>{throw Error('SYNTHETIC_PRIVATE_NETWORK_TEXT')},'FRONTEND_NETWORK'],
    [async()=>({ok:false,status:503}),'GAS_HTTP'],
    [async()=>({ok:true,status:200,text:async()=>'<html>SYNTHETIC_PRIVATE_BODY</html>'}),'GAS_NON_JSON'],
    [async()=>({ok:true,status:200,text:async()=>JSON.stringify({success:false,code:'AUTH_REQUIRED',message:'login required'})}),'AUTH_REQUIRED']
  ];
  for(const [fetch,code] of cases){const f=frontend();f.ctx.fetch=fetch;await assert.rejects(f.ctx.extPost('nhExternalQuotes',{codes:['035720']}),error=>error.diagnostic.code===code&&!error.message.includes('SYNTHETIC_PRIVATE'))}
});
test('saved code proposals and overwritten values require explicit user confirmation',async()=>{
  const f=frontend();let requests=0;f.ctx.fetch=async()=>{requests++;throw Error('must not write')};f.ctx.window.confirm=()=>false;
  f.run("EXT_ASSETS=[{accountType:'ISA',name:'카카오',code:'',quantity:101,avgPrice:20100,source:'saved'}];EXT_SAVED_ROWS=extRows(EXT_ASSETS);EXT_SAVED_REV='revision';applyExternalMatchedCodes()");
  assert.equal(f.run('EXT_ASSETS[0].code'),'');
  f.run("EXT_ASSETS[0].code='035720'");await f.run('saveExternalAssets()');assert.equal(requests,0);
});
test('legacy GAS without a revision cannot silently replace saved data',async()=>{
  const f=frontend();let requests=0;f.ctx.fetch=async()=>{requests++;throw Error('must not write')};f.ctx.window.confirm=()=>true;
  f.run("EXT_ASSETS=[{accountType:'ISA',name:'카카오',code:'035720',quantity:101,avgPrice:20100}]");
  await f.run('saveExternalAssets()');assert.equal(requests,0);assert.match(f.element('externalStatus').textContent,/GAS v2/);
});
test('editing while a save is in flight preserves the newer draft and keeps save enabled',async()=>{
  const f=frontend();f.ctx.window.confirm=()=>true;let finish;
  f.ctx.fetch=()=>new Promise(resolve=>{finish=resolve});
  f.run("EXT_ASSETS=[{accountType:'ISA',name:'카카오',code:'035720',quantity:101,avgPrice:20100}];EXT_SAVED_ROWS=extRows(EXT_ASSETS);EXT_SAVED_REV='r1'");
  const pending=f.run('saveExternalAssets()');f.run("editExternal(0,'quantity','202')");
  finish({text:async()=>JSON.stringify({success:true,count:1,revision:'r2',storeVersion:2})});await pending;
  assert.equal(f.run('EXT_ASSETS[0].quantity'),202);assert.equal(f.run('EXT_SAVED_ROWS[0].quantity'),101);
  assert.equal(f.element('externalSaveBtn').style.display,'inline-block');assert.match(f.element('externalStatus').textContent,/미저장/);
});
test('legacy unknown account types cannot pollute summary objects or enter financial totals',()=>{
  const f=frontend();f.run("EXT_ASSETS=[{accountType:'__proto__',name:'카카오',code:'035720',quantity:101,avgPrice:20100}];renderExternalAssets()");
  assert.equal(f.run('({}).eval'),undefined);assert.equal(f.run('EXT_ASSETS[0].match.status'),'invalid');assert.match(f.element('externalAssetRows').innerHTML,/계좌 구분 확인 필요/);
});
test('KRX six-character alphanumeric codes reach NH unchanged',()=>{
  const b=backend({rsp_cd:'00000',Output_0:{iem_cd:'0008Z0',stck_prpr:300}});
  assert.equal(b.quote(['0008Z0']).prices['0008Z0'].price,300);
  assert.equal(b.requests[0].input.iem_cd,'0008Z0');
});
test('a late saved-data load preserves edits made while the request was pending',async()=>{
  const f=frontend();let finish,started;
  const waiting=new Promise(resolve=>{started=resolve});
  f.ctx.fetch=async(url,options)=>{
    if(url==='data/krx-instruments.json')return {ok:true,json:async()=>({schema:1,source:{fetchedAt:new Date().toISOString(),provider:'synthetic master'},instruments:[...f.ctx.testMaster.byCode.values()]})};
    const action=JSON.parse(options.body).action;
    if(action==='externalHoldings'){started();return new Promise(resolve=>{finish=resolve})}
    return {text:async()=>JSON.stringify({success:true,prices:{},errors:{}})};
  };
  f.run("EXT_ASSETS=[{accountType:'ISA',name:'카카오',code:'035720',quantity:101,avgPrice:20100,source:'saved'}]");
  const pending=f.run('loadExternalAssets()');await waiting;f.run("editExternal(0,'quantity','202')");
  finish({text:async()=>JSON.stringify({success:true,storeVersion:2,revision:'r2',holdings:[{accountType:'ISA',name:'카카오',code:'035720',quantity:303,avgPrice:20100,source:'saved'}]})});
  await pending;assert.equal(f.run('EXT_ASSETS[0].quantity'),202);assert.equal(f.run('EXT_SAVED_ROWS[0].quantity'),303);assert.match(f.element('externalStatus').textContent,/임시 목록을 보존/);
});
