const {test}=require('node:test'),assert=require('node:assert/strict');
const router=require('../js/app-router.js');
test('eight hash routes and account subpages work without query secrets',()=>{
  for(const page of router.routes)assert.equal(router.parse('#/'+page).page,page);
  for(const tab of router.accountTabs)assert.equal(router.parse('#/accounts/'+tab).tab,tab);
  for(const value of ['#token=secret','#/home?token=secret','#/accounts/unknown','#/market/nh','#//home','javascript:alert(1)'])assert.equal(router.validHash(value),false);
});
test('router installs one listener, restores legacy entry and stops cleanly',()=>{
  const handlers=new Set(),seen=[],location={hash:'',pathname:'/dashboard-v2-dev/index.html',search:''};
  const api=router.create({location,target:{addEventListener:(n,fn)=>handlers.add(fn),removeEventListener:(n,fn)=>handlers.delete(fn)},history:{replaceState:(a,b,url)=>{location.hash=url.slice(url.indexOf('#'))}},onChange:r=>seen.push(r)});
  api.start();api.start();assert.equal(handlers.size,1);assert.equal(seen[0].page,'home');
  api.go('/accounts/ocr');for(const fn of handlers)fn();assert.equal(seen.at(-1).tab,'ocr');api.stop();assert.equal(handlers.size,0);
});
