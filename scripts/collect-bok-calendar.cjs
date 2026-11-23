'use strict';
/* Trusted CI only. Collect official BOK public statistics schedule. */
const fs=require('node:fs'),path=require('node:path');
const {SOURCE,parse}=require('../js/economic-bok-stats-parser.js');
async function collect({fetchImpl=globalThis.fetch,now=new Date()}={}){
 if(typeof fetchImpl!=='function')throw Error('BOK_FETCH_UNAVAILABLE');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
 try{
  const response=await fetchImpl(SOURCE,{method:'GET',redirect:'error',cache:'no-store',headers:{Accept:'text/html'},signal:ctrl.signal});
  if(!response?.ok)throw Error('BOK_HTTP_FAILED');
  const html=await response.text();if(html.length>2500000)throw Error('BOK_HTML_TOO_LARGE');
  const result=parse(html,{retrievedAt:now.toISOString()});
  // Sufficient source coverage. Never replace previous verified data on partial/broken HTML.
  if(result.events.length<20)throw Error('BOK_SCHEDULE_INCOMPLETE');
  return {schemaVersion:1,source:'BOK',sourceUrl:SOURCE,retrievedAt:result.retrievedAt,events:result.events};
 }finally{clearTimeout(timer)}
}
async function main(){
 const data=await collect();
 const dir=path.join(__dirname,'..','data');fs.mkdirSync(dir,{recursive:true});
 const output=path.join(dir,'bok-stats-events.json'),tmp=output+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o644});fs.renameSync(tmp,output);
 console.log('BOK official release schedule: '+data.events.length+' verified entries');
}
if(require.main===module)main().catch(e=>{console.error('BOK collector failed: '+(e?.message||'UNKNOWN'));process.exitCode=1});
module.exports={collect};
