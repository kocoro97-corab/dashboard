'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash,webcrypto}=require('node:crypto');
if(!globalThis.crypto?.subtle)Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const api=require('../js/private-original-briefing.js');
const text='# 2026-11-26 원문\n<Cite refs={["raw"]}/>\n**원문 표기**\n';
const date='2026-11-26',hash=createHash('sha256').update(text).digest('hex');
const fixture={success:true,schemaVersion:1,private:true,cacheable:false,dates:['2026-11-26','2026-11-25'],
 latestDate:date,report:{date,content:text,contentSha256:hash,origin:'scheduled-task-archive-unverified',
  format:'verbatim-text',savedAt:Date.parse('2026-11-26T00:00:00Z')}};
test('private original receipt preserves exact string and verifies UTF-8 SHA256',async()=>{
 const r=api.validate(fixture);
 assert.equal(r.report.content,text);
 assert.equal(await api.verifyText(r.report.content,r.report.sha256),true);
 assert.equal(await api.verifyText(text+'!',hash),false);
});
test('rejects spoofed, malformed, future or oversized private data contracts',()=>{
 assert.equal(api.validate({...fixture,private:false}),null);
 assert.equal(api.validate({...fixture,cacheable:true}),null);
 assert.equal(api.validate({...fixture,dates:['2026-11-25','2026-11-26']}),null);
 assert.equal(api.validate({...fixture,report:{...fixture.report,origin:'openai-api'}}),null);
 assert.equal(api.validate({...fixture,report:{...fixture.report,content:'x'.repeat(280001)}}),null);
 assert.equal(api.validate({...fixture,report:{...fixture.report,savedAt:Date.now()+3600000}}),null);
 assert.equal(api.validDay('2026-02-30'),false);
 assert.equal(api.validDay('../../secrets'),false);
});
test('private report view is disabled until independently opted-in dev relay, never auto public',()=>{
 const prior=globalThis.MYINVEST_TRANSPORT_CONFIG,transport=globalThis.DashboardTransport;
 globalThis.MYINVEST_TRANSPORT_CONFIG={mode:'relay',devSession:true,privateBriefings:false};
 globalThis.DashboardTransport={isRelay:()=>true};
 try{
  assert.equal(api.available(),false);
  globalThis.MYINVEST_TRANSPORT_CONFIG.privateBriefings=true;
  assert.equal(api.available(),true);
  globalThis.MYINVEST_TRANSPORT_CONFIG.mode='direct';
  assert.equal(api.available(),false);
 }finally{
  if(prior===undefined)delete globalThis.MYINVEST_TRANSPORT_CONFIG;else globalThis.MYINVEST_TRANSPORT_CONFIG=prior;
  if(transport===undefined)delete globalThis.DashboardTransport;else globalThis.DashboardTransport=transport;
 }
});
