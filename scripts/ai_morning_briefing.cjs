#!/usr/bin/env node
'use strict';
// Development-only server-side AI morning briefing generator.
// NEVER run from the browser. Requires owner-approved, separately billed API
// secret and isolated developer publishing. It cannot read ChatGPT task output.
const fs=require('node:fs'),path=require('node:path');
const archive=require('../js/news-briefing-archive-v1.js');
const transfer=require('../js/news-briefing-transfer-v1.js');
const ENDPOINT='https://api.openai.com/v1/responses';
const MODEL='gpt-5.4-mini';
const kinds=['overview','us-market','kr-market','futures','rates-fx','news','sectors','daytrade','swing','risk','events'];
const fail=code=>{throw Error(code)};
const schema={type:'object',additionalProperties:false,required:['title','sections'],
 properties:{
  title:{type:'string'},
  sections:{type:'array',items:{type:'object',additionalProperties:false,
   required:['kind','heading','body','sourceUrls'],properties:{
    kind:{type:'string',enum:kinds},
    heading:{type:'string'},
    body:{type:'string'},
    sourceUrls:{type:'array',items:{type:'string'}}
   }}}
 }};
function requestBody(date){
 return {
  model:MODEL,store:false,max_output_tokens:4800,tool_choice:'required',
  tools:[{type:'web_search'}],include:['web_search_call.action.sources'],
  text:{format:{type:'json_schema',name:'myinvest_ai_morning_public',strict:true,schema}},
  input:[
   {role:'system',content:[
    '너는 공개시장 데이터만 사용하는 독립적인 AI 투자 브리핑 분석가이다.',
    '공개 시장·뉴스 웹 검색을 실제 실행하고 해당 웹 검색에서 찾은 URL만 근거로 이용한다.',
    '오늘 확인하지 못한 데이터/수치는 미확인으로 표시한다. 가격, 상승률, 종목, 실적, 날짜를 창작하지 않는다.',
    '검색된 기사/시장자료와 직접 연결되는 URL만 sourceUrls에 넣는다. 인용 없는 단정 금지.',
    '미국장 마감 S&P500 Nasdaq Dow SOX, 금리 2Y/10Y, USD/KRW, VIX, 원자재, 미국 선물, 한국 KOSPI/KOSDAQ, 산업/테마, 단타/스윙 위험 조건을 다루되 미확인 수치는 생략한다.',
    'NYSE $TICK 실측 수치는 확인된 경우에만 명시한다. +1000/-1000은 조건부 기준으로만 사용한다.',
    '전일 미국 마감 -> 당일 한국장 대응 -> 주도 섹터/테마 확인 -> 단타·스윙 별도 시나리오 순서.',
    '출처 날짜와 시장 거래일을 구분하고, 주말/휴장일에는 이전 장 자료임을 밝힌다.',
    '일반적인 공개시장 관찰만 작성한다. 계좌, 보유종목, 주민정보, 사적 질문, 로그인, 주문, 투자자 개인정보를 요구하거나 추정하지 않는다.',
    '반드시 한국어로 출력한다. 거래 신호는 검증전 조건부 관찰로 설명한다.'
   ].join(' ')},
   {role:'user',content:`대상일(한국시간): ${date}. 웹 검색 결과로 검증 가능한 공개시장 AI 투자 브리핑을 작성해. 
섹션 6~9개, 각 섹션에는 이번 검색에 실제로 나온 HTTPS URL만 1개 이상 sourceUrls로 제공.
전체 내용은 짧고 실용적으로, 제목 및 섹션 본문에 원천이 미확인인 수치 금지.`}
  ]
 };
}
function safeSource(url){
 const result=archive.safeUrl(url);
 if(!result)return null;
 try{const u=new URL(result);if(!['http:','https:'].includes(u.protocol))return null;return u.href}catch{return null}
}
function citations(response){
 const found=new Map();let webCalls=0;
 for(const item of response?.output||[]){
  if(item?.type==='web_search_call'){
   webCalls++;
   for(const source of item.action?.sources||[]){
    const url=safeSource(source.url);
    if(url)found.set(url,source.title||new URL(url).hostname);
   }
  }
  if(item?.type==='message')for(const part of item.content||[])
   for(const annotation of part.annotations||[]){
    if(annotation?.type!=='url_citation')continue;
    const url=safeSource(annotation.url);
    if(url)found.set(url,annotation.title||new URL(url).hostname);
   }
 }
 return {webCalls,found};
}
function outputText(response){
 if(response?.status!=='completed')fail('AI_RESPONSE_INCOMPLETE');
 const texts=[];
 for(const item of response.output||[])
  if(item?.type==='message')for(const piece of item.content||[])
   if(piece?.type==='output_text'&&typeof piece.text==='string')texts.push(piece.text);
 if(texts.length!==1)fail('AI_RESPONSE_TEXT_COUNT_INVALID');
 let parsed;try{parsed=JSON.parse(texts[0])}catch{fail('AI_JSON_INVALID')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('AI_JSON_SHAPE_INVALID');
 return parsed;
}
function assemble(response,{now=Date.now(),date=archive.kstDate(now)}={}){
 const {webCalls,found}=citations(response);
 if(webCalls<1||found.size<2)fail('AI_WEB_EVIDENCE_INSUFFICIENT');
 const ai=outputText(response);
 if(!Array.isArray(ai.sections)||ai.sections.length<6||ai.sections.length>9)fail('AI_SECTIONS_INVALID');
 const sources=[],ids=new Map(),sections=[];
 for(const part of ai.sections){
  if(!kinds.includes(part?.kind)||typeof part.heading!=='string'||typeof part.body!=='string'||
     !Array.isArray(part.sourceUrls)||!part.sourceUrls.length||part.sourceUrls.length>6)
    fail('AI_SECTION_INVALID');
  const refs=[];
  for(const raw of part.sourceUrls){
   const url=safeSource(raw);
   if(!url||!found.has(url))fail('AI_CITATION_NOT_IN_WEB_SEARCH');
   if(!ids.has(url)){
    if(sources.length>=30)fail('AI_SOURCE_LIMIT');
    const id='web'+String(sources.length+1);
    ids.set(url,id);
    sources.push({id,title:('웹 검색 결과 · '+new URL(url).hostname).slice(0,180),url,publishedAt:null});
   }
   refs.push(ids.get(url));
  }
  sections.push({kind:part.kind,heading:part.heading,body:part.body,sourceIds:[...new Set(refs)]});
 }
 if(ids.size<2)fail('AI_DISTINCT_SOURCES_INSUFFICIENT');
 const record={schemaVersion:1,date,origin:'openai-api',
  visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  title:ai.title,generatedAt:now,retrievedAt:now,observedAt:null,
  rawText:null,sections,sources};
 const result=transfer.exportJSON([record],{now});
 if(!result.ok)fail('AI_RECORD_REJECTED_'+result.code);
 return JSON.parse(result.json).records[0];
}
function readPrevious(file,now){
 if(!fs.existsSync(file))return [];
 const json=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=archive.parseFeed(json,{now});
 if(!result.ok)fail('EXISTING_FEED_INVALID_'+result.code);
 return result.records;
}
function nextFeed(existing,record,now){
 const merged=archive.archive(existing,record,{now});
 if(!merged.ok)fail('ARCHIVE_MERGE_FAILED_'+merged.code);
 const checked=transfer.exportJSON(merged.records,{now});
 if(!checked.ok)fail('PUBLIC_FEED_REJECTED_'+checked.code);
 return {type:'public-briefing-feed-v1',schemaVersion:1,records:JSON.parse(checked.json).records};
}
async function generate({key,fetcher=globalThis.fetch,now=Date.now(),existing=[],force=false}={}){
 const date=archive.kstDate(now);
 if(!force&&existing.some(r=>r.date===date&&r.origin==='openai-api'))
  return {status:'SKIPPED_EXISTING',feed:null};
 if(typeof key!=='string'||key.length<15)fail('OPENAI_API_KEY_NOT_CONFIGURED');
 if(typeof fetcher!=='function')fail('FETCH_UNAVAILABLE');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),135000);
 let response;
 try{
  response=await fetcher(ENDPOINT,{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify(requestBody(date)),signal:controller.signal
  });
 }finally{clearTimeout(timer)}
 if(!response?.ok)fail('OPENAI_API_HTTP_FAILURE');
 let payload;try{payload=await response.json()}catch{fail('OPENAI_API_RESPONSE_INVALID')}
 const record=assemble(payload,{now,date});
 return {status:'GENERATED',feed:nextFeed(existing,record,now),date};
}
async function main(){
 const args=process.argv.slice(2),idx=args.indexOf('--output');
 if(idx<0||idx+1>=args.length||args.length>3||
    (args.length===3&&args[2]!=='--force'))fail('OUTPUT_ARGUMENT_REQUIRED');
 const output=path.resolve(args[idx+1]),now=Date.now();
 if(path.basename(output)!=='myinvest-public-briefings-v1.json')fail('WRONG_PUBLIC_FEED_PATH');
 const existing=readPrevious(output,now);
 const result=await generate({key:process.env.OPENAI_API_KEY,now,existing,force:args.includes('--force')});
 if(result.status==='SKIPPED_EXISTING'){process.stdout.write('SKIPPED_EXISTING: current KST day already published\n');return}
 const outputText=JSON.stringify(result.feed,null,2)+'\n';
 // Fail closed before any replacement. Never log API payload or account details.
 const check=archive.parseFeed(result.feed,{now});
 if(!check.ok)fail('FEED_VALIDATION_FAILED');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const temp=output+'.tmp-'+process.pid;
 try{fs.writeFileSync(temp,outputText,{mode:0o600,flag:'wx'});fs.renameSync(temp,output)}
 catch(e){try{fs.unlinkSync(temp)}catch{}throw e}
 process.stdout.write('PASS: new public-market-only AI briefing file validated\n');
}
if(require.main===module){
 main().catch(error=>{
  const code=/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'AI_GENERATION_FAILED';
  process.stderr.write('NOT_PUBLISHED: '+code+'\n');process.exitCode=1;
 });
}
module.exports={requestBody,citations,outputText,assemble,nextFeed,readPrevious,generate};
