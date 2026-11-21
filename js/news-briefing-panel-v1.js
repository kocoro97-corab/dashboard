/* MY INVEST V2 — public briefing archive panel, sandbox integration only.
 * Manual file import/export. No ChatGPT-task transport, background fetch,
 * account APIs, credentials, GAS writes or stock orders.
 */
(function(root){
'use strict';
const KEY='myinvest_public_briefing_archive_v1';
const LEGACY_KEY='myinvest_public_ai_briefings_v1';
const MAX_FILE_BYTES=3000000;
const error=code=>({ok:false,code,storageModified:false});
function transfer(){
 if(typeof module==='object'&&module.exports)return require('./news-briefing-transfer-v1.js');
 return root.MYInvestBriefingTransferV1;
}
function archive(){
 if(typeof module==='object'&&module.exports)return require('./news-briefing-archive-v1.js');
 return root.MYInvestBriefingArchiveV1;
}
function read(storage,{now=Date.now()}={}){
 if(!storage||typeof storage.getItem!=='function')return error('STORAGE_UNAVAILABLE');
 let raw;
 try{raw=storage.getItem(KEY)}catch{return error('STORAGE_READ_FAILED')}
 if(raw===null)return {ok:true,records:[],storageModified:false};
 if(typeof raw!=='string'||raw.length>MAX_FILE_BYTES)return error('STORED_ARCHIVE_SIZE_INVALID');
 let rows;
 try{rows=JSON.parse(raw)}catch{return error('STORED_ARCHIVE_JSON_INVALID')}
 const checked=transfer().exportJSON(rows,{now});
 if(!checked.ok)return error('STORED_ARCHIVE_'+checked.code);
 return {ok:true,records:JSON.parse(checked.json).records,storageModified:false};
}
function importBackup(json,storage,{now=Date.now()}={}){
 const existing=read(storage,{now});if(!existing.ok)return existing;
 const merged=transfer().mergeJSON(json,existing.records,{now});
 if(!merged.ok)return error('IMPORT_'+merged.code);
 const changed=JSON.stringify(existing.records)!==JSON.stringify(merged.records);
 if(changed){
  try{storage.setItem(KEY,JSON.stringify(merged.records))}
  catch{return error('STORAGE_WRITE_FAILED')}
 }
 return {ok:true,records:merged.records,stats:merged.stats,conflicts:merged.conflicts,
  storageModified:changed,verification:merged.verification};
}
function exportBackup(storage,{now=Date.now()}={}){
 const existing=read(storage,{now});if(!existing.ok)return existing;
 return transfer().exportJSON(existing.records,{now});
}
function migrateLegacy(storage,{now=Date.now()}={}){
 let raw;
 try{raw=storage.getItem(LEGACY_KEY)}catch{return error('LEGACY_READ_FAILED')}
 if(raw===null)return {ok:true,records:[],legacyCount:0,storageModified:false,reason:'NO_LEGACY'};
 const parsed=transfer().parseLegacyJSON(raw,{now});
 if(!parsed.ok)return error('LEGACY_'+parsed.code);
 const backup=transfer().exportJSON(parsed.records,{now});
 if(!backup.ok)return error('LEGACY_EXPORT_'+backup.code);
 const imported=importBackup(backup.json,storage,{now});
 if(!imported.ok)return imported;
 return {...imported,legacyCount:parsed.records.length,legacyPreserved:true};
}
function mount(host,{storage=root.localStorage,onChange=()=>{}}={}){
 if(!host||typeof host.replaceChildren!=='function')return {ok:false,code:'INVALID_TARGET'};
 const document=host.ownerDocument||root.document;
 const mk=(tag,text,cls)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
 };
 const button=(label,handler)=>{
  const node=mk('button',label);node.type='button';node.addEventListener('click',handler);
  return node;
 };
 const stamp=value=>value===null?'미확인':new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST';
 const originLabel=origin=>origin==='manual'?'사용자 수동 기록':
  origin==='chatgpt-task'?'ChatGPT 작업 결과로 선언됨 (검증 안 됨)':
  '대시보드 생성으로 선언됨 (검증 안 됨)';
 const keyOf=r=>r.date+'|'+r.origin;
 let destroyed=false;let selectedKey='',notice='이 보관함은 자동 동기화되지 않습니다. 파일 가져오기는 직접 선택해야 합니다.';
 const style=mk('style');
 style.textContent='.mibv1{padding:14px;border:1px solid #344158;border-radius:11px;background:#111c2d;color:#e7eef9;margin:12px 0}.mibv1 *{box-sizing:border-box}.mibv1 h3{margin:0 0 6px}.mibv1 p{margin:7px 0}.mibv1-meta{color:#b6c5d9;font-size:12px}.mibv1-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}.mibv1 button,.mibv1 select{font:inherit;min-height:38px;max-width:100%;border:1px solid #465775;border-radius:7px;padding:7px 10px;background:#264365;color:#eef5ff}.mibv1 button{cursor:pointer}.mibv1 select{min-width:220px}.mibv1 pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;padding:12px;background:#0c1626;border:1px solid #344158;border-radius:8px;color:#edf3ff;font:inherit;line-height:1.55}.mibv1 article{border-top:1px solid #344158;padding:10px 0}.mibv1 a{color:#b1d9ff;overflow-wrap:anywhere}.mibv1-status{font-size:12px;color:#c8dcf4}@media(max-width:650px){.mibv1 select{width:100%;min-width:0}.mibv1 button{flex:1}}';
 function render(){
  if(destroyed)return;
  const current=read(storage,{now:Date.now()});
  host.replaceChildren();
  const area=mk('section',undefined,'mibv1');area.append(style);
  area.append(mk('h3','오전 7시 투자 브리핑 보관함'),
   mk('p','공개 시장 브리핑만 저장 · ChatGPT 예약 작업 자동 전달은 아직 연결되지 않았습니다.','mibv1-meta'));
  const status=mk('p',notice,'mibv1-status');
  status.setAttribute('role','status');
  const bar=mk('div',undefined,'mibv1-bar');
  const picker=mk('input');picker.type='file';picker.accept='.json,application/json';picker.hidden=true;
  picker.setAttribute('aria-label','브리핑 JSON 파일 선택');
  const loadButton=button('JSON 가져오기',()=>picker.click());
  picker.addEventListener('change',async()=>{
   const file=picker.files&&picker.files[0];picker.value='';
   if(!file)return;
   if(file.size>MAX_FILE_BYTES){notice='파일 용량이 제한(3MB)을 초과했습니다.';render();return}
   try{
    const text=await file.text();if(destroyed)return;const now=Date.now(),existing=read(storage,{now});
    const preview=existing.ok?transfer().mergeJSON(text,existing.records,{now}):null;
    if(preview?.ok&&preview.stats.updated>0&&!(typeof root.confirm==='function'&&root.confirm('기존 브리핑 '+preview.stats.updated+'건을 새 버전으로 교체하시겠습니까? 취소하면 기존 기록을 유지합니다.'))){notice='교체를 취소했습니다. 기존 기록을 유지합니다.';render();return}
    const result=importBackup(text,storage,{now});
    if(!result.ok)notice='가져오기 거부: '+result.code+' (기존 자료는 유지됩니다)';
    else{
     selectedKey='';const counts=result.stats;
     notice='가져오기: 추가 '+counts.added+'건 · 갱신 '+counts.updated+
      '건 · 동일 '+counts.unchanged+'건 · 오래된 자료 무시 '+counts.olderIgnored+
      '건 · 동일 시각 충돌 '+counts.equalTimeConflicts+'건. 충돌 기록은 기존 자료를 유지합니다.';
    }
   }catch{notice='파일을 읽지 못했습니다. 기존 자료는 유지됩니다.'}
   render();onChange();
  });
  const saveButton=button('JSON 백업 내보내기',()=>{
   const exported=exportBackup(storage,{now:Date.now()});
   if(!exported.ok){notice='내보내기 거부: '+exported.code;render();return}
   const url=root.URL.createObjectURL(new root.Blob([exported.json],{type:exported.mimeType}));
   const link=mk('a');link.href=url;link.download=exported.filename;
   area.append(link);link.click();link.remove();
   root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
   notice='공개 브리핑 '+exported.recordCount+'건의 JSON 백업을 생성했습니다.';render();
  });
  const legacyButton=button('기존 수동 브리핑 복사',()=>{
   const result=migrateLegacy(storage,{now:Date.now()});
   notice=result.ok?
    '기존 수동 기록 '+result.legacyCount+'건을 검사했습니다. 원본은 그대로 유지합니다. 동일 시각 충돌은 기존 기록이 우선합니다.':
    '복사 중단: '+result.code+' (기존 자료는 유지됩니다)';
   render();onChange();
  });
  bar.append(loadButton,saveButton,legacyButton,picker);
  area.append(bar,status);
  if(!current.ok){
   area.append(mk('p','보관함 데이터 오류: '+current.code+'. 손상된 자료를 자동 삭제하거나 덮어쓰지 않습니다.','mibv1-status'));
   host.append(area);return;
  }
  const rows=[...current.records].sort((a,b)=>b.date.localeCompare(a.date)||
   (b.generatedAt??0)-(a.generatedAt??0)||a.origin.localeCompare(b.origin));
  if(!rows.length){area.append(mk('p','저장된 공개 투자 브리핑이 없습니다. JSON 파일을 가져오거나 기존 수동 기록을 복사하세요.','mibv1-meta'));host.append(area);return}
  if(!rows.some(r=>keyOf(r)===selectedKey))selectedKey=keyOf(rows[0]);
  const selector=mk('select');selector.setAttribute('aria-label','브리핑 날짜 및 출처 선택');
  for(const record of rows){
   const item=mk('option',record.date+' · '+originLabel(record.origin));
   item.value=keyOf(record);selector.append(item);
  }
  selector.value=selectedKey;
  selector.addEventListener('change',()=>{selectedKey=selector.value;render()});
  const choose=mk('div',undefined,'mibv1-bar');choose.append(selector);
  const chosen=rows.find(r=>keyOf(r)===selectedKey);
  const view=archive().selection([chosen],{now:Date.now()});
  const today=archive().kstDate(Date.now());
  area.append(choose,mk('h4',chosen.title),
   mk('p',(chosen.date===today?'오늘 날짜 보고서 · ':'과거 보고서 · ')+originLabel(chosen.origin),'mibv1-meta'),
   mk('p','생성 '+stamp(chosen.generatedAt)+' · 시장 관측 '+stamp(chosen.observedAt)+' · 자료 조회 '+stamp(chosen.retrievedAt),'mibv1-meta'),
   mk('p',view.ok&&view.marketObservationStatus==='DECLARED_OLDER_THAN_36H'?
    '시장 관측시각이 36시간을 초과한 것으로 선언되어 있습니다. 실제 시세 검증은 수행하지 않았습니다.':
    '원문·생성 경로·시장 수치·출처 링크는 독립 검증되지 않았습니다.','mibv1-meta'));
  if(chosen.rawText)area.append(mk('pre',chosen.rawText));
  for(const section of chosen.sections){
   const article=mk('article');article.append(mk('strong',section.heading),mk('pre',section.body));
   if(section.sourceIds.length)article.append(mk('p','참고 출처 ID: '+section.sourceIds.join(', '),'mibv1-meta'));
   area.append(article);
  }
  if(chosen.sources.length){
   const citations=mk('section');citations.append(mk('h5','참고 출처 (실제 원문·게시시각 미검증)'));
   const links=mk('ul');
   for(const source of chosen.sources){
    const url=archive().safeUrl(source.url);
    if(!url)continue;
    const li=mk('li'),a=mk('a',source.title);
    a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    li.append(a);links.append(li);
   }
   citations.append(links);area.append(citations);
  }
  host.append(area);
 }
 render();
 return {ok:true,refresh:render,destroy:()=>{destroyed=true;host.replaceChildren()}};
}
const api=Object.freeze({read,importBackup,exportBackup,migrateLegacy,mount,
 storageKey:KEY,legacyKey:LEGACY_KEY});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestBriefingPanelV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
