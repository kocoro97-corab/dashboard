'use strict';
/**
 * Reviewed public earnings announcements only. No market-data API or
 * credentials; a trusted analyst/source adapter must supply a local
 * source-provenance manifest. Do not publish a mock or estimated date.
 *
 * Run: node scripts/build-earnings-snapshot.cjs /private/verified-earnings.json
 *
 * Input example:
 * { "events": [
 *   { "eventId":"...", "market":"US", "symbol":"ABCD",
 *     "name":"Issuer", "period":"2026 Q4", "eventType":"earnings",
 *     "date":"2027-01-15", "dateStatus":"confirmed",
 *     "evidence":"issuer_announcement",
 *     "sourceUrl":"https://www.sec.gov/Archives/.../issuer-earnings.htm",
 *     "verifiedAt":"2026-11-23T00:00:00.000Z" }
 * ]}
 * Example is schema illustration, NOT a real earnings prediction.
 */
const fs=require('node:fs'),path=require('node:path');
const {normalize}=require('../js/earnings-calendar.js');
const LIMIT=500;
function build(input,{now=new Date()}={}){
 if(!input||!Array.isArray(input.events)||input.events.length<1||input.events.length>LIMIT)throw Error('EARNINGS_INPUT_EMPTY_OR_OVERSIZED');
 const at=now.toISOString(),day=now.getTime();const ids=new Set();
 const rows=input.events.map(e=>{
  if(!e||typeof e.verifiedAt!=='string'||!Number.isFinite(Date.parse(e.verifiedAt))||
     Date.parse(e.verifiedAt)>day+300000||day-Date.parse(e.verifiedAt)>48*3600000)throw Error('EARNINGS_EVIDENCE_STALE');
  if(ids.has(e.eventId))throw Error('EARNINGS_DUPLICATE_ID');
  ids.add(e.eventId);
  const {verifiedAt, ...publicFields}=e;
  return publicFields;
 });
 const out={schemaVersion:1,source:'VERIFIED_EARNINGS',retrievedAt:at,events:rows};
 const checked=normalize(out,day);
 // Reject partially invalid manifests instead of silently dropping records;
 // never publish a synthetic, source-less, or contradictory earnings calendar.
 if(checked.events.length!==rows.length)throw Error('EARNINGS_EVIDENCE_INVALID');
 return out;
}
async function main(){
 const filename=process.argv[2];
 if(!filename||filename.startsWith('-'))throw Error('EARNINGS_INPUT_FILE_REQUIRED');
 const file=path.resolve(filename);
 if(file.startsWith(path.resolve(__dirname,'..','data')+path.sep))throw Error('EARNINGS_INPUT_MUST_BE_PRIVATE_REVIEWED_FILE');
 const text=fs.readFileSync(file,'utf8');if(text.length>800000)throw Error('EARNINGS_INPUT_OVERSIZED');
 const result=build(JSON.parse(text));
 const directory=path.resolve(__dirname,'..','data');fs.mkdirSync(directory,{recursive:true});
 const dest=path.join(directory,'earnings-events.json'),tmp=dest+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(result,null,2)+'\n',{mode:0o644});fs.renameSync(tmp,dest);
 console.log('Earnings: '+result.events.length+' publicly sourced reviewed events published');
}
if(require.main===module)main().catch(error=>{console.error(error?.message||'EARNINGS_BUILD_FAILED');process.exitCode=1});
module.exports={build};
