'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({development=true,duration=3600000,path='/dashboard-v2-dev/index.html'}={}){
 let now=Date.parse('2026-11-22T00:00:00Z'),last=now,session='a'.repeat(64),logout=0,starts=0,transport=null;
 const props=new Map(),timers=new Map(),calls=[];let serial=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const server=vm.createContext({Date:Clock,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})}});
 vm.runInContext(fs.readFileSync('gas/Security.gs','utf8'),server);server.securityFindUser_=()=>({row:['synthetic','','approved','false']});
 function store(){props.set('S_'+session,JSON.stringify({u:'synthetic',t:now,c:now,v:2,p:false}))}store();
 const config={mode:'relay',devSession:development,endpoint:'https://myinvest-v2-dev-relay.synthetic.workers.dev/api'};
 const ctx=vm.createContext({Date:Clock,AbortController,SESSION_MS:duration,MYINVEST_TRANSPORT_CONFIG:config,MYINVEST_PERSISTENT_RELAY:{profile:'isolated',endpoint:config.endpoint},location:{origin:'https://kocoro97-corab.github.io',pathname:path,search:''},document:{getElementById:()=>({style:{display:'block'}})},LS:k=>k==='invest_session_token'?session:null,sessionLeftMs:()=>duration-(now-last),startSessionTimer(fresh){starts++;if(fresh)last=now},logout(){logout++;props.delete('S_'+session);session=null},showPasswordChange(){throw Error('UNEXPECTED_PASSWORD_CHANGE')},setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:now+delay});return id},clearTimeout(id){timers.delete(id)},DashboardTransport:{post:async(body,options)=>{calls.push(body.action);if(transport)return transport(body,options);return {ok:true,json:async()=>({success:!!server.securitySession_(body.token)})}}}});ctx.window=ctx;
 const original=ctx.startSessionTimer;vm.runInContext(fs.readFileSync('js/dev_session.js','utf8'),ctx);
 async function advance(ms){const target=now+ms;for(;;){const row=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!row||row[1].at>target)break;now=row[1].at;timers.delete(row[0]);await row[1].fn()}now=target}
 return {ctx,calls,props,timers,original,advance,server,get now(){return now},get last(){return last},get session(){return session},get logout(){return logout},get starts(){return starts},touch(){last=now},transport(fn){transport=fn},login(){session='b'.repeat(64);store();ctx.startSessionTimer(true)}};
}
test('one-hour browser inactivity survives the unchanged GAS five-minute idle window without automatic user activity',async()=>{
 const f=fixture();f.ctx.startSessionTimer(true);const last=f.last;await f.advance(3599999);
 assert.equal(f.logout,0);assert.equal(f.calls.length,29);assert.equal(f.last,last);assert.equal(f.starts,1);
 assert.ok(f.server.securitySession_(f.session));await f.advance(1);assert.equal(f.logout,1);assert.equal(f.timers.size,0);
});
test('operating route, operating config and original five-minute duration receive no wrapper or timer',()=>{
 for(const options of [{development:false},{path:'/dashboard/index.html'},{duration:300000}]){const f=fixture(options);assert.equal(f.ctx.startSessionTimer,f.original);assert.equal(f.ctx.DevelopmentSession,undefined);assert.equal(f.timers.size,0)}
});
test('revoked server session wins over the one-hour display',async()=>{const f=fixture();f.ctx.startSessionTimer(true);f.props.clear();await f.advance(120000);assert.equal(f.logout,1);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)});
test('network or malformed response closes the session with no retries or password replay',async()=>{
 for(const transport of [async()=>{throw Error('PRIVATE_ERROR')},async()=>({ok:true,json:async()=>{throw Error('INVALID_JSON')}})]){const f=fixture();f.transport(transport);f.ctx.startSessionTimer(true);await f.advance(120000);assert.equal(f.logout,1);assert.deepEqual(f.calls,['sessionInfo']);assert.equal(f.timers.size,0)}
});
test('logout cancels the timer immediately and no background renewal follows',async()=>{const f=fixture();f.ctx.startSessionTimer(true);f.ctx.logout();await f.advance(3600000);assert.equal(f.calls.length,0);assert.equal(f.timers.size,0)});
test('late failure from an old session cannot log out a newer login',async()=>{
 const f=fixture();let finish;f.transport(()=>new Promise(resolve=>finish=resolve));f.ctx.startSessionTimer(true);const pending=f.advance(120000);await Promise.resolve();f.ctx.logout();f.login();finish({ok:false,json:async()=>({success:false})});await pending;assert.equal(f.logout,1);assert.equal(f.session,'b'.repeat(64));assert.equal(f.ctx.DevelopmentSession.getStatus().scheduled,true);
});
test('existing eight-hour absolute GAS expiry is never extended by renewal or user activity',async()=>{
 const f=fixture();f.ctx.startSessionTimer(true);for(let i=0;i<17&&f.logout===0;i++){f.touch();await f.advance(30*60000)}assert.equal(f.logout,1);assert.equal(f.timers.size,0);assert.ok(f.calls.every(a=>a==='sessionInfo'));
});
test('server password-change requirement stops renewal and preserves the existing password guard',async()=>{
 const f=fixture();let guards=0;f.ctx.showPasswordChange=()=>guards++;f.transport(async()=>({ok:true,json:async()=>({success:true,mustChangePassword:true})}));f.ctx.startSessionTimer(true);await f.advance(120000);assert.equal(guards,1);assert.equal(f.logout,0);assert.equal(f.timers.size,0);
});
test('an unresponsive session check times out and cannot keep the display authenticated indefinitely',async()=>{
 const f=fixture();f.transport((body,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('TIMEOUT')))));f.ctx.startSessionTimer(true);const pending=f.advance(120000);await Promise.resolve();await f.advance(15000);await pending;assert.equal(f.logout,1);assert.equal(f.timers.size,0);
});
