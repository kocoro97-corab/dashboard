'use strict';
/* Server / CI only; no secrets. Writes a verified BEA snapshot atomically.
 * Do not update an existing snapshot when source is invalid or unavailable.
 */
const fs=require('node:fs'),path=require('node:path');
const {SOURCE,parse}=require('../js/economic-bea-parser.js');
async function collect({fetchImpl=globalThis.fetch,now=new Date()}={}){
 if(typeof fetchImpl!=='function')throw Error('BEA_FETCH_UNAVAILABLE');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await fetchImpl(SOURCE,{signal:controller.signal,redirect:'error',cache:'no-store',headers:{Accept:'application/json'}});
  if(!r?.ok)throw Error('BEA_HTTP_FAILED');
  const body=await r.text();if(body.length>700000)throw Error('BEA_TOO_LARGE');
  const input=JSON.parse(body),parsed=parse(input,{retrievedAt:now.toISOString()});
  return {schemaVersion:1,source:'BEA',sourceUrl:SOURCE,retrievedAt:parsed.retrievedAt,events:parsed.events};
 }finally{clearTimeout(timeout)}
}
async function main(){
 const data=await collect();
 const dir=path.join(__dirname,'..','data');fs.mkdirSync(dir,{recursive:true});
 const out=path.join(dir,'bea-events.json'),temp=out+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o644});fs.renameSync(temp,out);
 console.log('BEA official calendar snapshot: '+data.events.length+' events');
}
if(require.main===module)main().catch(e=>{console.error('BEA collector failed: '+(e?.message||'UNKNOWN'));process.exitCode=1});
module.exports={collect};
