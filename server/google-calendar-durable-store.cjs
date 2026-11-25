'use strict';
// An injected, private Durable Object storage handle. No binding creation/config.
// Nonces are atomically consumed; token ciphertext never enters public files.
function durableStore(storage,{now=()=>Date.now()}={}){
 if(!storage||typeof storage.transaction!=='function')throw Error('PRIVATE_DURABLE_STORAGE_REQUIRED');
 const key=(kind,id)=>{if(typeof id!=='string'||!/^\w{64}$/.test(id))throw Error('PRIVATE_STORAGE_KEY_INVALID');return 'calendar-private:'+kind+':'+id};
 return Object.freeze({
  putPending:async(id,value,ttl)=>{if(typeof value!=='string'||!Number.isFinite(ttl)||ttl<=0||ttl>600)throw Error('PRIVATE_PENDING_INVALID');await storage.put(key('pending',id),{value,expires:now()+ttl*1000})},
  takePending:id=>storage.transaction(async tx=>{const k=key('pending',id),row=await tx.get(k);await tx.delete(k);return row&&row.expires>now()?row.value:null}),
  getAccount:id=>storage.get(key('account',id)),
  putAccount:(id,value)=>storage.put(key('account',id),value),
  deleteAccount:id=>storage.delete(key('account',id)),
  compareAccount:(id,previous,value)=>storage.transaction(async tx=>{const k=key('account',id);if(await tx.get(k)!==previous)return false;await tx.put(k,value);return true})
 });
}
module.exports={durableStore};
