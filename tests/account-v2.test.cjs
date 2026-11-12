const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const crypto=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const row=()=>({accountType:'ISA',code:'000001',name:'Synthetic instrument',quantity:2,avgPrice:10,source:'manual'});
function store(){
  const rows=[['header']],legacy=new Map();let failure=null,locked=false,id=0;
  const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>[...r])}),getLastRow:()=>rows.length,getRange:(start)=>({setNumberFormat(){return this},setValues(values){const r=values[0];const mode=failure;
    if(mode==='prepare-before'&&r[2]==='PREPARE'){failure=null;throw Error('synthetic')}
    if(mode==='prepare-partial'&&r[2]==='PREPARE'){failure=null;rows[start-1]=r.slice(0,6);throw Error('synthetic')}
    if(mode==='commit-before'&&r[2]==='COMMIT'){failure=null;throw Error('synthetic')}
    rows[start-1]=[...r];
    if(mode==='commit-after'&&r[2]==='COMMIT'){failure=null;throw Error('synthetic')}
    if(mode==='prepare-corrupt'&&r[2]==='PREPARE'){failure=null;rows[start-1][7]='[]'}
  }})};
  const ctx=vm.createContext({});vm.runInContext(read('gas/AccountStoreV2.gs'),ctx);
  const service=ctx.createAccountStoreV2_({sheet:()=>sheet,legacy:u=>JSON.parse(JSON.stringify(legacy.get(u)||[])),validate:x=>JSON.parse(JSON.stringify(x)),
    hash:s=>crypto.createHash('sha256').update(s).digest('hex'),uuid:()=> 'synthetic-'+(++id),now:()=> 'synthetic timestamp',flush(){},
    lock:fn=>{assert.equal(locked,false);locked=true;try{return fn()}finally{locked=false}}});
  return {service,rows,legacy,fail:mode=>failure=mode,save:(r,user='alice',rev)=>service.commit(user,r,rev??service.read(user).revision,true,'replace')};
}
for(const mode of ['prepare-before','prepare-partial','commit-before','prepare-corrupt'])test('journal '+mode+' preserves last committed holdings and revision',()=>{
  const b=store();b.save([row()]);const before=b.service.read('alice');b.fail(mode);
  assert.throws(()=>b.save([{...row(),quantity:9}]),/STORE_WRITE_FAILED/);
  assert.equal(b.service.read('alice').revision,before.revision);assert.equal(b.service.read('alice').holdings[0].quantity,2);
});
test('commit persisted before transport failure is verified rather than repeated',()=>{
  const b=store();b.save([row()]);b.fail('commit-after');const saved=b.save([{...row(),quantity:9}]);
  assert.equal(saved.success,true);assert.equal(b.service.read('alice').holdings[0].quantity,9);assert.equal(b.rows.filter(r=>r[2]==='COMMIT').length,2);
});
test('restore creates a new revision and rejects ABA stale tabs',()=>{
  const b=store(),original=b.service.read('alice').revision;b.save([row()]);
  const id=b.service.read('alice').history[0].snapshotId;b.service.restore('alice',id,b.service.read('alice').revision,true);
  assert.equal(b.service.read('alice').holdings.length,0);assert.notEqual(b.service.read('alice').revision,original);
  assert.throws(()=>b.save([row()],'alice',original),/STORE_CONFLICT/);
});
test('duplicate concurrent request with old revision performs no second commit',()=>{
  const b=store(),rev=b.service.read('alice').revision;b.save([row()],'alice',rev);
  const n=b.rows.length;assert.throws(()=>b.save([row()],'alice',rev),/STORE_CONFLICT/);assert.equal(b.rows.length,n);
});
test('another user cannot enumerate or restore private snapshots',()=>{
  const b=store();b.save([row()]);const id=b.service.read('alice').history[0].snapshotId;
  assert.equal(b.service.read('bob').holdings.length,0);assert.equal(b.service.read('bob').history.length,0);
  assert.throws(()=>b.service.restore('bob',id,b.service.read('bob').revision,true),/STORE_NOT_FOUND/);
});
test('legacy input is preserved read-only and becomes the first recoverable snapshot',()=>{
  const b=store();b.legacy.set('alice',[row()]);const legacyText=JSON.stringify(b.legacy.get('alice'));
  b.save([]);assert.equal(b.service.read('alice').history[0].holdings[0].quantity,2);assert.equal(JSON.stringify(b.legacy.get('alice')),legacyText);
});
test('corrupted committed payload fails closed instead of silently returning invented data',()=>{
  const b=store();b.save([row()]);b.rows[1][7]='[]';assert.throws(()=>b.service.read('alice'),/STORE_SCHEMA/);
});
test('history view is bounded without deleting any journal or backup records',()=>{
  const b=store();for(let i=0;i<8;i++)b.save([{...row(),quantity:i}]);assert.equal(b.rows.length,17);assert.equal(b.service.read('alice').history.length,5);
});
test('oversized snapshots and missing confirmation cannot write',()=>{
  const b=store(),revision=b.service.read('alice').revision;
  assert.throws(()=>b.service.commit('alice',[row()],revision,false,'replace'),/STORE_CONFIRM/);
  assert.throws(()=>b.save([{...row(),name:'x'.repeat(45001)}]),/STORE_SNAPSHOT_TOO_LARGE/);assert.equal(b.rows.length,1);
});
function domain(){const c=vm.createContext({sessionUser_:t=>t==='synthetic'?'alice':null,jsonResponse:x=>x});vm.runInContext(read('gas/NhAccountsV2.gs'),c);vm.runInContext(read('gas/NhGatewayV2.gs'),c);vm.runInContext(read('gas/Nhplug.gs'),c);return c}
test('overseas quote uses official current path, trdprc and currency_unit',()=>{
  const c=domain(),calls=[];c.nhCall_=(p,input)=>{calls.push({p,input});return {http:200,body:{rsp_cd:'00000',Output_0:{iem_cd:'SYNTH',trdprc:22.5,currency_unit:'USD'}}}};
  const result=c.handleNhStockQuotesV2('synthetic',[{market:'OVERSEAS',code:'SYNTH'}]);
  assert.equal(result.prices['OVERSEAS:SYNTH'].price,22.5);assert.equal(result.prices['OVERSEAS:SYNTH'].currency,'USD');assert.equal(calls[0].p,'/gbstock/quote/v1/current');
});
test('invalid market/symbol and unauthenticated stock quotes perform zero calls',()=>{
  const c=domain();let n=0;c.nhCall_=()=>{n++;throw Error('must not call')};
  assert.equal(c.handleNhStockQuotesV2('bad',[{market:'OVERSEAS',code:'SYNTH'}]).success,false);
  for(const item of [{market:'ORDER',code:'SYNTH'},{market:'OVERSEAS',code:'../order'},{market:'DOMESTIC',code:'00001'}])assert.ok(c.handleNhStockQuotesV2('synthetic',[item]).diagnostics.invalid_1);
  assert.equal(n,0);
});
test('missing overseas price or currency does not become zero or KRW',()=>{
  const c=domain();for(const o of [{trdprc:0,currency_unit:'USD'},{trdprc:5},{trdprc:null,currency_unit:'USD'}]){
    c.nhCall_=()=>({http:200,body:{rsp_cd:'00000',Output_0:o}});const r=c.handleNhStockQuotesV2('synthetic',[{market:'OVERSEAS',code:'SYNTH'}]);assert.equal(Object.keys(r.prices).length,0);assert.equal(r.diagnostics['OVERSEAS:SYNTH'].code,'NH_NO_PRICE');
  }
});
test('account normalizer preserves explicit zero and missing values',()=>{
  const c=domain();c.nhCall_=()=>({http:200,body:{rsp_cd:'00000',Output_0:{tot_eal_pls:0,eal_pls_sum_amt:0},Output_1:[{iem_cd:'000001'}]}});
  const r=c.nhAccountBalance_('SYNTHETIC_ACCOUNT');assert.equal(r.domestic.summary.profit,0);assert.equal(r.domestic.summary.evalAmount,null);assert.equal(r.domestic.holdings[0].currentPrice,null);assert.equal(r.overseas.holdings[0].currency,null);
});
test('special account API support remains unverified and maps to manual/OCR',()=>{
  const c=domain(),caps=c.nhAccountCapabilitiesV2_();for(const type of ['ISA','PENSION','IRP']){assert.equal(caps[type].status,'NOT_RUN');assert.equal(caps[type].method,'OCR_OR_MANUAL')}
});
test('frontend partial merge preserves only matching session-local account keys',()=>{
  const c=vm.createContext({});const s=read('js/market.js');vm.runInContext(s.slice(s.indexOf('function mergeNhAccountResultsV2'),s.indexOf('async function loadNHAccounts')),c);
  const old=[{accountKey:'synthetic-key',domestic:{holdings:[{code:'000001',quantity:2}]},overseas:{holdings:[{code:'SYNTH',currency:'USD',quantity:3}]}}];
  const result=c.mergeNhAccountResultsV2(old,[{accountKey:'synthetic-key',domestic:{holdings:[]},overseas:null}]);
  assert.equal(result[0].overseas.holdings[0].quantity,3);assert.equal(result[0].overseas.stale,true);assert.equal(result[0].domestic.holdings.length,0);
  assert.equal(c.mergeNhAccountResultsV2(old,[{accountKey:'another-key',overseas:null}])[0].overseas,null);
});
test('partial pages retain prior omitted symbols and mark them stale',()=>{
  const c=vm.createContext({});const s=read('js/market.js');vm.runInContext(s.slice(s.indexOf('function mergeNhAccountResultsV2'),s.indexOf('async function loadNHAccounts')),c);
  const r=c.mergeNhAccountResultsV2([{accountKey:'s',domestic:{holdings:[{code:'000001',currency:'KRW',quantity:2}]}}],[{accountKey:'s',domestic:{partial:true,holdings:[{code:'000002',currency:'KRW',quantity:3}]}}]);
  assert.equal(r[0].domestic.holdings.length,2);assert.equal(r[0].domestic.stale,true);
});
