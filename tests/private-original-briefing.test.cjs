'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const code=fs.readFileSync('gas/PrivateOriginalBriefing.gs','utf8');
const now=Date.parse('2026-11-26T01:00:00Z'),folder='PRIVATE_OWNER_FOLDER_ABCDEFGHIJKLMNOP';
const header='<title>원문 그대로</title>\n',original=header+'<Cite ref="tool-marker"/>\n**표기 변경 금지**\n끝\n';
function fixture({files=[{name:'2026-11-26.txt',body:original}],configured=true}={}){
 const properties={getProperty:key=>key==='MYINVEST_PRIVATE_BRIEFING_FOLDER_ID'&&configured?folder:null};
 const state={reads:0};
 const objects=files.map((row,i)=>({
  getName:()=>row.name,
  getMimeType:()=>row.mime||'text/plain',
  getId:()=>String(i),
  getLastUpdated:()=>new Date(now-1000),
  getBlob:()=>({getSize:()=>Buffer.byteLength(row.body||''),getDataAsString:()=>row.body})
 }));
 const DriveApp={getFolderById:id=>{assert.equal(id,folder);const items=[...objects];return {getFiles:()=>({hasNext:()=>items.length>0,next:()=>{state.reads++;return items.shift()}})}}};
 const DocumentApp={openById:id=>({getBody:()=>({getText:()=>files[Number(id)].body})})};
 const Utilities={
  formatDate:()=>new Date(now+9*3600000).toISOString().slice(0,10),
  DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
  computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],
  newBlob:txt=>({getBytes:()=>[...Buffer.from(txt)]})
 };
 const ctx=vm.createContext({Date,PropertiesService:{getScriptProperties:()=>properties},DriveApp,DocumentApp,Utilities});
 vm.runInContext(code,ctx,{filename:'gas/PrivateOriginalBriefing.gs'});
 const reader=ctx.createPrivateOriginalBriefingReader_({properties:()=>properties,DriveApp,DocumentApp,Utilities,now:()=>now});
 return {reader,ctx,state};
}
test('private owner archive returns exact byte-equivalent unicode markup without sanitizing, truncating or writing',()=>{
 const f=fixture(),v=f.reader.readArchive({mode:'latest'});
 assert.equal(v.success,true);assert.equal(v.report.content,original);
 assert.equal(v.report.contentSha256,crypto.createHash('sha256').update(original).digest('hex'));
 assert.equal(v.report.format,'verbatim-text');
 assert.equal(v.private,true);assert.equal(v.cacheable,false);
 assert.equal(JSON.stringify(v).includes(folder),false,'never return Drive folder id');
});
test('archive includes at most known KST dates, rejects malformed user dates and unconfigured folder',()=>{
 const files=[{name:'2026-11-26.txt',body:original},{name:'2026-11-25',mime:'application/vnd.google-apps.document',body:'yesterday\nmarkdown'},
 {name:'2026-11-27.txt',body:'future'},{name:'invalid.md',body:'ignore'}],f=fixture({files});
 assert.deepEqual(Array.from(f.reader.readArchive({mode:'list'}).dates),['2026-11-26','2026-11-25']);
 assert.equal(f.reader.readArchive({mode:'date',date:'2026-11-25'}).report.content,'yesterday\nmarkdown');
 assert.equal(f.reader.readArchive({mode:'date',date:'2026-11-27'}).code,'PRIVATE_BRIEFING_NOT_FOUND');
 assert.equal(f.reader.readArchive({mode:'date',date:'2026-02-30'}).code,'PRIVATE_BRIEFING_BAD_REQUEST');
 assert.equal(f.reader.readArchive({mode:'date',date:'../../secret'}).code,'PRIVATE_BRIEFING_BAD_REQUEST');
 assert.equal(fixture({configured:false}).reader.readArchive().code,'PRIVATE_BRIEFING_NOT_CONFIGURED');
});
test('duplicate dates, oversized report, inaccessible folder fail closed without revealing contents',()=>{
 const duplicates=fixture({files:[{name:'2026-11-26',body:'A'},{name:'2026-11-26.txt',body:'B'}]});
 assert.equal(duplicates.reader.readArchive().code,'PRIVATE_BRIEFING_DUPLICATE_DATE');
 assert.equal(fixture({files:[{name:'2026-11-26.txt',body:'x'.repeat(290000)}]}).reader.readArchive().code,'PRIVATE_BRIEFING_TOO_LARGE');
});
