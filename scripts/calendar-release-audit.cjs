'use strict';
/* Development calendar completion audit. No API/network/secret calls.
 * A passing implementation audit is NOT proof of source connectivity.
 * --strict exits nonzero until all public snapshots are present and fresh.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const reports=[
 ['BLS','data/economic-events.json','BLS',48*3600000],
 ['BEA','data/bea-events.json','BEA',72*3600000],
 ['BOK','data/bok-stats-events.json','BOK',72*3600000],
 ['EARNINGS','data/earnings-events.json','VERIFIED_EARNINGS',48*3600000],
 ['POLICY','data/policy-events.json','OFFICIAL_POLICY',72*3600000]
];
function audit({now=Date.now()}={}){
 const out=[];
 for(const [name,rel,source,ttl] of reports){
  const file=path.join(ROOT,rel);
  if(!fs.existsSync(file)){out.push({name,ok:false,code:'SNAPSHOT_MISSING',file:rel});continue}
  try{
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   const age=now-Date.parse(data.retrievedAt||'');
   if(data.source!==source||!Array.isArray(data.events)||data.events.length<1||!Number.isFinite(age)||age>ttl||age< -300000)
    throw Error('SNAPSHOT_INVALID_OR_STALE');
   if(data.events.length>800)throw Error('SNAPSHOT_OVERSIZED');
   out.push({name,ok:true,file:rel,rows:data.events.length,ageMinutes:Math.round(age/60000)});
  }catch(error){out.push({name,ok:false,file:rel,code:error.message||'SNAPSHOT_PARSE_FAILED'})}
 }
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
 const must=['js/invest-event-context.js','js/earnings-calendar.js','js/economic-calendar.js','js/economic-bea-calendar.js','js/economic-bok-stats-calendar.js'];
 const missingScripts=must.filter(src=>!html.includes('src="'+src+'?'));
 const library=[
 'tests/economic-bls-parser.test.js','tests/economic-bea-parser.test.js','tests/economic-bok-parser.test.js',
 'tests/economic-fomc.test.js','tests/earnings-calendar.test.js','tests/earnings-publisher.test.cjs',
 'tests/invest-event-context.test.cjs',
 'tests/calendar-google-auth.test.js','tests/calendar-oauth-backend.test.cjs'
 ].filter(p=>!fs.existsSync(path.join(ROOT,p)));
 return {ok:out.every(x=>x.ok)&&missingScripts.length===0&&library.length===0,
  snapshots:out,missingScripts,missingTests:library,
  note:'Implementation-only check. Real NH/auth/Google live tests and user consent remain separate.'};
}
if(require.main===module){
 const result=audit();console.log(JSON.stringify(result,null,2));
 if(process.argv.includes('--strict')&&!result.ok)process.exitCode=2;
}
module.exports={audit};
