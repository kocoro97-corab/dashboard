const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('first visible data and total settle are recorded separately; cancelled sessions leave no rows',()=>{
 let time=0;
 const w={performance:{now:()=>time}};
 vm.runInNewContext(fs.readFileSync('js/web-performance-metrics.js','utf8'),w);
 const api=w.MYInvestWebPerformance,one=api.dataStart('sectors','US','swing');
 time=210;one.first();time=500;one.first();time=1200;one.end('partial');
 const row=api.dataSnapshot()[0];
 assert.equal(row.firstMs,210);assert.equal(row.totalMs,1200);assert.equal(row.status,'partial');
 assert.equal(Object.keys(row).sort().join(','),'firstMs,market,mode,status,totalMs,view');
 const old=api.dataStart('accounts','ANY','general');api.clear();
 old.first();old.end('ready');assert.equal(api.dataSnapshot().length,0);
 api.dataStart('accounts','ANY','account secret').end('ready');assert.equal(api.dataSnapshot().length,0);
});

test('account page continues to query whether optional timing is present or absent',async()=>{
 const src=fs.readFileSync('js/page-accounts.js','utf8');
 for(const enabled of [false,true]){
  const events=[],status={textContent:''};
  let adapter;
  const realm={DashboardPages:{register(name,factory){assert.equal(name,'accounts');adapter=factory()},legacy:args=>args},document:{getElementById:()=>status}};
  realm.window=realm;
  if(enabled)realm.MYInvestWebPerformance={dataStart(...args){events.push(args.join(':'));return {first:()=>events.push('first'),end:which=>events.push(which)}}};
  vm.runInNewContext(src,realm);
  await adapter.refresh({accountReads:()=>true,accounts:async(force,done)=>{assert.equal(force,true);events.push('read');done()}},true);
  assert.deepEqual(events,enabled?['accounts:ANY:general','read','first','ready']:['read']);
  assert.match(status.textContent,/조회 요청 완료/);
 }
});
