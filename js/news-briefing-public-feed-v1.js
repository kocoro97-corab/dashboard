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
function mount(host,{fetcher=root.fetch?.bind(root),baseHref=root.location?.href}={}){
 if(!host||typeof host.replaceChildren!=='function')return {ok:false,code:'INVALID_TARGET'};
 const doc=host.ownerDocument||root.document;
 const el=(tag,text,cls)=>{
  const node=doc.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
 };
 let destroyed=false,sequence=0,controller=null;
 let result=null,selectedKey='';
 const fmt=t=>t==null?'미확인':
  new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST';
 const sourceLabel=o=>o==='manual'?'수동 게시':
  o==='chatgpt-task'?'ChatGPT 작업 결과로 선언됨 (검증 안 됨)':
  '대시보드 생성으로 선언됨 (검증 안 됨)';
 const key=r=>r.date+'|'+r.origin;
 const css='.mifv1{margin:12px 0;padding:14px;border:1px solid #344158;border-radius:11px;background:#111c2d;color:#e7eef9}.mifv1 h3{margin:0}.mifv1 p{margin:8px 0}.mifv1 small{color:#b6c5d9}.mifv1 button,.mifv1 select{min-height:38px;background:#264365;border:1px solid #465775;border-radius:7px;color:#edf3ff;padding:7px 10px;max-width:100%;cursor:pointer}.mifv1 select{min-width:190px}.mifv1 .mifv1-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0}.mifv1 pre{max-height:320px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;font:inherit;line-height:1.5;padding:12px;border-radius:8px;background:#0c1626;border:1px solid #344158}.mifv1 a{color:#b1d9ff;overflow-wrap:anywhere}@media(max-width:650px){.mifv1 select{width:100%}}';
 function draw(message){
  if(destroyed)return;
  host.replaceChildren();
  const area=el('section',undefined,'mifv1');
  const style=el('style');style.textContent=css;area.append(style);
  const title=el('h3','공유 공개시장 브리핑');
  const explain=el('p','같은 사이트에 게시된 공개 브리핑을 PC·모바일에서 조회합니다. ChatGPT 예약 작업 자동 전달은 연결되지 않았습니다.');
  explain.className='mifv1-description';
  const bar=el('div',undefined,'mifv1-controls'),button=el('button','공유 파일 새로고침');
  button.type='button';button.addEventListener('click',()=>{void refresh()});
  bar.append(button);area.append(title,explain,bar);
  const status=el('p',message||'공개 브리핑 파일 확인 중…');
  status.setAttribute('role','status');area.append(status);
  if(result?.ok&&result.records.length){
   const records=[...result.records].sort((a,b)=>b.date.localeCompare(a.date)||
    (b.generatedAt??0)-(a.generatedAt??0)||a.origin.localeCompare(b.origin));
   if(!records.some(r=>key(r)===selectedKey))selectedKey=key(records[0]);
   const select=el('select');select.setAttribute('aria-label','공유 브리핑 날짜 및 작성 경로');
   for(const r of records){const option=el('option',r.date+' · '+sourceLabel(r.origin));option.value=key(r);select.append(option)}
   select.value=selectedKey;select.addEventListener('change',()=>{selectedKey=select.value;draw('공개 공유 파일의 작성 경로와 수치는 별도 검증되지 않았습니다.')});
   bar.append(select);
   const r=records.find(v=>key(v)===selectedKey);
   area.append(el('h4',r.title),el('p',
    r.date+' · '+sourceLabel(r.origin)+' · 생성 '+fmt(r.generatedAt)+' · 관측 '+fmt(r.observedAt)+' · 조회 '+fmt(r.retrievedAt)));
   if(r.rawText)area.append(el('pre',r.rawText));
   for(const section of r.sections){
    const block=el('article');block.append(el('strong',section.heading),el('pre',section.body));
    if(section.sourceIds.length)block.append(el('small','출처 ID: '+section.sourceIds.join(', ')));
    area.append(block);
   }
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
  const next=await load({fetcher,baseHref,signal:controller?.signal});
  if(destroyed||current!==sequence)return next;
  result=next;
  if(next.ok){
   draw('같은 사이트에서 공개 브리핑 '+next.records.length+
    '건을 읽었습니다. 게시 경로·내용·가격·출처는 독립 검증되지 않았습니다.');
  }else if(next.code==='PUBLIC_FEED_NOT_PUBLISHED'){
   draw('공유 파일이 아직 게시되지 않았습니다. 기존 수동 보관함은 계속 사용할 수 있습니다.');
  }else draw('공유 브리핑을 표시할 수 없습니다: '+next.code+' · 기존 수동 보관함은 유지됩니다.');
  return next;
 }
 draw('공개 브리핑 파일 확인 중…');
 void refresh();
 return {ok:true,refresh,destroy:()=>{
  destroyed=true;sequence++;controller?.abort();host.replaceChildren();
 }};
}
const api=Object.freeze({load,mount,sourceUrl,feedPath:FEED_PATH});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestPublicBriefingFeedV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
