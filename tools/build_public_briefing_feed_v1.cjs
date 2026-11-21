'use strict';
/* MY INVEST V2 — local, explicit public briefing feed builder.
 * This utility NEVER publishes or sends files. It converts a user-reviewed,
 * public-market-only backup JSON into the static, read-only feed file shape.
 */
const fs=require('node:fs');
const path=require('node:path');
const transfer=require('../js/news-briefing-transfer-v1.js');
const MAX_BYTES=3000000;
const fail=code=>({ok:false,code});
function convert(backupText,{now}={}){
 if(typeof backupText!=='string'||Buffer.byteLength(backupText,'utf8')>MAX_BYTES)
  return fail('INPUT_TOO_LARGE');
 const checked=transfer.parseJSON(backupText,{now});
 if(!checked.ok)return fail('PUBLIC_BACKUP_'+checked.code);
 if(!checked.records.length)return fail('NO_PUBLIC_BRIEFINGS');
 const document={type:'public-briefing-feed-v1',schemaVersion:1,records:checked.records};
 const json=JSON.stringify(document,null,2);
 if(Buffer.byteLength(json,'utf8')>MAX_BYTES)return fail('PUBLIC_FEED_TOO_LARGE');
 return {ok:true,json,count:checked.records.length,
  originAuthenticated:false,marketDataVerified:false,
  scheduledDeliveryConfirmed:false,autoPublished:false};
}
function cli(){
 const args=process.argv.slice(2);
 if(args.length!==5||args[0]!=='--source'||args[2]!=='--output'||args[4]!=='--ack-public'){
  process.stderr.write('Usage: node tools/build_public_briefing_feed_v1.cjs --source INPUT.json --output OUTPUT.json --ack-public\n');
  process.exitCode=2;return;
 }
 const [input,output]=[path.resolve(args[1]),path.resolve(args[3])];
 if(input===output){process.stderr.write('DENIED: INPUT_EQUALS_OUTPUT\n');process.exitCode=2;return}
 let content;
 try{
  const stat=fs.lstatSync(input);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES){
   process.stderr.write('DENIED: INVALID_INPUT\n');process.exitCode=2;return;
  }
  content=fs.readFileSync(input,'utf8');
 }catch{process.stderr.write('DENIED: READ_FAILED\n');process.exitCode=2;return}
 const result=convert(content,{now:Date.now()});
 if(!result.ok){process.stderr.write('DENIED: '+result.code+'\n');process.exitCode=2;return}
 try{
  // Exclusive creation (wx): never overwrite another approved public feed.
  fs.writeFileSync(output,result.json,{encoding:'utf8',mode:0o600,flag:'wx'});
 }catch{process.stderr.write('DENIED: OUTPUT_EXISTS_OR_WRITE_FAILED\n');process.exitCode=2;return}
 process.stdout.write(JSON.stringify({
  status:'CREATED_LOCALLY_NOT_PUBLISHED',records:result.count,
  accountApiCalls:0,publicCredentialsUsed:false,
  publicSourceVerified:false
 })+'\n');
}
if(require.main===module)cli();
module.exports={convert};
