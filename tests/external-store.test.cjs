const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');
class Sheet{
  constructor(){this.rows=[];this.failures=0}
  getLastRow(){return this.rows.length}
  getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])}}
  appendRow(row){this.rows.push([...row])}
  deleteRow(index){this.rows.splice(index-1,1)}
  getRange(row,column,count=1,width=1){const sheet=this;return {
    getValue:()=>sheet.rows[row-1]?.[column-1],setNumberFormat(){return this},
    setValues(values){if(sheet.failures){sheet.failures--;throw Error('simulated write failure')}values.forEach((values,i)=>{if(!sheet.rows[row+i-1])sheet.rows[row+i-1]=[];values.forEach((v,j)=>sheet.rows[row+i-1][column+j-1]=v)})}
  }}
}
function store(){
  const sheets=new Map();let locked=false;
  const sheet=name=>{if(!sheets.has(name))sheets.set(name,new Sheet());return sheets.get(name)};
  const ctx=vm.createContext({Date,console,getSheet:sheet,jsonResponse:x=>x,
    sessionUser_:token=>token==='alice-token'?'alice':token==='bob-token'?'bob':null,
    securityWithLock_:fn=>{assert.equal(locked,false);locked=true;try{return fn()}finally{locked=false}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],getUuid:()=>crypto.randomUUID()}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/ExternalHoldings.gs'),'utf8'),ctx);
  const read=(token='alice-token')=>ctx.handleExternalHoldingsV2(token);
  const save=(rows,options={})=>ctx.handleSaveExternalHoldingsV2(options.token||'alice-token',rows,options.revision===undefined?read(options.token).revision:options.revision,options.confirm===undefined?true:options.confirm);
  return {ctx,sheet,read,save};
}
const row=type=>({accountType:type,code:'035720',name:'카카오',quantity:101,avgPrice:20100,source:'manual'});
for(const type of ['ISA','PENSION','IRP'])test(type+' save backs up, preserves other users, and supports restore/redo',()=>{
  const s=store();assert.equal(s.save([row(type)],{token:'bob-token'}).success,true);
  assert.equal(s.save([row(type)]).success,true);
  const before=s.read();assert.equal(s.save([]).success,true);
  const history=s.ctx.handleExternalHistory('alice-token').history;
  const selected=history.find(x=>x.holdings.length===1);
  const restored=s.ctx.handleRestoreExternalHoldings('alice-token',selected.snapshotId,s.read().revision,true);
  assert.equal(restored.success,true);assert.equal(s.read().holdings.length,1);
  assert.equal(s.read().revision,before.revision);assert.equal(s.read('bob-token').holdings.length,1);
  assert.ok(s.ctx.handleExternalHistory('alice-token').history.some(x=>x.reason==='restore'&&x.holdings.length===0));
});
test('missing confirmation and stale or missing revisions cannot overwrite saved data',()=>{
  const s=store();s.save([row('ISA')]);const before=s.read();
  assert.equal(s.save([],{confirm:false}).code,'STORE_CONFIRM');
  assert.equal(s.save([],{revision:'stale'}).code,'STORE_CONFLICT');
  assert.equal(s.save([],{revision:null}).code,'STORE_CONFLICT');
  assert.equal(s.read().revision,before.revision);
});
test('duplicate symbols within one account and invalid values are rejected before deletion',()=>{
  const s=store();s.save([row('ISA')]);const before=s.read().revision;
  assert.equal(s.save([row('ISA'),row('ISA')]).code,'STORE_DUPLICATE');
  for(const change of [{name:'현금'},{quantity:null},{avgPrice:null},{code:'35720'},{name:'=IMPORTXML(x)'},{source:'+formula'},{quantity:-1}])assert.equal(s.save([{...row('ISA'),...change}]).code,'STORE_INVALID');
  assert.equal(s.read().revision,before);
  assert.equal(s.save([row('ISA'),row('IRP'),row('PENSION')]).success,true);
});
test('unauthenticated access and another users snapshot ID cannot restore private records',()=>{
  const s=store();s.save([row('ISA')]);
  const id=s.ctx.handleExternalHistory('alice-token').history[0].snapshotId;
  assert.equal(s.ctx.handleExternalHistory('bad-token').success,false);
  assert.equal(s.ctx.handleRestoreExternalHoldings('bob-token',id,s.read('bob-token').revision,true).code,'STORE_NOT_FOUND');
  assert.equal(s.read('bad-token').success,false);
});
test('write failure rolls back only the caller and keeps a recovery snapshot',()=>{
  const s=store();s.save([row('ISA')]);s.save([row('IRP')],{token:'bob-token'});const before=s.read().revision;
  s.sheet('ExternalHoldings').failures=1;
  assert.equal(s.save([{...row('ISA'),quantity:202}]).code,'STORE_WRITE_FAILED');
  assert.equal(s.read().revision,before);assert.equal(s.read('bob-token').holdings.length,1);
  assert.ok(s.ctx.handleExternalHistory('alice-token').history.length>=2);
});
test('failed rollback reports an explicit recovery action instead of claiming success',()=>{
  const s=store();s.save([row('ISA')]);s.sheet('ExternalHoldings').failures=2;
  const result=s.save([{...row('ISA'),quantity:202}]);
  assert.equal(result.code,'STORE_RECOVERY_REQUIRED');assert.ok(result.snapshotId);
  assert.equal(s.ctx.handleRestoreExternalHoldings('alice-token',result.snapshotId,s.read().revision,true).success,true);
  assert.equal(s.read().holdings[0].quantity,101);
});
test('history retention is bounded and preserves numeric leading-zero codes',()=>{
  const s=store();for(let i=0;i<8;i++)assert.equal(s.save([{...row('ISA'),quantity:101+i}]).success,true);
  assert.equal(s.ctx.handleExternalHistory('alice-token').history.length,5);
  const data=s.sheet('ExternalHoldings');data.rows[1][2]=35720;
  assert.equal(s.read().holdings[0].code,'035720');
});
test('alphanumeric KRX codes survive save, delete, and restore without digit stripping',()=>{
  const s=store();assert.equal(s.save([{...row('ISA'),name:'에스엔시스',code:'0008Z0'}]).success,true);
  assert.equal(s.read().holdings[0].code,'0008Z0');s.save([]);
  const snapshot=s.ctx.handleExternalHistory('alice-token').history.find(x=>x.holdings.length===1);
  assert.equal(s.ctx.handleRestoreExternalHoldings('alice-token',snapshot.snapshotId,s.read().revision,true).success,true);
  assert.equal(s.read().holdings[0].code,'0008Z0');
});
test('recovery preserves legacy invalid codes for review without allowing them in new saves',()=>{
  const s=store();s.read();const sheet=s.sheet('ExternalHoldings');
  sheet.appendRow(['alice','ISA','35720','현금',0,0,'saved','fixture']);
  const before=s.read();assert.equal(s.save([]).success,true);
  const snapshot=s.ctx.handleExternalHistory('alice-token').history.find(x=>x.holdings.length===1);
  assert.equal(s.ctx.handleRestoreExternalHoldings('alice-token',snapshot.snapshotId,s.read().revision,true).success,true);
  assert.equal(s.read().revision,before.revision);
  assert.equal(s.save(s.read().holdings).code,'STORE_INVALID');
});
