'use strict';
/* Explicit LOCAL public-only store update. No network/git/production operations.
 * Duplicate report days are not replaced. Invalid input preserves the old file.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const composer=require('./compose_morning_briefing_v1.cjs');
const transfer=require('../js/news-briefing-transfer-v1.js');
const LIMIT=3000000;
function readPublic(file){
 const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw Error('INVALID_PUBLIC_STORE');
 return fs.readFileSync(file,'utf8');
}
function records(text,now){
 const d=JSON.parse(text);
 if(!d||Object.keys(d).sort().join('|')!=='records|schemaVersion|type'||d.type!=='public-briefing-feed-v1'||d.schemaVersion!==1||!Array.isArray(d.records))throw Error('INVALID_PUBLIC_STORE');
 const check=transfer.exportJSON(d.records,{now});if(!check.ok)throw Error('INVALID_PUBLIC_STORE');
 return JSON.parse(check.json).records;
}
function update(snapshotText,store,{now=Date.now()}={}){
 const built=composer.convert(snapshotText,{now});if(!built.ok)return {ok:false,code:built.code,modified:false};
 const incoming=records(built.json,now),file=path.resolve(store),lock=file+'.lock';let fd,tmp;
 try{
  fd=fs.openSync(lock,'wx',0o600);
  const previous=fs.existsSync(file)?readPublic(file):null,old=previous===null?[]:records(previous,now);
  const next=incoming[0];if(old.some(r=>r.date===next.date&&r.origin===next.origin))return {ok:true,status:'SKIPPED_DAILY_DUPLICATE',modified:false,count:old.length};
  if(old.length>=90)return {ok:false,code:'ARCHIVE_REVIEW_REQUIRED',modified:false};
  const combined=transfer.exportJSON([next,...old],{now});if(!combined.ok)return {ok:false,code:'INVALID_COMBINED_STORE',modified:false};
  const output=JSON.stringify({type:'public-briefing-feed-v1',schemaVersion:1,records:JSON.parse(combined.json).records},null,2);
  if(Buffer.byteLength(output)>LIMIT)return {ok:false,code:'PUBLIC_STORE_SIZE_LIMIT',modified:false};
  tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,output,{flag:'wx',mode:0o600});
  const handle=fs.openSync(tmp,'r');try{fs.fsyncSync(handle)}finally{fs.closeSync(handle)}
  if((fs.existsSync(file)?readPublic(file):null)!==previous)return {ok:false,code:'PUBLIC_STORE_CHANGED',modified:false};
  fs.renameSync(tmp,file);tmp=null;
  return {ok:true,status:'UPDATED_LOCAL_PUBLIC_STORE_NOT_PUBLISHED',modified:true,count:old.length+1};
 }catch(e){return {ok:false,code:e.code==='EEXIST'?'PUBLIC_STORE_BUSY':'PUBLIC_STORE_UPDATE_FAILED',modified:false}}
 finally{if(tmp)try{fs.unlinkSync(tmp)}catch{}if(fd!==undefined){fs.closeSync(fd);try{fs.unlinkSync(lock)}catch{}}}
}
function main(){
 const a=process.argv.slice(2);if(a.length!==5||a[0]!=='--source'||a[2]!=='--store'||a[4]!=='--ack-public'){process.stderr.write('Usage: node tools/update_public_briefing_feed_v1.cjs --source PUBLIC_SNAPSHOT.json --store LOCAL_PUBLIC_FEED.json --ack-public\n');process.exitCode=2;return}
 let result;try{const input=readPublic(a[1]);if(path.resolve(a[1])===path.resolve(a[3]))throw Error('SAME_PATH');result=update(input,a[3])}catch{result={ok:false,code:'INVALID_SOURCE_FILE',modified:false}}
 process.stdout.write(JSON.stringify({...result,published:false,actualAi:false,actualNhCalls:0,accountCalls:0})+'\n');if(!result.ok)process.exitCode=1;
}
if(require.main===module)main();module.exports={update};
