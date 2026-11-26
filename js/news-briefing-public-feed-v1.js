/* MY INVEST V2 — same-origin, read-only public morning-briefing feed.
 * A published feed can be viewed on PC and mobile. This module does not publish
 * ChatGPT task outputs, authenticate source claims, or access user accounts.
 * No cross-origin fetch, credentials, localStorage writes, timers, GAS or NH.
 */
(function(root){
'use strict';
const FEED_PATH='data/myinvest-public-briefings-v1.json';
const MAX_BYTES=3000000;
const failed=(code)=>({ok:false,code,records:[],verified:false});
function deps(){
 if(typeof module==='object'&&module.exports){
  return {
   archive:require('./news-briefing-archive-v1.js'),
   transfer:require('./news-briefing-transfer-v1.js')
  };
 }
 return {archive:root.MYInvestBriefingArchiveV1,
  transfer:root.MYInvestBriefingTransferV1};
}
function sourceUrl(baseHref){
 if(typeof baseHref!=='string'||!/^https?:\/\//i.test(baseHref))return null;
 try{
  const base=new URL(baseHref),url=new URL(FEED_PATH,base);
  if(!['http:','https:'].includes(base.protocol)||url.origin!==base.origin||
    url.username||url.password||url.search||url.hash)return null;
  return url.href;
 }catch{return null}
}
function plainEnvelope(obj){
 return obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===3&&
  ['type','schemaVersion','records'].every(key=>Object.hasOwn(obj,key));
}
async function load({fetcher,baseHref,now=Date.now(),signal}={}){
 const dep=deps(),url=sourceUrl(baseHref);
 if(!url)return failed('INVALID_SAME_ORIGIN_BASE');
 if(typeof fetcher!=='function'||!dep.archive||!dep.transfer)return failed('UNAVAILABLE_DEPENDENCY');
 if(!Number.isSafeInteger(now)||now<=0)return failed('INVALID_CLOCK');
 let response;
 try{
  response=await fetcher(url,{
   method:'GET',mode:'same-origin',credentials:'omit',
   redirect:'error',cache:'no-store',headers:{Accept:'application/json'},signal
  });
 }catch{
  return failed(signal?.aborted?'REQUEST_ABORTED':'FETCH_UNAVAILABLE');
 }
 if(!response||typeof response.status!=='number')return failed('INVALID_RESPONSE');
 if(response.status===404||response.status===410)return failed('PUBLIC_FEED_NOT_PUBLISHED');
 if(response.status!==200)return failed('PUBLIC_FEED_HTTP_FAILURE');
 const contentType=response.headers?.get?.('content-type');
 if(typeof contentType==='string'&&contentType&&!/\bapplication\/(?:json|[^;]+\+json)\b/i.test(contentType))
  return failed('NOT_JSON_CONTENT_TYPE');
 const lengthHeader=response.headers?.get?.('content-length');
 if(lengthHeader!=null&&lengthHeader!==''&&/^\d+$/.test(lengthHeader)&&Number(lengthHeader)>MAX_BYTES)
  return failed('PUBLIC_FEED_TOO_LARGE');
 let body;
 try{body=await response.text()}catch{return failed('PUBLIC_FEED_READ_FAILURE')}
 if(typeof body!=='string'||body.length>MAX_BYTES||
  (typeof TextEncoder!=='undefined'&&new TextEncoder().encode(body).byteLength>MAX_BYTES))
  return failed('PUBLIC_FEED_TOO_LARGE');
 let payload;
 try{payload=JSON.parse(body.replace(/^\uFEFF/,''))}catch{return failed('INVALID_PUBLIC_FEED_JSON')}
 if(!plainEnvelope(payload))return failed('UNEXPECTED_PUBLIC_FEED_FIELDS');
 if(payload.type!=='public-briefing-feed-v1'||payload.schemaVersion!==1||
  !Array.isArray(payload.records)||!payload.records.length||payload.records.length>90)
  return failed('INVALID_PUBLIC_FEED_ENVELOPE');
 // Transfer validation rejects unexpected nested/private fields before the
 // archive normalizer could strip them. Strictly fail the whole feed.
 const strict=dep.transfer.exportJSON(payload.records,{now});
 if(!strict.ok)return failed('INVALID_PUBLIC_FEED_RECORD_'+strict.code);
 const normalized=dep.archive.parseFeed(payload,{now});
 if(!normalized.ok)return failed('PUBLIC_FEED_'+normalized.code);
 return {ok:true,records:normalized.records,verified:false,
  provenance:'SAME_ORIGIN_FILE_UNAUTHENTICATED',
  marketDataVerified:false,chatgptScheduledDeliveryConfirmed:false};
}
function mount(host,{fetcher=root.fetch?.bind(root),baseHref=root.location?.href,fallbackRecords=()=>[]}={}){
 if(!host||typeof host.replaceChildren!=='function')return {ok:false,code:'INVALID_TARGET'};
 const doc=host.ownerDocument||root.document;
 const el=(tag,text,cls)=>{
  const node=doc.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
 };
 let destroyed=false,sequence=0,controller=null;
 let result=null,lastGood=null,selectedKey='',userPicked=false;
 const fmt=t=>t==null?'미확인':
  new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST';
 const sourceLabel=o=>o==='manual'?'수동 게시':
  o==='chatgpt-task'?'ChatGPT 작업 결과로 선언됨 (검증 안 됨)':
  o==='openai-api'?'별도 AI API 생성 · 시장자료 독립 검증 전':
  '규칙 기반 대시보드 보고서 (AI 모델 호출 없음)';
 const key=r=>r.date+'|'+r.origin;
 const css='.mifv1{margin:12px 0;padding:14px;border:1px solid #344158;border-radius:11px;background:#111c2d;color:#e7eef9}.mifv1 h3{margin:0}.mifv1 p{margin:8px 0}.mifv1 small{color:#b6c5d9}.mifv1 button,.mifv1 select{min-height:38px;background:#264365;border:1px solid #465775;border-radius:7px;color:#edf3ff;padding:7px 10px;max-width:100%;cursor:pointer}.mifv1 select{min-width:190px}.mifv1 .mifv1-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0}.mifv1 pre{max-height:320px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;font:inherit;line-height:1.5;padding:12px;border-radius:8px;background:#0c1626;border:1px solid #344158}.mifv1 a{color:#b1d9ff;overflow-wrap:anywhere}@media(max-width:650px){.mifv1 select{width:100%}}';
 function draw(message){
  if(destroyed)return;
  host.replaceChildren();
  const area=el('section',undefined,'mifv1');
  const style=el('style');style.textContent=css;area.append(style);
  const title=el('h3','오늘의 AI 뉴스·투자 전략');
  const explain=el('p','매일 아침 AI가 생성한 공개시장 보고서를 자동 조회합니다. 별도 AI API 생성이며 ChatGPT 예약 작업의 원문 자동 전달과는 다릅니다. 출처·데이터 시각을 확인하세요.');
  explain.className='mifv1-description';
  const bar=el('div',undefined,'mifv1-controls'),button=el('button','공유 파일 새로고침');
  button.type='button';button.addEventListener('click',()=>{void refresh()});
  bar.append(button);area.append(title,explain,bar);
  const status=el('p',message||'공개 브리핑 파일 확인 중…');
  status.setAttribute('role','status');area.append(status);
  let visible=lastGood?.records||[],local=false;
  if(!visible.length){try{const rows=fallbackRecords();const checked=deps().transfer.exportJSON(rows,{now:Date.now()});if(checked.ok){visible=JSON.parse(checked.json).records;local=true}}catch{}}
  if(visible.length){
   const records=[...visible].sort((a,b)=>b.date.localeCompare(a.date)||
    (b.generatedAt??0)-(a.generatedAt??0)||a.origin.localeCompare(b.origin));
   if(!userPicked||!records.some(r=>key(r)===selectedKey))selectedKey=key(records[0]);
   const select=el('select');select.setAttribute('aria-label','공유 브리핑 날짜 및 작성 경로');
   for(const r of records){const option=el('option',r.date+' · '+sourceLabel(r.origin));option.value=key(r);select.append(option)}
   select.value=selectedKey;select.addEventListener('change',()=>{selectedKey=select.value;userPicked=true;draw('공개 공유 파일의 작성 경로와 수치는 별도 검증되지 않았습니다.')});
   bar.append(select);
   const r=records.find(v=>key(v)===selectedKey),today=deps().archive.kstDate(Date.now());
   area.append(el('p',(local?'이 브라우저의 수동 보관 자료 · 기기 간 공유되지 않음':'공유 공개파일 · PC·모바일 공통')+' · '+(r.date===today?'오늘 날짜 보고서':'지난 보고서 · 오늘 브리핑 미등록'),'mifv1-freshness'));
   if(r.origin==='dashboard-pipeline')area.append(el('p','규칙 기반 브리핑 · 실제 AI 모델 호출 없음'));
   if(lastGood&&result&&!result.ok)area.append(el('p','이전 정상 파일 유지 · 최근 갱신 실패 · '+result.code,'mifv1-stale'));
   if(r.observedAt==null)area.append(el('p','시장 관측시각 미확인 · 최신 시세로 판단하지 마세요.'));
   else if(Date.now()-r.observedAt>36*3600000)area.append(el('p','시장 관측 36시간 초과 · 휴장 여부와 관측일을 확인하세요.'));
   area.append(el('h4',r.title),el('p',
    r.date+' · '+sourceLabel(r.origin)+' · 생성 '+fmt(r.generatedAt)+' · 관측 '+fmt(r.observedAt)+' · 조회 '+fmt(r.retrievedAt)));
   if(r.rawText){if(!r.sections.length)area.append(el('pre',r.rawText));else{const raw=el('details');raw.append(el('summary','전체 원문 보기'),el('pre',r.rawText));area.append(raw)}}
   const response=el('section',undefined,'mifv1-market-response');
   const responseKinds=new Set(['us-market','kr-market','futures','rates-fx','sectors','daytrade','swing']);
   if(r.sections.some(x=>responseKinds.has(x.kind)))response.append(el('h4','미국장 마감 및 한국장 대응'));
   for(const section of r.sections){
    const block=el('article');block.append(el('strong',section.heading),el('pre',section.body));
    if(section.sourceIds.length)block.append(el('small','출처 ID: '+section.sourceIds.join(', ')));
    if(responseKinds.has(section.kind))response.append(block);else area.append(block);
   }
   if(response.children.length)area.append(response);
   if(r.sources.length){
    const list=el('ul');
    for(const entry of r.sources){
     const safe=deps().archive.safeUrl(entry.url);
     if(!safe)continue;
     const li=el('li'),a=el('a',entry.title);
     a.href=safe;a.target='_blank';a.rel='noopener noreferrer';
     li.append(a);list.append(li);
    }
    area.append(el('h5','참고 링크 (원문 확인 필요)'),list);
   }
  }
  host.append(area);
 }
 async function refresh(){
  if(destroyed)return failed('TARGET_UNMOUNTED');
  const current=++sequence;
  controller?.abort();
  controller=typeof AbortController!=='undefined'?new AbortController():null;
  draw('공개 브리핑 파일 확인 중…');
  const requestController=controller,timeout=requestController?root.setTimeout(()=>requestController.abort(),15000):null;let next;
  try{next=await load({fetcher,baseHref,signal:requestController?.signal})}finally{if(timeout!==null)root.clearTimeout(timeout)}
  if(destroyed||current!==sequence)return next;
  result=next;
  if(next.ok){
   lastGood=next;
   draw('같은 사이트에서 공개 브리핑 '+next.records.length+
    '건을 읽었습니다. 게시 경로·내용·가격·출처는 독립 검증되지 않았습니다.');
  }else if(next.code==='PUBLIC_FEED_NOT_PUBLISHED'){
   draw('오늘 AI 브리핑 자동 생성·게시가 아직 활성화되지 않았습니다. AI API 연결 승인 전까지 보고서 파일이 없으며 직접 입력할 필요는 없습니다.');
  }else draw('AI 브리핑 자동 게시본을 읽지 못했습니다: '+next.code+' · 이전 정상 보고서가 있으면 유지합니다. 직접 입력은 필요하지 않습니다.');
  return next;
 }
 draw('공개 브리핑 파일 확인 중…');
 void refresh();
 return {ok:true,refresh,refreshLocal:()=>draw(result?.ok?'공유 공개 브리핑 · 출처와 시각 확인':'공유 파일 미연결 · 보관 자료 확인'),destroy:()=>{
  destroyed=true;sequence++;controller?.abort();host.replaceChildren();
 }};
}
const api=Object.freeze({load,mount,sourceUrl,feedPath:FEED_PATH});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestPublicBriefingFeedV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
