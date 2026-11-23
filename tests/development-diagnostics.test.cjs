'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../js/development-diagnostics.js');
function fixture(){let token='a'.repeat(64),page='strategy',now=1795334400000;const hub=create({token:()=>token,currentPage:()=>page,now:()=>now});return {hub,setToken:v=>token=v,setPage:v=>page=v,tick:()=>now++}}
test('unvisited modules and unchecked data are never automatic PASS',()=>{const {hub}=fixture();const s=hub.snapshot();assert.equal(s.pages.length,9);assert.ok(s.pages.every(r=>r.status==='NOT_VISITED'));assert.ok(s.checks.every(r=>r.status===(r.collectorConnected?'NOT_RUN':'NOT_CONNECTED')));assert.equal(s.coverage,'OBSERVED_EVENTS_ONLY_UNVISITED_ARE_NOT_TESTED')});
test('whitelisted evidence strips tokens, prices, IDs, URLs, error messages and unknown codes',()=>{
 const {hub}=fixture();hub.note({code:'PRIVATE_VALUE',page:'PRIVATE_VALUE',layer:'PRIVATE_VALUE',body:{account:'PRIVATE_VALUE'},message:'PRIVATE_VALUE',token:'PRIVATE_VALUE',id:'PRIVATE_VALUE',context:'PRIVATE_VALUE',http:'PRIVATE_VALUE'});const json=JSON.stringify(hub.snapshot());assert.ok(!json.includes('PRIVATE_VALUE'));assert.ok(!json.includes('a'.repeat(64)));assert.equal(hub.snapshot().issues[0].code,'UNCLASSIFIED_DIAGNOSTIC');assert.equal(hub.snapshot().issues[0].layer,'unknown');
});
test('read histories retain originating modules and resolve only the cleared slot',()=>{
 const f=fixture();f.hub.readIssue({diagnosticSlot:1,scope:'account',code:'AUTH_REQUIRED',http:401});f.setPage('market');f.hub.readIssue({diagnosticSlot:2,scope:'public',code:'READ_NETWORK',http:502});f.hub.syncReads([{diagnosticSlot:1}]);const rows=f.hub.snapshot().issues;assert.equal(rows[0].page,'strategy');assert.equal(rows[0].active,true);assert.equal(rows[1].page,'market');assert.equal(rows[1].status,'RECOVERED');
});
test('page readiness is distinct from data verification and route errors recover by a successful remount',()=>{
 const {hub}=fixture();hub.pageResult('market','error');assert.equal(hub.snapshot().issues[0].active,true);hub.pageResult('market','ready');assert.equal(hub.snapshot().issues[0].active,false);assert.equal(hub.snapshot().pages.find(p=>p.page==='market').status,'ready');assert.ok(hub.snapshot().checks.every(r=>r.status===(r.collectorConnected?'NOT_RUN':'NOT_CONNECTED')));
});
test('positive checks require the registered AAPL evidence contract; unsupported checks remain unverified',()=>{
 const {hub}=fixture();hub.verification('aapl5m',{status:'PASS',code:'REFERENCE_VALIDATED',token:'PRIVATE_VALUE'});assert.equal(hub.snapshot().checks[0].status,'FAIL');hub.verification('aapl5m',{mode:'BROWSER_OBSERVED_AAPL_5M_REFERENCE',serverCapabilityObserved:true,status:'PASS',phase:'VALIDATION',code:'REFERENCE_VALIDATED',bars:78,token:'PRIVATE_VALUE'});assert.equal(hub.snapshot().checks[0].status,'PASS');assert.equal(hub.snapshot().checks[0].independentTransportVerification,false);hub.verification('accountLive',{status:'PASS'});assert.equal(hub.snapshot().checks.find(r=>r.id==='accountLive').status,'FAIL');assert.ok(!JSON.stringify(hub.snapshot()).includes('PRIVATE_VALUE'));
});
test('quality checks group public reason counts without symbols or private names; scopes resolve independently',()=>{
 const {hub}=fixture();hub.quality('sectors',[{reason:'DATE_MISMATCH',symbol:'PRIVATE_VALUE'},{reason:'DATE_MISMATCH',symbol:'PRIVATE_VALUE'}],{market:'KR',category:'theme',period:'5d'});hub.quality('sectors',[{reason:'SERIES_UNAVAILABLE'}],{market:'US',category:'industry',period:'20d'});hub.quality('sectors',[],{market:'US',category:'industry',period:'20d'});const rows=hub.snapshot().issues;assert.equal(rows[0].count,2);assert.equal(rows[0].active,true);assert.equal(rows[1].active,false);assert.ok(!JSON.stringify(rows).includes('PRIVATE_VALUE'));
});
test('session switch and logout erase histories and positive checks',()=>{
 const f=fixture();f.hub.note({code:'SCRIPT_ERROR'});f.setToken(null);assert.equal(f.hub.snapshot().authenticated,false);assert.equal(f.hub.snapshot().issues.length,0);f.setToken('b'.repeat(64));assert.ok(f.hub.snapshot().pages.every(r=>r.status==='NOT_VISITED'));assert.ok(f.hub.snapshot().checks.every(r=>r.status===(r.collectorConnected?'NOT_RUN':'NOT_CONNECTED')));
});
test('diagnostics are bounded to a hundred distinct items and never infer a server from HTTP alone',()=>{
 const {hub}=fixture();for(let i=100;i<220;i++)hub.note({code:'READ_NETWORK',http:i});assert.equal(hub.snapshot().issues.length,100);assert.ok(hub.snapshot().issues.every(r=>r.layer==='unknown'));
});
test('only the explicit development build adds the diagnostic route',()=>{
 const source=fs.readFileSync('js/app-router.js','utf8');for(const enabled of [false,true]){const ctx=vm.createContext({MYINVEST_DEV_DIAGNOSTICS:enabled});vm.runInContext(source,ctx);assert.equal(ctx.AppRouter.validHash('#/diagnostics'),enabled);assert.equal(ctx.AppRouter.validHash('#/diagnostics?token=PRIVATE_VALUE'),false)}
});
test('pre-login runtime errors are safe and adopted once, never carried into a later login',()=>{
 const f=fixture();f.setToken(null);assert.equal(f.hub.runtime('SCRIPT_ERROR'),false);f.setToken('a'.repeat(64));assert.equal(f.hub.snapshot().issues[0].code,'SCRIPT_ERROR');f.setToken(null);f.hub.snapshot();f.hub.runtime('ASYNC_ERROR');f.setToken('b'.repeat(64));assert.equal(f.hub.snapshot().issues.length,0);
});
test('temporarily unavailable authentication or page state does not break error collection',()=>{
 const hub=create({token:()=>{throw Error('PRIVATE_VALUE')},currentPage:()=>{throw Error('PRIVATE_VALUE')}});assert.equal(hub.runtime('SCRIPT_ERROR'),false);assert.equal(hub.snapshot().authenticated,false);assert.ok(!JSON.stringify(hub.snapshot()).includes('PRIVATE_VALUE'));
});

