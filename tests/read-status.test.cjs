const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({setTimer=fn=>{fn()},clearTimer=()=>{}}={}){const ctx=vm.createContext({Event,Date,clearTimeout:clearTimer,setTimeout:setTimer,dispatchEvent(){}});vm.runInContext(fs.readFileSync('js/read-status.js','utf8'),ctx);return ctx.ReadStatus}
test('transient public error retries once with shared pending request then clears on recovery',async()=>{const api=setup();let calls=0,release;const op=()=>{calls++;return calls===1?Promise.reject({http:503,code:'RELAY_BUSY'}):new Promise(r=>release=r)},a=api.execute('A',op),b=api.execute('A',op);await new Promise(r=>setImmediate(r));assert.equal(calls,2);assert.equal(api.snapshot()[0].attempts,1);release('OK');assert.equal(await a,'OK');assert.equal(await b,'OK');assert.equal(api.snapshot().length,0)});
test('access/format faults do not retry; HTTP alone does not identify a failing server',async()=>{for(const error of [{http:401},{http:403},{code:'READ_FORMAT'}]){const api=setup();let calls=0;await assert.rejects(api.execute('A',async()=>{calls++;throw error}));assert.equal(calls,1);assert.equal(api.snapshot()[0].layer,'unknown')}const api=setup();let calls=0;await assert.rejects(api.execute('A',async()=>{calls++;throw {http:502}}));assert.equal(calls,3);assert.equal(api.snapshot()[0].layer,'unknown')});
test('GAS/NH/timeouts/network are distinct; diagnostic snapshot excludes raw replies and secrets',()=>{const api=setup();for(const [code,type,layer] of [['GAS_REJECTED','GAS','gas'],['NH_HTTP','NH','nh'],['READ_TIMEOUT','TIMEOUT','unknown'],['READ_NETWORK','NETWORK','unknown']]){const safe=api.classify({code,verifiedLayer:layer,body:'SECRET',token:'SECRET',account:'SYNTHETIC'});assert.equal(safe.type,type);assert.equal(safe.layer,layer);assert.ok(safe.id&&Date.parse(safe.at));assert.ok(!JSON.stringify(safe).includes('SECRET'))}});
test('public recovery does not erase account error; obsolete session never paints errors',async()=>{const api=setup();api.note({code:'AUTH_REQUIRED',http:401},{key:'account:X',scope:'account'});api.note({code:'READ_NETWORK'},{key:'A'});await api.execute('A',async()=>1);assert.equal(api.snapshot().length,1);assert.equal(api.snapshot()[0].scope,'account');let active=true,release;const pending=api.execute('B',()=>new Promise(r=>release=r),{current:()=>active});active=false;release(1);await assert.rejects(pending);assert.equal(api.snapshot().length,1)});
test('new NH transport faults distinguish timeout and format without inferring an upstream cause',()=>{const api=setup();for(const [code,type,layer] of [['NH_TIMEOUT','TIMEOUT','browser'],['NH_NETWORK_ERROR','NETWORK','browser'],['NH_RESPONSE_INVALID','FORMAT','relay'],['NH_DATA_INVALID','FORMAT','unknown']]){const safe=api.classify({code,verifiedLayer:layer});assert.equal(safe.type,type);assert.equal(safe.layer,layer)}});

test('backoff grows with jitter and honors seconds or HTTP-date Retry-After',()=>{
 const api=setup(),now=Date.UTC(2026,10,21);
 assert.equal(api.retryDelay({},1,now,0),1000);assert.equal(api.retryDelay({},2,now,0),2000);assert.equal(api.retryDelay({},2,now,1),2500);
 assert.equal(api.retryDelay({retryAfter:'5'},1,now,0),5000);
 assert.equal(api.retryDelay({retryAfter:new Date(now+9000).toUTCString()},1,now,0),9000);
 assert.equal(api.retryDelay({retryAfter:'invalid'},1,now,0),1000);
});
test('503 stops after three reads; a long Retry-After fails safely without premature replay',async()=>{
 const api=setup();let calls=0;await assert.rejects(api.execute('bounded',async()=>{calls++;throw {http:503,code:'RELAY_BUSY'}}));assert.equal(calls,3);
 calls=0;await assert.rejects(api.execute('long',async()=>{calls++;throw {http:503,code:'RELAY_BUSY',retryAfter:'60'}}));assert.equal(calls,1);
});
test('aborting during backoff cancels the timer without retry or cancellation diagnostics',async()=>{
 const timers=new Map();let next=0,calls=0;const api=setup({setTimer:fn=>{timers.set(++next,fn);return next},clearTimer:id=>timers.delete(id)}),controller=new AbortController();
 const job=api.execute('abort',async()=>{calls++;throw {http:503,code:'RELAY_BUSY'}},{signal:controller.signal});const result=assert.rejects(job);await new Promise(r=>setImmediate(r));controller.abort();await result;assert.equal(calls,1);assert.equal(timers.size,0);assert.equal(api.snapshot()[0].code,'RELAY_BUSY');
});

test('isolation and permission faults never retry even if the HTTP response is 503',async()=>{
 for(const code of ['RELAY_TARGET_MISMATCH','RELAY_ACCESS_CLOSED','RELAY_PUBLIC_URL_DENIED']){const api=setup();let calls=0;await assert.rejects(api.execute(code,async()=>{calls++;throw {http:503,code}}));assert.equal(calls,1)}
});
