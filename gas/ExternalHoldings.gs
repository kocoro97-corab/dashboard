// User-scoped external holdings, optimistic concurrency, and five recoverable snapshots.
const EXTERNAL_STORE_COLUMNS=['userId','accountType','code','name','quantity','avgPrice','source','updatedAt'];
const EXTERNAL_HISTORY_COLUMNS=['userId','snapshotId','createdAt','reason','revision','holdingsJson'];
function externalStoreSheet_(name,columns){
  const sheet=getSheet(name);
  if(sheet.getLastRow()===0)sheet.appendRow(columns);
  else if(JSON.stringify(sheet.getRange(1,1,1,columns.length).getValues()[0])!==JSON.stringify(columns))throw new Error('STORE_SCHEMA');
  return sheet;
}
function externalStoreNumber_(value){if(value==null||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function externalStoreRead_(user){
  const data=externalStoreSheet_('ExternalHoldings',EXTERNAL_STORE_COLUMNS).getDataRange().getValues();
  return data.slice(1).filter(row=>String(row[0])===user).map(row=>({
    accountType:String(row[1]),code:typeof row[2]==='number'&&Number.isInteger(row[2])&&row[2]>=0&&row[2]<=999999?String(row[2]).padStart(6,'0'):String(row[2]||''),
    name:String(row[3]||''),quantity:externalStoreNumber_(row[4]),avgPrice:externalStoreNumber_(row[5]),source:String(row[6]||'saved')
  }));
}
function externalStoreRevision_(rows){
  const value=JSON.stringify(rows.map(x=>[x.accountType,x.code,x.name,x.quantity,x.avgPrice,x.source]));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function externalStoreValidate_(rows,legacy){
  if(!Array.isArray(rows)||rows.length>150)throw new Error('STORE_INVALID');
  const seen=new Set();
  return rows.map(x=>{
    if(!x||!['ISA','PENSION','IRP'].includes(x.accountType)||typeof x.code!=='string'||(legacy?!/^[A-Z0-9]{0,20}$/.test(x.code):x.code&&!/^[A-Z0-9]{6}$/.test(x.code))||typeof x.name!=='string'||!x.name.trim()||x.name.length>60||/^\s*[=+@-]/.test(x.name.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,''))||!legacy&&/^(현금|신용|미수|대출)$/.test(x.name.trim()))throw new Error('STORE_INVALID');
    for(const k of ['quantity','avgPrice'])if(!(legacy&&x[k]===null)&&(typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<0))throw new Error('STORE_INVALID');
    const source=String(x.source||'manual');if(source.length>20||/^\s*[=+@-]/.test(source))throw new Error('STORE_INVALID');
    const key=x.accountType+'|'+(x.code||x.name.normalize('NFKC').replace(/\s/g,'').toUpperCase());
    if(seen.has(key)&&!legacy)throw new Error('STORE_DUPLICATE');seen.add(key);
    return {accountType:x.accountType,code:x.code,name:x.name.trim(),quantity:x.quantity,avgPrice:x.avgPrice,source:source};
  });
}
// Legacy rows are read only. New writes go exclusively to the V2 journal.
let ACCOUNT_STORE_V2_INSTANCE;
function accountStoreV2_(){
  if(!ACCOUNT_STORE_V2_INSTANCE)ACCOUNT_STORE_V2_INSTANCE=createAccountStoreV2_({
    sheet:externalStoreSheet_,legacy:externalStoreRead_,validate:externalStoreValidate_,
    hash:text=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text).map(b=>('0'+(b&255).toString(16)).slice(-2)).join(''),
    uuid:()=>Utilities.getUuid(),now:()=>new Date().toISOString(),lock:securityWithLock_,
    flush:()=>{if(typeof SpreadsheetApp!=='undefined')SpreadsheetApp.flush()}
  });
  return ACCOUNT_STORE_V2_INSTANCE;
}
function externalStoreError_(error){
  const messages={STORE_RECOVERY_REQUIRED:'저장 상태를 확인할 수 없습니다. 복구 기록을 확인하세요.',STORE_WRITE_FAILED:'저장 실패. 기존 자료가 유지됩니다.',STORE_CONFLICT:'다른 화면에서 자료가 변경됐습니다. 다시 불러온 뒤 비교하세요.',STORE_CONFIRM:'기존 자료 교체 확인이 필요합니다.',STORE_INVALID:'종목 입력값이 올바르지 않습니다.',STORE_DUPLICATE:'같은 계좌에 중복 종목이 있습니다.',STORE_NOT_FOUND:'복구할 내역이 없거나 접근할 수 없습니다.',STORE_SCHEMA:'저장소 형식 확인이 필요합니다.',STORE_SNAPSHOT_TOO_LARGE:'복구용 자료가 너무 큽니다.'};
  const raw=String(error&&error.message||''),code=Object.prototype.hasOwnProperty.call(messages,raw)?raw:'STORE_WRITE_FAILED';
  return jsonResponse({success:false,code:code,layer:'storage',message:messages[code]||'저장 실패. 기존 자료와 복구 기록을 확인하세요.'});
}
function handleExternalHoldingsV2(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{const result=accountStoreV2_().read(user);return jsonResponse({success:true,holdings:result.holdings,revision:result.revision,storeVersion:2,storeEngine:'account-store-v2'})}catch(error){return externalStoreError_(error)}
}
function handleExternalHistory(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{return jsonResponse({success:true,history:accountStoreV2_().read(user).history})}catch(error){return externalStoreError_(error)}
}
function handleSaveExternalHoldingsV2(token,rows,expectedRevision,confirmReplace){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');return jsonResponse(accountStoreV2_().commit(user,externalStoreValidate_(rows,false),expectedRevision,confirmReplace,'replace'))}catch(error){return externalStoreError_(error)}
}
function handleRestoreExternalHoldings(token,snapshotId,expectedRevision,confirmReplace){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');return jsonResponse(accountStoreV2_().restore(user,snapshotId,expectedRevision,confirmReplace))}catch(error){return externalStoreError_(error)}
}
