'use strict';
/* Offline publisher for the public BLS release calendar.
   Run in CI or trusted backend; never run on clients with private account data.
   No output is published if network, source format or timestamp validation fails. */
const fs=require('node:fs'),path=require('node:path');
const {parse,SOURCE}=require('../js/economic-bls-parser.js');
async function collect({fetchImpl=globalThis.fetch,now=new Date()}={}){
 if(typeof fetchImpl!=='function')throw Error('FETCH_UNAVAILABLE');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const res=await fetchImpl(SOURCE,{signal:controller.signal,redirect:'error',headers:{Accept:'text/calendar'},cache:'no-store'});
  if(!res?.ok)throw Error('BLS_HTTP_FAILED');
  const data=await res.text();if(data.length>1500000)throw Error('BLS_TOO_LARGE');
  const parsed=parse(data,{retrievedAt:now.toISOString()});
  if(parsed.events.length<1)throw Error('BLS_NO_VERIFIED_EVENTS');
  // Do not use an empty or malformed calendar to erase previous verified data.
  return {schemaVersion:1,source:'BLS',sourceUrl:SOURCE,retrievedAt:parsed.retrievedAt,events:parsed.events};
 }finally{clearTimeout(timer)}
}
async function main(){
 const data=await collect();
 const dir=path.join(__dirname,'..','data'),out=path.join(dir,'economic-events.json');
 fs.mkdirSync(dir,{recursive:true});
 const tmp=out+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o644});fs.renameSync(tmp,out);
 console.log('BLS calendar snapshot generated: '+data.events.length+' verified events');
}
if(require.main===module)main().catch(e=>{console.error('BLS collection failed: '+(e?.message||'UNKNOWN'));process.exitCode=1});
module.exports={collect};
