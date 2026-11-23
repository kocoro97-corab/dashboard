'use strict';
// Development public data only; no scheduler activation or credentials.
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('./validate-calendar-snapshots.cjs');
const SOURCES=[['BLS','economic-events.json','collect-economic-calendar.cjs'],['BEA','bea-events.json','collect-bea-calendar.cjs'],['BOK','bok-stats-events.json','collect-bok-calendar.cjs'],['EARNINGS','earnings-events.json','collect-earnings-official.cjs'],['POLICY','policy-events.json','collect-policy-calendar.cjs']];
async function refresh({directory=path.resolve(__dirname,'../data'),collectors={},now=new Date()}={}){
 fs.mkdirSync(directory,{recursive:true});
 return Promise.all(SOURCES.map(async([source,file,module])=>{
  const dest=path.join(directory,file);
  try{const data=await (collectors[source]||require('./'+module).collect)({now});const result=validate(data,now.getTime());const temporary=dest+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n');fs.renameSync(temporary,dest);return {source,status:'PASS',...result}}
  catch(error){const m=/^BLS_HTTP_FAILED_([45][0-9]{2})$/.exec(error?.message||'');return {source,status:'FAIL',previousSnapshotPreserved:fs.existsSync(dest),...(m?{http:Number(m[1])}:{})}}
 }));
}
if(require.main===module)refresh().then(rows=>{console.log(JSON.stringify({mode:'DEVELOPMENT_PUBLIC_CALENDAR_REFRESH',rows,scheduled:false,nhCalls:0,accountCalls:0,orderCalls:0}));if(rows.some(r=>r.status!=='PASS'))process.exitCode=1});
module.exports={refresh};
