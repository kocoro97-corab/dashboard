'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const presentation=fs.readFileSync('js/dashboard-presentation.js','utf8');
function harness(visible=false,idleSupported=true){
 const app={style:{display:visible?'block':'none'},querySelector(){return null},querySelectorAll(){return []}};
 const tasks=[],changes=[],seen=[];let loads=0;
 const root={
  InstrumentNames:{load(){loads++;return Promise.resolve(true)}},
  setTimeout(fn,delay){tasks.push(fn);seen.push(['fallback',delay])}
 };
 if(idleSupported)root.requestIdleCallback=(fn,opts)=>{tasks.push(fn);seen.push(['idle',opts.timeout])};
 const document={readyState:'complete',getElementById:id=>id==='appContainer'?app:null};
 class Observer{constructor(callback){changes.push(callback)}observe(target,opts){assert.equal(target,app);assert.deepEqual(opts,{attributes:true,attributeFilter:['style']})}}
 new Function('window','document','MutationObserver',presentation)(root,document,Observer);
 return {app,tasks,changes,seen,loads:()=>loads,notify:()=>changes.forEach(fn=>fn())};
}
test('signed-out screen does not preload the 1.4MB instrument directory',()=>{
 const f=harness();
 assert.equal(f.tasks.length,0);
 f.notify();assert.equal(f.tasks.length,0);
 f.app.style.display='block';f.notify();
 assert.equal(f.tasks.length,1);assert.deepEqual(f.seen[0],['idle',4000]);
 f.notify();assert.equal(f.tasks.length,1,'same session queues once');
 f.tasks.shift()();assert.equal(f.loads(),1);
});
test('queued catalog is not fetched after the user logs out',()=>{
 const f=harness();f.app.style.display='block';f.notify();
 const queued=f.tasks.shift();
 f.app.style.display='none';f.notify();
 queued();assert.equal(f.loads(),0);
 f.app.style.display='block';f.notify();
 assert.equal(f.tasks.length,1);f.tasks.shift()();assert.equal(f.loads(),1);
});
test('already signed-in view uses the timer fallback without blocking paint',()=>{
 const f=harness(true,false);
 assert.equal(f.loads(),0);
 assert.deepEqual(f.seen,[['fallback',1200]]);
 f.tasks.shift()();assert.equal(f.loads(),1);
});
