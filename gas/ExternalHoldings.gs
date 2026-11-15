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
  const value=JSON.stringify(rows.map(x=>{const value=[x.accountType,x.code,x.name,x.quantity,x.avgPrice,x.source];if(x.accountId)value.push(x.accountId);return value}));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function externalStoreValidate_(rows,legacy){
  if(!Array.isArray(rows)||rows.length>150)throw new Error('STORE_INVALID');
  const seen=new Set();
  return rows.map(x=>{
    if(!x||!['ISA','PENSION','IRP','GENERAL'].includes(x.accountType)||typeof x.code!=='string'||(legacy?!/^[A-Z0-9]{0,20}$/.test(x.code):x.code&&!/^[A-Z0-9]{6}$/.test(x.code))||typeof x.name!=='string'||!x.name.trim()||x.name.length>60||/^\s*[=+@-]/.test(x.name.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,''))||!legacy&&/^(현금|신용|미수|대출)$/.test(x.name.trim()))throw new Error('STORE_INVALID');
    for(const k of ['quantity','avgPrice'])if(!(legacy&&x[k]===null)&&(typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<0))throw new Error('STORE_INVALID');
    const source=String(x.source||'manual');if(source.length>20||/^\s*[=+@-]/.test(source))throw new Error('STORE_INVALID');
    if(x.accountId!==undefined&&(!/^(?:legacy-(?:ISA|PENSION|IRP|GENERAL)|ext-[A-Za-z0-9-]{8,48})$/.test(x.accountId)||x.accountId.startsWith('legacy-')&&x.accountId!=='legacy-'+x.accountType))throw new Error('STORE_INVALID');
    const key=(x.accountId&&!x.accountId.startsWith('legacy-')?x.accountId:x.accountType)+'|'+(x.code||x.name.normalize('NFKC').replace(/\s/g,'').toUpperCase());
    if(seen.has(key)&&!legacy)throw new Error('STORE_DUPLICATE');seen.add(key);
    const row={accountType:x.accountType,code:x.code,name:x.name.trim(),quantity:x.quantity,avgPrice:x.avgPrice,source:source};if(x.accountId)row.accountId=x.accountId;return row;
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
  const messages={STORE_CLIENT_UPGRADE_REQUIRED:'계좌별 저장을 지원하는 최신 화면으로 새로고침하세요.',STORE_ACCOUNT_IN_USE:'보유종목이 있는 계좌는 종목을 먼저 이동하거나 검토 후 정리하세요.',STORE_CATALOG_LIMIT:'계좌 목록 저장 용량을 초과했습니다.',STORE_RECOVERY_REQUIRED:'저장 상태를 확인할 수 없습니다. 복구 기록을 확인하세요.',STORE_WRITE_FAILED:'저장 실패. 기존 자료가 유지됩니다.',STORE_CONFLICT:'다른 화면에서 자료가 변경됐습니다. 다시 불러온 뒤 비교하세요.',STORE_CONFIRM:'기존 자료 교체 확인이 필요합니다.',STORE_INVALID:'종목 입력값이 올바르지 않습니다.',STORE_DUPLICATE:'같은 계좌에 중복 종목이 있습니다.',STORE_NOT_FOUND:'복구할 내역이 없거나 접근할 수 없습니다.',STORE_SCHEMA:'저장소 형식 확인이 필요합니다.',STORE_SNAPSHOT_TOO_LARGE:'복구용 자료가 너무 큽니다.'};
  const raw=String(error&&error.message||''),code=Object.prototype.hasOwnProperty.call(messages,raw)?raw:'STORE_WRITE_FAILED';
  return jsonResponse({success:false,code:code,layer:'storage',message:messages[code]||'저장 실패. 기존 자료와 복구 기록을 확인하세요.'});
}
function handleExternalHoldingsV2(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{const result=accountStoreV2_().read(user);return jsonResponse({success:true,holdings:result.holdings,revision:result.revision,storeVersion:2,storeEngine:'account-store-v2',externalAccountCatalogVersion:1,updatedAt:result.history[0]&&result.history[0].createdAt||null})}catch(error){return externalStoreError_(error)}
}
function handleExternalHistory(token){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{return jsonResponse({success:true,history:accountStoreV2_().read(user).history})}catch(error){return externalStoreError_(error)}
}
function handleSaveExternalHoldingsV2(token,rows,expectedRevision,confirmReplace,clientVersion){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{
    if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');const validated=externalStoreValidate_(rows,false);
    return jsonResponse(accountStoreV2_().commit(user,validated,expectedRevision,confirmReplace,'replace',current=>{
      if(clientVersion!==1&&(validated.some(x=>x.accountId)||current.some(x=>x.accountId)))throw Error('STORE_CLIENT_UPGRADE_REQUIRED');
      const identified=validated.filter(x=>x.accountId&&!x.accountId.startsWith('legacy-'));
      if(identified.length){const catalog=externalAccountCatalog_().inspectUnderLock(user);for(const row of identified){const account=catalog.accounts.find(x=>x.id===row.accountId);if(!account||account.accountType!==row.accountType)throw Error('STORE_ACCOUNT_IN_USE')}}
    }));
  }catch(error){return externalStoreError_(error)}
}
function handleRestoreExternalHoldings(token,snapshotId,expectedRevision,confirmReplace){
  const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED',message:'다시 로그인하세요.'});
  try{if(/^\s*[=+@-]/.test(user))throw new Error('STORE_INVALID');return jsonResponse(accountStoreV2_().restore(user,snapshotId,expectedRevision,confirmReplace))}catch(error){return externalStoreError_(error)}
}

// Additive per-user metadata. No existing Sheet column or holding is migrated.
function createExternalAccountCatalog_(io){
  const types=['ISA','PENSION','IRP','GENERAL'];
  function text(value,max){if(typeof value!=='string')throw Error('STORE_INVALID');const normalized=value.normalize('NFKC').trim();if(!normalized||normalized.length>max||/^[=+@-]/.test(normalized)||/[\x00-\x1f]/.test(normalized)||/\d{10,}/.test(normalized))throw Error('STORE_INVALID');return normalized}
  function id(value){if(typeof value!=='string'||!/^(?:legacy-(?:ISA|PENSION|IRP|GENERAL)|ext-[A-Za-z0-9-]{8,48})$/.test(value))throw Error('STORE_INVALID');return value}
  const key=user=>'EXT_ACCOUNT_CATALOG_V1_'+io.hash(user);
  function state(user){
    const raw=io.properties.getProperty(key(user));let saved={version:1,accounts:[],brokers:[]};
    if(raw){try{saved=JSON.parse(raw)}catch{throw Error('STORE_SCHEMA')}}
    if(saved.version!==1||!Array.isArray(saved.accounts)||!Array.isArray(saved.brokers))throw Error('STORE_SCHEMA');
    const holdings=io.holdings(user),active=new Map(saved.accounts.filter(x=>!x.archived).map(x=>[x.id,{...x}]));
    for(const row of holdings){const accountId=row.accountId||'legacy-'+row.accountType;if(active.has(accountId))continue;
      const old=saved.accounts.find(x=>x.id===accountId);
      active.set(accountId,old?{...old,archived:false,recovered:true}:{id:accountId,broker:'',accountName:({ISA:'기존 ISA',PENSION:'기존 연금저축',IRP:'기존 IRP',GENERAL:'기존 일반계좌'})[row.accountType]||'복구 계좌',accountType:row.accountType,updatedAt:null,recovered:true});
    }
    return {saved,holdings,accounts:[...active.values()],brokers:[...new Set([...saved.brokers,...[...active.values()].map(x=>x.broker).filter(Boolean)])],revision:io.hash(user+'|'+(raw||'')),catalogVersion:1};
  }
  function read(user){return io.lock(()=>{const s=state(user);return {accounts:s.accounts,brokers:s.brokers,revision:s.revision,catalogVersion:1}})}
  function save(user,accounts,brokers,revision,confirm){return io.lock(()=>{
    const before=state(user);if(confirm!==true)throw Error('STORE_CONFIRM');if(revision!==before.revision)throw Error('STORE_CONFLICT');
    if(!Array.isArray(accounts)||accounts.length>30||!Array.isArray(brokers)||brokers.length>30)throw Error('STORE_INVALID');
    const names=brokers.map(x=>text(x,30));if(new Set(names.map(x=>x.toLocaleLowerCase())).size!==names.length)throw Error('STORE_DUPLICATE');
    const seen=new Set(),next=accounts.map(x=>{
      if(!x||typeof x!=='object')throw Error('STORE_INVALID');const accountId=id(x.id);
      if(seen.has(accountId)||!types.includes(x.accountType))throw Error('STORE_DUPLICATE');seen.add(accountId);
      if(accountId.startsWith('legacy-')&&accountId!=='legacy-'+x.accountType)throw Error('STORE_INVALID');
      const old=before.accounts.find(a=>a.id===accountId)||before.saved.accounts.find(a=>a.id===accountId),broker=x.broker===''&&accountId.startsWith('legacy-')?'':text(x.broker,30),name=text(x.accountName,60);
      if(old&&old.accountType!==x.accountType)throw Error('STORE_ACCOUNT_IN_USE');
      if(broker&&!names.includes(broker))throw Error('STORE_INVALID');
      const changed=!old||old.broker!==broker||old.accountName!==name||old.accountType!==x.accountType;
      return {id:accountId,broker,accountName:name,accountType:x.accountType,updatedAt:changed?io.now():old.updatedAt,archived:false};
    });
    for(const row of before.holdings){const accountId=row.accountId||'legacy-'+row.accountType,after=next.find(x=>x.id===accountId);if(!after||after.accountType!==row.accountType)throw Error('STORE_ACCOUNT_IN_USE')}
    const archived=before.saved.accounts.filter(x=>!seen.has(x.id)).map(x=>({...x,archived:true}));
    if(new Set(next.map(x=>x.broker.toLocaleLowerCase()+'|'+x.accountName.toLocaleLowerCase())).size!==next.length)throw Error('STORE_DUPLICATE');
    const value=JSON.stringify({version:1,accounts:[...next,...archived],brokers:names});
    if(encodeURIComponent(value).replace(/%[A-Fa-f0-9]{2}/g,'x').length>8000)throw Error('STORE_CATALOG_LIMIT');
    io.properties.setProperty(key(user),value);
    if(io.properties.getProperty(key(user))!==value)throw Error('STORE_WRITE_FAILED');
    return {success:true,accounts:next,brokers:names,revision:io.hash(user+'|'+value),catalogVersion:1};
  })}
  return {read,save,inspectUnderLock:state};
}
function externalAccountCatalog_(){return createExternalAccountCatalog_({properties:PropertiesService.getScriptProperties(),hash:value=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(b=>('0'+(b&255).toString(16)).slice(-2)).join(''),holdings:user=>accountStoreV2_().inspectUnderLock(user).holdings,lock:securityWithLock_,now:()=>new Date().toISOString()})}
function handleExternalAccountCatalog_(token){const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED'});try{return jsonResponse({success:true,...externalAccountCatalog_().read(user)})}catch(error){return externalStoreError_(error)}}
function handleSaveExternalAccountCatalog_(token,accounts,brokers,revision,confirm){const user=sessionUser_(token);if(!user)return jsonResponse({success:false,code:'AUTH_REQUIRED'});try{return jsonResponse(externalAccountCatalog_().save(user,accounts,brokers,revision,confirm))}catch(error){return externalStoreError_(error)}}
