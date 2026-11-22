'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Setup=require('../js/invest-calendar-google-oauth-setup-v1.js');
const VALID='123456789012-abcdefghijklm123456789.apps.googleusercontent.com';

function mockHost({sdkLoaded=false,failLoad=false}={}){
 const tags=[];
 const fake={createElement:name=>{
  assert.equal(name,'script');
  return {tagName:'SCRIPT',removed:false,remove(){this.removed=true}};
 },getElementById:()=>tags.find(x=>x.id==='myinvest-gsi-oauth-v1'&&!x.removed)||null,
 head:{appendChild(tag){
  tags.push(tag);
  if(!failLoad){
   queueMicrotask(()=>{
    root.google={accounts:{oauth2:{
     initTokenClient(){throw Error('consent should never start during setup')},
     revoke(){} }}};
    tag.onload?.();
   });
  }else queueMicrotask(()=>tag.onerror?.());
 }}};
 const root={document:fake};
 if(sdkLoaded)root.google={accounts:{oauth2:{initTokenClient(){}}}};
 return {root,tags,doc:fake};
}
test('the Google browser script is never injected before an explicit prepare',()=>{
 const x=mockHost();const a=Setup.create({host:x.root});
 assert.equal(a.status().hasClientId,false);
 assert.equal(a.status().consentGranted,false);
 assert.equal(x.tags.length,0);
});
test('only correctly formed public Web OAuth client IDs are accepted',()=>{
 assert.equal(Setup.validateClientId(VALID),true);
 for(const invalid of [
  '',null,undefined,'secret','anything@google.com',
  '123-abc.apps.googleusercontent.com',
  '123456789012-Abcd.apps.googleusercontent.com',
  'https://accounts.google.com/','123456789012-abcd.apps.googleusercontent.com#fragment',
  '123456789012-abcdefghijklm123456789.apps.googleusercontent.com?key=secret'
 ])assert.equal(Setup.validateClientId(invalid),false,String(invalid));
});
test('invalid value fails without SDK fetch or credential exposure',async()=>{
 const x=mockHost();const a=Setup.create({host:x.root});
 const e=await a.prepare('client_secret').catch(e=>e);
 assert.equal(e.code,'GOOGLE_PUBLIC_WEB_CLIENT_ID_INVALID');
 assert.equal(x.tags.length,0);
 assert.equal(a.status().configured,false);
 assert.ok(!String(e).includes('client_secret'));
});
test('valid ID causes one well-known HTTPS SDK request only, not OAuth consent',async()=>{
 const x=mockHost();const a=Setup.create({host:x.root});
 const result=await a.prepare(VALID);
 assert.equal(x.tags.length,1);
 assert.equal(x.tags[0].src,'https://accounts.google.com/gsi/client');
 assert.equal(x.tags[0].async,true);
 assert.equal(x.tags[0].referrerPolicy,'no-referrer');
 assert.equal(result.ready,true);
 assert.equal(result.consentGranted,false);
 assert.equal(a.status().configured,true);
 assert.equal(a.status().sdkReady,true);
 assert.equal(a.status().storage,'memory-only');
});
test('re-preparing after SDK loaded does not perform a duplicate network request',async()=>{
 const x=mockHost();const a=Setup.create({host:x.root});
 await a.prepare(VALID);
 const again=await a.prepare(VALID);
 assert.equal(again.ready,true);
 assert.equal(x.tags.length,1);
});
test('SDK already available from build-time public ID skips a network request',async()=>{
 const x=mockHost({sdkLoaded:true}),a=Setup.create({host:x.root});
 const result=await a.prepare(VALID);
 assert.equal(result.ready,true);
 assert.equal(x.tags.length,0);
});
test('SDK load errors discard client identity and allow explicit retry',async()=>{
 const x=mockHost({failLoad:true}),a=Setup.create({host:x.root});
 const e=await a.prepare(VALID).catch(e=>e);
 assert.equal(e.code,'GOOGLE_SDK_LOAD_FAILED');
 assert.equal(x.tags[0].removed,true);
 assert.equal(a.status().configured,false);
 assert.equal(x.root.google,undefined);
});
test('concurrent prepare attempts cannot mutate a pending identifier',async()=>{
 let sdkTag=null;
 const root={document:{createElement:()=>({remove(){}}),getElementById:()=>null,
  head:{appendChild:s=>{sdkTag=s}}}};
 const a=Setup.create({host:root});
 const first=a.prepare(VALID);
 const rejected=await a.prepare(VALID).catch(e=>e);
 assert.equal(rejected.code,'GOOGLE_SDK_PREPARE_IN_PROGRESS');
 root.google={accounts:{oauth2:{initTokenClient(){}}}};
 sdkTag.onload();
 assert.equal((await first).ready,true);
});
test('closing a page session resets public client ID without storing credentials',async()=>{
 const x=mockHost(),a=Setup.create({host:x.root});
 await a.prepare(VALID);
 a.reset();
 const state=a.status();
 assert.equal(state.configured,false);
 assert.equal(state.hasClientId,false);
 assert.equal(state.consentGranted,false);
 assert.ok(!Object.keys(a).includes('clientId'));
});
test('OAuth setup source never writes storage, logs credentials or starts consent',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/invest-calendar-google-oauth-setup-v1.js'),'utf8');
 for(const forbidden of ['localStorage','sessionStorage','console.log',
 'PropertiesService','devAccessCode','NH_ACCOUNT','requestAccessToken(', 'fetch(',
 'client_secret=', 'refresh_token'])
  assert.equal(source.includes(forbidden),false,forbidden);
 assert.ok(source.includes('https://accounts.google.com/gsi/client'));
});
