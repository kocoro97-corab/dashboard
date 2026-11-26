/* MY INVEST V2 — DEV ONLY: private verbatim ChatGPT task archive reader.
 * This script is NOT deployed to production GAS. The private folder ID exists
 * only in the isolated TEST GAS script property MYINVEST_PRIVATE_BRIEFING_FOLDER_ID.
 * The caller is restricted to an approved administrator by Security.gs.
 * No document content or Drive ID is written to Logger, ScriptProperties or Sheets.
 */
function createPrivateOriginalBriefingReader_(deps){
  'use strict';
  const MAX_ITEMS=180,MAX_BYTES=280000;
  const validDay=s=>typeof s==='string'&&/^20[2-9][0-9]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(s)&&
    new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  const error=code=>({success:false,code,layer:'gas'});
  const today=()=>deps.Utilities.formatDate(new Date(deps.now()),'Asia/Seoul','yyyy-MM-dd');
  const sha256=text=>deps.Utilities.computeDigest(deps.Utilities.DigestAlgorithm.SHA_256,text,deps.Utilities.Charset.UTF_8)
    .map(n=>('0'+(n&255).toString(16)).slice(-2)).join('');
  function readArchive({mode='latest',date}={}){
    if(!['latest','date','list'].includes(mode)||date!==undefined&&!validDay(date))
      return error('PRIVATE_BRIEFING_BAD_REQUEST');
    if(mode==='date'&&!date)return error('PRIVATE_BRIEFING_BAD_REQUEST');
    let folderId;
    try{folderId=deps.properties().getProperty('MYINVEST_PRIVATE_BRIEFING_FOLDER_ID')}catch{return error('PRIVATE_BRIEFING_NOT_CONFIGURED')}
    if(typeof folderId!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(folderId))
      return error('PRIVATE_BRIEFING_NOT_CONFIGURED');
    let files;
    try{
      const iterator=deps.DriveApp.getFolderById(folderId).getFiles();
      const dates=new Map();let inspected=0;
      while(iterator.hasNext()){
        if(++inspected>MAX_ITEMS)return error('PRIVATE_BRIEFING_ARCHIVE_LIMIT');
        const file=iterator.next(),name=String(file.getName());
        const m=/^(20[2-9][0-9]-[01][0-9]-[0-3][0-9])(?:\.(?:txt|md))?$/.exec(name);
        if(!m||!validDay(m[1]))continue;
        const mime=String(file.getMimeType());
        if(!['text/plain','text/markdown','application/vnd.google-apps.document'].includes(mime))continue;
        if(dates.has(m[1]))return error('PRIVATE_BRIEFING_DUPLICATE_DATE');
        dates.set(m[1],{file,mime});
      }
      files=dates;
    }catch{return error('PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE')}
    const todayKst=today(),available=[...files.keys()].filter(d=>d<=todayKst).sort().reverse();
    if(mode==='list')return {success:true,schemaVersion:1,dates:available.slice(0,90),
      latestDate:available[0]||null,private:true,cacheable:false};
    const chosen=mode==='date'?date:available[0];
    if(!chosen||chosen>todayKst)return error('PRIVATE_BRIEFING_NOT_FOUND');
    const record=files.get(chosen);
    if(!record)return error('PRIVATE_BRIEFING_NOT_FOUND');
    try{
      let value;
      if(record.mime==='application/vnd.google-apps.document')
        value=deps.DocumentApp.openById(record.file.getId()).getBody().getText();
      else {
        const blob=record.file.getBlob();
        if(blob.getSize()>MAX_BYTES)return error('PRIVATE_BRIEFING_TOO_LARGE');
        value=blob.getDataAsString('UTF-8');
      }
      if(typeof value!=='string'||!value.length||BlobSize(value)>MAX_BYTES)
        return error('PRIVATE_BRIEFING_TOO_LARGE');
      return {success:true,schemaVersion:1,private:true,cacheable:false,
        dates:available.slice(0,90),latestDate:available[0]||null,
        report:{date:chosen,content:value,contentSha256:sha256(value),
          // SHA256 proves transfer integrity, not ChatGPT authorship.
          origin:'scheduled-task-archive-unverified',format:'verbatim-text',
          savedAt:record.file.getLastUpdated().getTime()}};
    }catch{return error('PRIVATE_BRIEFING_READ_FAILED')}
  }
  function BlobSize(value){return deps.Utilities.newBlob(value,'text/plain').getBytes().length}
  return Object.freeze({readArchive});
}
function privateMorningBriefingRead_(body){
  // Defense in depth: the doPost caller already verifies the admin session.
  try{return createPrivateOriginalBriefingReader_({
    properties:()=>PropertiesService.getScriptProperties(),
    DriveApp:DriveApp,DocumentApp:DocumentApp,Utilities:Utilities,now:()=>Date.now()
  }).readArchive({mode:body.mode,date:body.date})}
  catch{return {success:false,code:'PRIVATE_BRIEFING_READ_FAILED',layer:'gas'}}
}
