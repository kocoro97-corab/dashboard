// Account Store V2: append-only prepare/commit journal, user isolation, no destructive rollback.
function createAccountStoreV2_(io) {
  const columns=['userId','commitId','phase','parentRevision','createdAt','reason','beforeJson','afterJson','checksum'];
  const initial=rows=>'legacy:'+io.hash(JSON.stringify(rows));
  function sheet(){return io.sheet('AccountStoreV2',columns)}
  function checksum(r){return io.hash(JSON.stringify([r[0],r[1],r[3],r[4],r[5],r[6],r[7]]))}
  function state(user){
    const legacy=io.legacy(user);let rows=legacy,revision=initial(legacy);const history=[],prepared=new Map();
    const records=sheet().getDataRange().getValues().slice(1).filter(r=>String(r[0])===user);
    for(const r of records){
      if(r[2]==='PREPARE'){
        if(!r[1])throw Error('STORE_SCHEMA');
        // A prepare row alone never replaces the last committed state.
        prepared.set(String(r[1]),r);continue;
      }
      if(r[2]!=='COMMIT')throw Error('STORE_SCHEMA');
      const p=prepared.get(String(r[1]));
      if(!p||String(p[3])!==revision||String(p[8])!==checksum(p)||String(r[8])!==String(p[8]))throw Error('STORE_SCHEMA');
      let before,next;try{before=JSON.parse(p[6]);next=JSON.parse(p[7])}catch(e){throw Error('STORE_SCHEMA')}
      if(JSON.stringify(before)!==JSON.stringify(rows))throw Error('STORE_SCHEMA');
      rows=io.validate(next,true);revision='v2:'+String(p[1]);
      history.push({snapshotId:String(p[1]),createdAt:String(p[4]),reason:String(p[5]),holdings:before});
      prepared.delete(String(p[1]));
    }
    return {holdings:rows,revision:revision,history:history.slice(-5).reverse()};
  }
  function append(values){const s=sheet(),start=s.getLastRow()+1;s.getRange(start,1,1,columns.length).setNumberFormat('@');s.getRange(start,1,1,columns.length).setValues([values]);io.flush()}
  function commit(user,rows,expectedRevision,confirmReplace,reason){
    return io.lock(function(){
      const before=state(user);
      if(typeof expectedRevision!=='string'||expectedRevision!==before.revision)throw Error('STORE_CONFLICT');
      if(confirmReplace!==true)throw Error('STORE_CONFIRM');
      const old=JSON.stringify(before.holdings),next=JSON.stringify(rows);
      if(old.length>45000||next.length>45000)throw Error('STORE_SNAPSHOT_TOO_LARGE');
      const id=io.uuid(),p=[user,id,'PREPARE',before.revision,io.now(),reason,old,next,''];p[8]=checksum(p);
      try{
        append(p);
        // Verify durable prepare before making it visible.
        const check=sheet().getDataRange().getValues().find(r=>String(r[0])===user&&r[1]===id&&r[2]==='PREPARE');
        if(!check||checksum(check)!==p[8]||check[8]!==p[8])throw Error('STORE_WRITE_FAILED');
        append([user,id,'COMMIT',before.revision,p[4],reason,'','',p[8]]);
      }catch(error){
        // A transport can fail after the commit was persisted. Resolve that ambiguity by readback.
        let current;try{current=state(user)}catch(e){throw Error('STORE_RECOVERY_REQUIRED')}
        if(current.revision!=='v2:'+id)throw Error('STORE_WRITE_FAILED');
      }
      const saved=state(user);if(saved.revision!=='v2:'+id)throw Error('STORE_RECOVERY_REQUIRED');
      return {success:true,count:rows.length,revision:saved.revision,snapshotId:id,storeVersion:2,storeEngine:'account-store-v2'};
    });
  }
  function restore(user,id,expectedRevision,confirmReplace){
    // The commit's revision check detects intervening writes after this read.
    const snapshot=io.lock(()=>state(user).history.find(x=>x.snapshotId===id));
    if(!snapshot)throw Error('STORE_NOT_FOUND');
    return commit(user,io.validate(snapshot.holdings,true),expectedRevision,confirmReplace,'restore');
  }
  return {read:user=>io.lock(()=>state(user)),commit:commit,restore:restore};
}
