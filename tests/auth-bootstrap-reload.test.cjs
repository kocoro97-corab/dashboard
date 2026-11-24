'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const authSource=fs.readFileSync('js/auth.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(readyState){
  const listeners=new Map(),requests=[],nodes=new Map(),storage=new Map([
    ['invest_session_token',JSON.stringify('synthetic-session')],
    ['invest_last_active',String(Date.now())]
  ]);
  const localStorage={
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      id,dataset:{},style:{display:''},value:'',
      addEventListener(){},classList:{add(){},remove(){}},replaceChildren(){}
    });
    return nodes.get(id);
  }
  const document={
    readyState,getElementById:node,
    addEventListener:(name,fn)=>listeners.set(name,fn)
  };
  const window={addEventListener(){}};
  const fetch=(url,opts)=>{
    const request=JSON.parse(opts.body);
    requests.push(request.action);
    assert.equal(request.action,'sessionInfo');
    return Promise.resolve({json:async()=>({
      success:true,isAdmin:true,mustChangePassword:false
    })});
  };
  const sandbox={document,window,localStorage,sessionStorage:localStorage,
    fetch,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,
    clearTimeout:()=>{},console};
  vm.runInNewContext(authSource,sandbox,{filename:'auth.js'});
  return {listeners,requests,nodes,storage,node};
}

test('deferred interactive script waits for complete initialization before session restore',async()=>{
  const f=fixture('interactive');
  assert.equal(f.requests.length,0);
  assert.equal(typeof f.listeners.get('DOMContentLoaded'),'function');
  f.listeners.get('DOMContentLoaded')();
  await tick();
  assert.deepEqual(f.requests,['sessionInfo']);
  assert.equal(f.node('appContainer').style.display,'block');
  assert.equal(f.node('authGuard').style.display,'none');
  assert.equal(f.storage.has('invest_session_token'),true);
});
test('late-loaded auth script restores on a microtask after declarations initialize',async()=>{
  const f=fixture('complete');
  assert.equal(f.requests.length,0);
  await tick();
  assert.deepEqual(f.requests,['sessionInfo']);
  assert.equal(f.node('appContainer').style.display,'block');
});
