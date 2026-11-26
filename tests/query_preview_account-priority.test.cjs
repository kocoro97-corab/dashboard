const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const host='https://example.test/api',token='a'.repeat(64),turn=()=>new Promise(r=>setImmediate(r));
function setup(){
 const flags={invest_is_admin:'true',invest_session_token:token,invest_password_change:false};
 const loc={origin:'https://kocoro97-corab.github.io',pathname:'/dashboard-v2-dev/',hash:'#/home',search:''};
 const active=[];
 const ctx={URL,Event,AbortController,clearTimeout,setTimeout,LS:key=>flags[key],location:loc,AppRouter:{validHash:()=>true},
 MYINVEST_PERSISTENT_RELAY:{endpoint:host},MYINVEST_TRANSPORT_CONFIG:{mode:'relay',endpoint:host,devSession:true,persistentRelay:true,accountReads:true,publicMarket:true},
 fetch:(_url,options)=>new Promise(resolve=>active.push({action:JSON.parse(options.body).action,options,finish:()=>resolve(Response.json({success:true}))}))};
 vm.runInNewContext(fs.readFileSync('js/transport.js','utf8'),ctx);return {api:ctx.DashboardTransport,loc,flags,active};
}
test('session-bound path is limited to signed-in admin general balance and never a write',()=>{
 const {api,flags,active}=setup();
 assert.throws(()=>api.post({action:'saveExternalHoldings',token},{sessionAccountRead:true}),/AUTH_REQUIRED/);
 flags.invest_is_admin='false';
 assert.throws(()=>api.post({action:'nhAccounts',token},{sessionAccountRead:true}),/AUTH_REQUIRED/);
 flags.invest_is_admin='true';flags.invest_password_change=true;
 assert.throws(()=>api.post({action:'nhAccounts',token},{sessionAccountRead:true}),/AUTH_REQUIRED/);
 assert.equal(active.length,0);
});
test('route switch joins private session read while freeing the other lane; full cancel blocks its delivery',async()=>{
 const {api,loc,flags,active}=setup();
 const nh=api.post({action:'nhAccounts',token},{sessionAccountRead:true}).catch(e=>e.code);
 await turn();
 assert.equal(active[0].action,'nhAccounts');
 assert.equal(active[0].options.cache,'no-store');
 loc.hash='#/strategy';api.cancelReads({keepAccountRead:true});
 const market=api.post({action:'publicFetch',token,url:'https://public.example/'});await turn();
 assert.equal(active[1].action,'publicFetch');
 active[1].finish();assert.equal((await market).ok,true);
 flags.invest_session_token=null;api.cancelReads();active[0].finish();
 assert.equal(await nh,'SESSION_CHANGED');
});
test('private request queued on another screen cannot overtake an ordinary visible request',async()=>{
 const {api,active}=setup(), visible=()=>api.post({action:'publicFetch',token});
 const first=visible(),second=visible();await turn();
 const queuedNh=api.post({action:'nhAccounts',token},{sessionAccountRead:true});
 const next=visible();await turn();
 assert.equal(active.length,2);
 active[0].finish();await first;await turn();
 assert.equal(active[2].action,'publicFetch');
 active[1].finish();active[2].finish();await Promise.all([second,next]);await turn();
 assert.equal(active[3].action,'nhAccounts');active[3].finish();await queuedNh;
});
test('warm balance and account page share one call and fresh cache, while force still refreshes',async()=>{
 const src=fs.readFileSync('js/market.js','utf8');
 const code=src.slice(src.indexOf('let NH_ACCOUNT_PENDING'),src.indexOf('async function fetchNHAccounts('));
 let calls=0,session=token;let finish;
 const realm={LS:()=>session,NH_ACCOUNT_SESSION:null,NH_ACCOUNT_FETCHED_AT:0,
 fetchNHAccounts:()=>{calls++;return new Promise(resolve=>{finish=()=>{realm.NH_ACCOUNT_SESSION=session;realm.NH_ACCOUNT_FETCHED_AT=Date.now();vm.runInContext('NH_ACCOUNT_CACHE_READY=true',realm);resolve(true)}})}};
 vm.createContext(realm);const load=vm.runInContext(code+'\nloadNHAccounts',realm);
 const warm=load({force:false,sessionRead:true});assert.equal(load({force:true}),warm);
 finish();await warm;assert.equal(await load({force:false,sessionRead:true}),true);assert.equal(calls,1);
 const redo=load();finish();await redo;assert.equal(calls,2);
 vm.runInContext('NH_ACCOUNT_CACHE_READY=false',realm);
 const afterPartial=load({force:false,sessionRead:true});finish();await afterPartial;assert.equal(calls,3);
 session=null;assert.equal(await load(),false);assert.equal(calls,3);
});
test('a warmed NH result cannot fan out into external account quote requests',()=>{
 const src=fs.readFileSync('js/external_accounts.js','utf8');
 const code=src.slice(src.indexOf('function extSyncWithNH'),src.indexOf('function parseExternalOcr'));
 let render=0,quotes=0;
 const run=vm.runInNewContext(code+'\nextSyncWithNH',{extResolveCodes(){},renderExternalAssets(){render++},EXT_PRICE_BUSY:false,
 EXT_ASSETS:[{match:{status:'matched'}}],refreshExternalPrices(){quotes++}});
 run({refreshPrices:false});assert.deepEqual({render,quotes},{render:1,quotes:0});
 run();assert.deepEqual({render,quotes},{render:2,quotes:1});
});
