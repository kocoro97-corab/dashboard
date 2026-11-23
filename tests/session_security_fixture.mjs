/* Synthetic-only bridge fixture executing checked-in GAS session validation. */
import vm from 'node:vm';
import fs from 'node:fs';
export function createSessionSecurity(){
 let now=0;const props=new Map();
 class Clock extends Date{static now(){return now}}
 const ctx=vm.createContext({Date:Clock,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},Utilities:{getUuid:()=> 'a'.repeat(32)}});
 vm.runInContext(fs.readFileSync('gas/Security.gs','utf8'),ctx);
 ctx.securityFindUser_=()=>({row:['synthetic','','approved','true']});ctx.securityEnvironmentSessionIdleMs_=()=>3600000;ctx.purgeSessions_=()=>{};
 const policy={developmentSessionPolicyVersion:1,sessionIdleMs:3600000,sessionAbsoluteMs:28800000};
 return {policy,setTime(value){if(!Number.isSafeInteger(value)||value<=0)throw Error('INVALID_TEST_SESSION_TIME');now=Math.max(now,value)},login(){return ctx.securityCreateSession_('synthetic',false)},valid:t=>!!ctx.securitySession_(t),logout(t){props.delete('S_'+t)}};
}