test('execution states distinguish running, blocked, failed and cancelled from an unstarted check',()=>{
 const {hub}=fixture(),check=()=>hub.snapshot().checks.find(r=>r.id==='aapl5m');
 assert.equal(check().status,'NOT_RUN');
 for(const [status,phase,code] of [['RUNNING','CAPABILITY','CAPABILITY_REQUESTED'],['RUNNING','PUBLIC_READ','REFERENCE_REQUESTED'],['BLOCKED','CAPABILITY','RELAY_CAPABILITY_REQUIRED'],['FAIL','PUBLIC_READ','INTRADAY_READ_FAILED'],['CANCELLED','PUBLIC_READ','READ_CANCELLED']]){hub.verification('aapl5m',{status,phase,code,body:'PRIVATE_VALUE'});assert.equal(check().status,status);assert.equal(check().phase,phase);assert.equal(check().code,code);assert.equal(check().bars,undefined)}
 hub.verification('aapl5m',{status:'NOT_RUN',code:'RELAY_CAPABILITY_REQUIRED'});assert.equal(check().status,'BLOCKED');
 assert.ok(!JSON.stringify(hub.snapshot()).includes('PRIVATE_VALUE'));
});
test('a retry clears previous successful bar evidence while it runs and resets to unstarted after logout',()=>{
 const f=fixture();f.hub.verification('aapl5m',{mode:'BROWSER_OBSERVED_AAPL_5M_REFERENCE',serverCapabilityObserved:true,status:'PASS',phase:'VALIDATION',code:'REFERENCE_VALIDATED',bars:78});
 f.hub.verification('aapl5m',{status:'RUNNING',phase:'CAPABILITY',code:'CAPABILITY_REQUESTED'});assert.equal(f.hub.snapshot().checks[0].status,'RUNNING');assert.equal(f.hub.snapshot().checks[0].bars,undefined);
 f.setToken(null);f.hub.snapshot();f.setToken('b'.repeat(64));assert.equal(f.hub.snapshot().checks[0].status,'NOT_RUN');assert.equal(f.hub.snapshot().checks.filter(r=>r.status==='NOT_CONNECTED').length,4);
});
