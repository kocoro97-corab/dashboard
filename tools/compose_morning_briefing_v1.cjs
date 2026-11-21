'use strict';
/* Explicit offline conversion; NEVER fetches prices or publishes to GitHub/GAS. */
const fs=require('node:fs'),path=require('node:path');
const composer=require('../js/news-briefing-market-composer-v1.js');
const transfer=require('../js/news-briefing-transfer-v1.js');
const toFeed=require('./build_public_briefing_feed_v1.cjs');
const SIZE=3000000;
function convert(raw,{now}={}){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>SIZE)
  return {ok:false,code:'INPUT_TOO_LARGE'};
 let snapshot;try{snapshot=JSON.parse(raw)}catch{return {ok:false,code:'INVALID_JSON'}}
 const brief=composer.compose(snapshot,{now});
 if(!brief.ok)return brief;
 const backup=transfer.exportJSON([brief.record],{now});
 if(!backup.ok)return {ok:false,code:'BACKUP_'+backup.code};
 const feed=toFeed.convert(backup.json,{now});
 return feed.ok?{...feed,reportDate:brief.record.date,
  missingMetrics:brief.missingMetrics,ruleBasedNotAI:true}:feed;
}
function main(){
 const args=process.argv.slice(2);
 if(args.length!==5||args[0]!=='--source'||args[2]!=='--output'||args[4]!=='--ack-public'){
  process.stderr.write('Usage: node tools/compose_morning_briefing_v1.cjs --source PUBLIC_SNAPSHOT.json --output PUBLIC_FEED.json --ack-public\n');
  process.exitCode=2;return;
 }
 const [src,dst]=[path.resolve(args[1]),path.resolve(args[3])];
 if(src===dst){process.stderr.write('DENIED: SAME_PATH\n');process.exitCode=2;return}
 let raw;
 try{
  const stat=fs.lstatSync(src);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>SIZE)throw Error('size');
  raw=fs.readFileSync(src,'utf8');
 }catch{process.stderr.write('DENIED: INVALID_SOURCE_FILE\n');process.exitCode=2;return}
 const out=convert(raw,{now:Date.now()});
 if(!out.ok){process.stderr.write('DENIED: '+out.code+'\n');process.exitCode=2;return}
 try{fs.writeFileSync(dst,out.json,{flag:'wx',mode:0o600,encoding:'utf8'})}
 catch{process.stderr.write('DENIED: OUTPUT_ALREADY_EXISTS_OR_NOT_WRITABLE\n');process.exitCode=2;return}
 process.stdout.write(JSON.stringify({status:'CREATED_LOCALLY_NOT_PUBLISHED',
  reportDate:out.reportDate,sourceVerified:false,actualAi:false,accountCalls:0})+'\n');
}
if(require.main===module)main();
module.exports={convert};
