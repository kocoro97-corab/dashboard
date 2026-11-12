// User-scoped external holdings, optimistic concurrency, and five recoverable snapshots.
const EXTERNAL_STORE_COLUMNS=['userId','accountType','code','name','quantity','avgPrice','source','updatedAt'];
const EXTERNAL_HISTORY_COLUMNS=['userId','snapshotId','createdAt','reason','revision','holdingsJson'];
function externalStoreSheet_(name,columns){
  const sheet=getSheet(name);
  if(sheet.getLastRow()===0)sheet.appendRow(columns);
  else if(String(sheet.getRange(1,1).getValue())!=='userId')throw new Error('STORE_SCHEMA');
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
function externalStoreReplace_(user,rows){
  const sheet=externalStoreSheet_('ExternalHoldings',EXTERNAL_STORE_COLUMNS),data=sheet.getDataRange().getValues();
  for(let i=data.length-1;i>=1;i--)if(String(data[i][0])===user)sheet.deleteRow(i+1);
  if(rows.length){
    const values=rows.map(x=>[user,x.accountType,x.code,x.name,x.quantity==null?'':x.quantity,x.avgPrice==null?'':x.avgPrice,x.source,new Date().toISOString()]);
    const start=sheet.getLastRow()+1;
    for(const column of [1,2,3,4,7,8])sheet.getRange(start,column,rows.length,1).setNumberFormat('@');
    sheet.getRange(start,1,rows.length,8).setValues(values);
  }
}
function externalStoreBackup_(user,rows,reason){
  const text=JSON.stringify(rows);if(text.length>45000)throw new Error('STORE_SNAPSHOT_TOO_LARGE');
  const sheet=externalStoreSheet_('ExternalHoldingHistory',EXTERNAL_HISTORY_COLUMNS),id=Utilities.getUuid();
  sheet.appendRow([user,id,new Date().toISOString(),reason,externalStoreRevision_(rows),text]);return id;
}
function externalStoreTrim_(user){
  const sheet=externalStoreSheet_('ExternalHoldingHistory',EXTERNAL_HISTORY_COLUMNS),data=sheet.getDataRange().getValues();
  const own=[];for(let i=1;i<data.length;i++)if(String(data[i][0])===user)own.push(i+1);
  own.slice(0,Math.max(0,own.length-5)).reverse().forEach(index=>sheet.deleteRow(index));
}
function externalStoreError_(error){
  const messages={STORE_CONFLICT:'다른 화면에서 자료가 변경됐습니다. 다시 불러온 뒤 비교하세요.',STORE_CONFIRM:'기존 자료 교체 확인이 필요합니다.',STORE_INVALID:'종목 입력값이 올바르지 않습니다.',STORE_DUPLICATE:'같은 계좌에 중복 종목이 있습니다.',STORE_NOT_FOUND:'복구할 내역이 없거나 접근할 수 없습니다.',STORE_SCHEMA:'저장소 형식 확인이 필요합니다.',STORE_SNAPSHOT_TOO_LARGE:'복구용 자료가 너무 큽니다.'};
  const raw=String(error&&error.message||''),code=Object.prototype.hasOwnProperty.call(messages,raw)?raw:'STORE_WRITE_FAILED';
  return jsonResponse({success:false,code:code,layer:'storage',message:messages[code]||'저장 실패. 기존 자료와 복구 기록을 확인하세요.'});
}
function handleExternalHoldingsV2(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{return securityWithLock_(function(){const rows=externalStoreRead_(user);return jsonResponse({success:true,holdings:rows,revision:externalStoreRevision_(rows),storeVersion:2})})}catch(error){return externalStoreError_(error)}
}
function handleExternalHistory(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{
    const data=externalStoreSheet_('ExternalHoldingHistory',EXTERNAL_HISTORY_COLUMNS).getDataRange().getValues();
    const history=data.slice(1).filter(row=>String(row[0])===user).slice(-5).reverse().map(row=>({snapshotId:String(row[1]),createdAt:String(row[2]),reason:String(row[3]),holdings:JSON.parse(String(row[5]))}));
    return jsonResponse({success:true,history:history});
  }catch(error){return externalStoreError_(error)}
}
function externalStoreCommit_(user,rows,expectedRevision,confirmReplace,reason){
  return securityWithLock_(function(){
    const before=externalStoreRead_(user);
    if(typeof expectedRevision!=='string'||expectedRevision!==externalStoreRevision_(before))throw new Error('STORE_CONFLICT');
    if(confirmReplace!==true)throw new Error('STORE_CONFIRM');
    const snapshotId=externalStoreBackup_(user,before,reason);
    try{externalStoreReplace_(user,rows)}catch(error){
      try{externalStoreReplace_(user,before)}catch(restoreError){return jsonResponse({success:false,code:'STORE_RECOVERY_REQUIRED',layer:'storage',snapshotId:snapshotId,message:'저장과 자동 복구에 실패했습니다. 복구 기록으로 복원하세요.'})}
      throw new Error('STORE_WRITE_FAILED');
    }
    try{externalStoreTrim_(user)}catch(error){/* Keep recovery records if trimming fails. */}
    return jsonResponse({success:true,count:rows.length,revision:externalStoreRevision_(rows),snapshotId:snapshotId,storeVersion:2});
  });
}
function handleSaveExternalHoldingsV2(token,rows,expectedRevision,confirmReplace){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');return externalStoreCommit_(user,externalStoreValidate_(rows,false),expectedRevision,confirmReplace,'replace')}catch(error){return externalStoreError_(error)}
}
function handleRestoreExternalHoldings(token,snapshotId,expectedRevision,confirmReplace){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{
    const data=externalStoreSheet_('ExternalHoldingHistory',EXTERNAL_HISTORY_COLUMNS).getDataRange().getValues();
    const row=data.slice(1).find(x=>String(x[0])===user&&String(x[1])===snapshotId);
    if(!row)throw new Error('STORE_NOT_FOUND');
    if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');
    return externalStoreCommit_(user,externalStoreValidate_(JSON.parse(String(row[5])),true),expectedRevision,confirmReplace,'restore');
  }catch(error){return externalStoreError_(error)}
}
