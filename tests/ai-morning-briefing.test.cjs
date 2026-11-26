'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const g=require('../scripts/ai_morning_briefing.cjs');
const archive=require('../js/news-briefing-archive-v1.js');
const now=Date.parse('2026-11-25T22:10:00Z'),date='2026-11-26';
const A='https://www.federalreserve.gov/monetarypolicy.htm';
const B='https://www.nasdaq.com/market-activity';
function result({sections,search=true,urls=[A,B],status='completed'}={}){
 const data={title:'2026-11-26 공개시장 AI 뉴스·투자 전략',
  sections:sections||['us-market','kr-market','rates-fx','news','sectors','swing'].map((kind,i)=>({
   kind,heading:'검증된 공개시장 관찰 '+i,
   body:'시장 관측 자료의 한계가 있어 미확인 가격은 표시하지 않습니다.',
   sourceUrls:[urls[i%urls.length]]
  }))};
 return {status,output:[...(search?[{type:'web_search_call',action:{sources:urls.map(url=>({url}))}}]:[]),
  {type:'message',content:[{type:'output_text',text:JSON.stringify(data),annotations:[]}]}]};
}
test('server request uses paid web search and structured public-only brief, not user's scheduled ChatGPT task',()=>{
 const r=g.requestBody(date);
 assert.equal(r.store,false);
 assert.deepEqual(r.tools,[{type:'web_search'}]);
 assert.ok(r.text?.format?.strict);
 assert.equal(r.model,'gpt-5.4-mini');
 assert.match(r.input[0].content,/계좌/);
 assert.ok(!JSON.stringify(r).includes('access_token'));
});
test('AI-generated record is sourced from actual response web search and validated in existing public archive',()=>{
 const record=g.assemble(result(),{now,date});
 assert.equal(record.origin,'openai-api');
 assert.equal(record.scheduleLocal,'07:00');
 assert.equal(record.observedAt,null);
 assert.equal(record.generatedAt,now);
 assert.equal(record.sections.length,6);
 assert.equal(record.sources.length,2);
 assert.ok(record.sections.every(s=>s.sourceIds.length));
 const feed=g.nextFeed([],record,now);
 assert.equal(feed.type,'public-briefing-feed-v1');
 assert.equal(archive.parseFeed(feed,{now}).ok,true);
});
test('fail closed without a web search, credible citations or when invented citation was supplied',()=>{
 assert.throws(()=>g.assemble(result({search:false}),{now,date}),/AI_WEB_EVIDENCE_INSUFFICIENT/);
 assert.throws(()=>g.assemble(result({urls:[A]}),{now,date}),/AI_WEB_EVIDENCE_INSUFFICIENT/);
 const forged=result();forged.output[1].content[0].text=JSON.stringify({
  title:'Forger',sections:JSON.parse(forged.output[1].content[0].text).sections.map(s=>({...s,sourceUrls:['https://unverified.example.com/']}))
 });
 assert.throws(()=>g.assemble(forged,{now,date}),/AI_CITATION_NOT_IN_WEB_SEARCH/);
});
test('no personal or private account info can be published even if AI returned it',()=>{
 const forged=result();const data=JSON.parse(forged.output[1].content[0].text);
 data.sections[0].body='계좌번호: 12345678';
 forged.output[1].content[0].text=JSON.stringify(data);
 assert.throws(()=>g.assemble(forged,{now,date}),/AI_RECORD_REJECTED_/);
});
test('one AI request per KST day; absent API key prevents network, all failed generations preserve existing archive',async()=>{
 const record=g.assemble(result(),{now,date});
 const existing=g.nextFeed([],record,now).records;
 let called=0;
 const fetcher=async(_url,opts)=>{called++;assert.ok(opts.headers.Authorization.startsWith('Bearer '));return {ok:true,json:async()=>result()}};
 const skipped=await g.generate({key:'dummy-secret-for-synthetic-testing',now,existing,fetcher});
 assert.equal(skipped.status,'SKIPPED_EXISTING');assert.equal(called,0);
 const generated=await g.generate({key:'dummy-secret-for-synthetic-testing',now,existing:[],fetcher});
 assert.equal(generated.status,'GENERATED');assert.equal(called,1);
 assert.equal(archive.parseFeed(generated.feed,{now}).ok,true);
 await assert.rejects(()=>g.generate({key:'',now,existing:[],fetcher}),/OPENAI_API_KEY_NOT_CONFIGURED/);
 assert.equal(called,1);
});
