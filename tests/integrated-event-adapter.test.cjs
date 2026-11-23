'use strict';
const assert=require('node:assert/strict');
const A=require('../js/integrated-event-adapter.js');
const coverage={BLS:true,BEA:true,BOK_STAT:true,EARNINGS:true,FED:true,BOK_MPC:true};
const events=[
 {id:'bls1',publisher:'BLS',category:'macro',date:'2026-11-25',sourceUrl:'https://www.bls.gov/release.ics',verified:true,type:'CPI'},
 {id:'fed1',publisher:'FED',category:'policy',date:'2026-11-27',sourceUrl:'https://www.federalreserve.gov/',verified:true,type:'FOMC_DECISION'},
 {id:'earn1',publisher:'EARNINGS',category:'earnings',date:'2026-11-26',sourceUrl:'https://www.sec.gov/',verified:true,dateStatus:'confirmed',type:'earnings',symbol:'SERV',market:'US'},
 {id:'earn2',publisher:'EARNINGS',category:'earnings',date:'2026-11-26',sourceUrl:'https://www.sec.gov/',verified:true,dateStatus:'confirmed',type:'earnings',symbol:'SPCH',market:'US'},
 {id:'earn3',publisher:'EARNINGS',category:'earnings',date:'2026-11-29',sourceUrl:'https://www.sec.gov/',verified:false,dateStatus:'estimated',type:'earnings',symbol:'SERV',market:'US'},
 {id:'private',publisher:'GOOGLE',category:'googlePersonal',date:'2026-11-30',sourceUrl:'https://calendar.google.com',verified:true,type:'private'},
 {id:'duplicate',publisher:'BLS',category:'macro',date:'2026-11-25',sourceUrl:'https://www.bls.gov/release.ics',verified:true,type:'CPI'}
];
const input={symbol:'SERV',market:'US',asOf:'2026-11-23',mode:'swing'};
const result=A.eventsFromPublicContext({coverage,events},input);
assert.equal(result.status,'ready');
assert.equal(result.coverageVerified,true);
assert.equal(result.events.length,3,'exactly 2 economic + 1 held symbol confirmed earnings');
assert.equal(result.events.some(e=>e.kind==='earnings'&&e.symbol==='SERV'),true);
assert.equal(result.events.some(e=>e.symbol==='SPCH'),false);
assert.equal(result.events.some(e=>e.type==='private'),false);
const missing=A.eventsFromPublicContext({coverage:{...coverage,EARNINGS:false},events},input);
assert.equal(missing.status,'partial');
assert.equal(missing.coverageVerified,false);
assert.equal(missing.missingSources[0],'EARNINGS');
assert.equal(A.eventsFromPublicContext(null,input).status,'unavailable');
assert.equal(A.eventsFromPublicContext({coverage,events},{...input,asOf:'2026-99-99'}).status,'unavailable');
const poison=A.eventsFromPublicContext({coverage,events:[{...events[0],sourceUrl:'http://invalid.example'}]},input);
assert.equal(poison.events.length,0);
console.log('Integrated public event adapter PASS');
