// Fresh-development-only NH snapshot persistence. Never enabled in existing/production projects.
const NH_SNAPSHOT_OLD_SCRIPT='1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw';
const NH_SNAPSHOT_OLD_SHEET='1oQA2wD_0jtGVOezLclzUyejsYA2Z-3X_kkD7-by0tsY';
function nhSnapshotGuardV2_(token){
  if(!sessionUser_(token)||!verifyAdmin(token))throw Error('AUTH_REQUIRED');
  if(typeof stagingProjectGuard_!=='function'||typeof stagingSheet_!=='function')throw Error('NH_STORE_DEV_ONLY');
  stagingProjectGuard_();const p=PropertiesService.getScriptProperties();
  if(ScriptApp.getScriptId()===NH_SNAPSHOT_OLD_SCRIPT||p.getProperty('APP_ENV')!=='nh-staging'||p.getProperty('NH_V2_FRESH_TEST')!=='true'||p.getProperty('STAGING_SHEET_ID')===NH_SNAPSHOT_OLD_SHEET)throw Error('NH_STORE_DEV_ONLY');
  stagingSheet_();
}
function nhSnapshotValidateV2_(accounts){
  if(!Array.isArray(accounts)||accounts.length>20)throw Error('NH_SNAPSHOT_INVALID');
  const keys=new Set();let count=0;
  const numeric=v=>{if(v===null||typeof v==='number'&&Number.isFinite(v))return v;throw Error('NH_SNAPSHOT_INVALID')};
  const text=(v,max)=>{if(typeof v==='string'&&v.length<=max)return v;throw Error('NH_SNAPSHOT_INVALID')};
  return accounts.map(a=>{
    if(!a||!/^[a-f0-9]{64}$/.test(a.accountKey)||!['01','02'].includes(a.acctType)||keys.has(a.accountKey))throw Error('NH_SNAPSHOT_INVALID');keys.add(a.accountKey);
    const row={accountKey:a.accountKey,acctType:a.acctType};
    for(const market of ['domestic','overseas']){
      const part=a[market];if(part===null){row[market]=null;continue}
      if(!part||part.partial||!Array.isArray(part.holdings)||!part.summary)throw Error('NH_SNAPSHOT_INVALID');
      const summary={};for(const k of ['deposit','netAsset','totalAsset','buyAmount','evalAmount','profit','returnRate'])if(Object.prototype.hasOwnProperty.call(part.summary,k))summary[k]=numeric(part.summary[k]);
      const holdings=part.holdings.map(h=>{
        if(++count>1000)throw Error('NH_SNAPSHOT_INVALID');
        const holding={name:text(h.name,120),code:text(h.code,30),country:text(h.country||'',80)};
        for(const k of ['quantity','avgPrice','currentPrice','evalAmount','profit','returnRate'])holding[k]=numeric(h[k]);
        if(h.currency!==null&&!/^[A-Z]{3}$/.test(h.currency))throw Error('NH_SNAPSHOT_INVALID');holding.currency=h.currency;return holding;
      });
      row[market]={summary:summary,partial:false,holdings:holdings};
    }
    if(!Array.isArray(a.errors)||a.errors.length)throw Error('NH_SNAPSHOT_INVALID');row.errors=[];return row;
  });
}
function nhSnapshotStoreV2_(token){
  nhSnapshotGuardV2_(token);
  return createAccountStoreV2_({
    sheet:(_name,columns)=>{nhSnapshotGuardV2_(token);return externalStoreSheet_('NhReadSnapshotsV2',columns)},
    legacy:()=>[],validate:nhSnapshotValidateV2_,
    hash:text=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text).map(b=>('0'+(b&255).toString(16)).slice(-2)).join(''),
    uuid:()=>Utilities.getUuid(),now:()=>new Date().toISOString(),lock:securityWithLock_,flush:()=>SpreadsheetApp.flush()
  });
}
function nhSnapshotErrorV2_(e){
  const allowed=['AUTH_REQUIRED','NH_STORE_DEV_ONLY','NH_SNAPSHOT_INVALID','STORE_CONFLICT','STORE_CONFIRM','STORE_SCHEMA','STORE_SNAPSHOT_TOO_LARGE','STORE_WRITE_FAILED','STORE_RECOVERY_REQUIRED','STORE_NOT_FOUND'];
  return jsonResponse({success:false,code:allowed.includes(e&&e.message)?e.message:'NH_UPSTREAM'});
}
function handleNhSnapshotV2_(token,action,body){
  try{
    const store=nhSnapshotStoreV2_(token),user=sessionUser_(token);
    if(action==='nhSnapshotRead'){const state=store.read(user);return jsonResponse({success:true,accounts:state.holdings,revision:state.revision,history:state.history,storeEngine:'account-store-v2'})}
    if(action==='nhSnapshotRestore')return jsonResponse(store.restore(user,body.snapshotId,body.expectedRevision,body.confirmReplace));
    if(action!=='nhSnapshotCapture')throw Error('NH_SNAPSHOT_INVALID');
    const before=store.read(user);
    if(body.expectedRevision!==before.revision)throw Error('STORE_CONFLICT');
    if(body.confirmReplace!==true)throw Error('STORE_CONFIRM');
    const output=handleNhAccounts(token),result=typeof output.getContent==='function'?JSON.parse(output.getContent()):output;
    if(!result||!result.success||!Array.isArray(result.accounts)||!result.accounts.length)return jsonResponse({success:false,code:'NH_UPSTREAM'});
    // Never replace a good snapshot with a partial/failed inquiry.
    const complete=result.accounts.every(a=>!a.errors.length&&['domestic','overseas'].every(k=>a[k]&&!a[k].partial));
    if(!complete)return jsonResponse({success:false,code:'NH_INCOMPLETE'});
    const accounts=nhSnapshotValidateV2_(result.accounts);
    const saved=store.commit(user,accounts,body.expectedRevision,body.confirmReplace,'nh-read-snapshot');
    return jsonResponse(Object.assign({},saved,{accounts:accounts}));
  }catch(e){return nhSnapshotErrorV2_(e)}
}
