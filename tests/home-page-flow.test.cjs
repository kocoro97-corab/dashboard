'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=s=>fs.readFileSync(path.join(__dirname,'..','js',s),'utf8');
const policy=load('home-market-policy.js'),home=load('page-home.js');
class Node{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attrs={};this.dataset={};this.listeners={};this.className='';this.textContent='';this.classList={add:(x)=>{this.className=[this.className,x].filter(Boolean).join(' ')}};}
 append(...items){for(const el of items){if(el instanceof Node)el.parent=this;this.children.push(el)}}
 replaceChildren(...items){this.children=[];this.append(...items)}
 setAttribute(k,v){this.attrs[k]=String(v)}
 addEventListener(k,fn){this.listeners[k]=fn}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
 click(){this.listeners.click?.()}
 querySelector(query){return descendants(this).find(x=>query.startsWith('.')&&x.className.split(' ').includes(query.slice(1)))||null}
 querySelectorAll(query){if(query==='.homev4-switch button')return descendants(this).filter(x=>x.tagName==='BUTTON'&&x.parent?.className.includes('homev4-switch'));return []}
}
function descendants(n){return [n,...n.children.flatMap(x=>x instanceof Node?descendants(x):[])]}
const text=n=>descendants(n).map(x=>x.textContent||'').join(' | ');
function setup(){
 const root={location:{hash:''}},pages={};
 new Function('window',policy)(root);
 const Q={'^KS11':{p:102,prev:100},'^KQ11':{p:103,prev:100},'^GSPC':{p:104,prev:100},'^IXIC':{p:105,prev:100},'^DJI':{p:106,prev:100},'^SOX':{p:107,prev:100},'KRW=X':{p:1336,prev:1338},'^VIX':{p:28.52,prev:27},'k3':{p:1100,prev:1080,contractVerified:true}},SRC={},QT={};
 for(const k of Object.keys(Q)){SRC[k]='N';QT[k]=Date.now()}
 const node=(tag,t,cls)=>{const n=new Node(tag);if(t!=null)n.textContent=t;if(cls)n.className=cls;return n};
 const DashboardPages={
  node,
  register:(id,fn)=>{pages[id]=fn},
  legacy:({build,update,refresh})=>{
   let view=null,ctx=null;
   return{
    mount(container,c){ctx=c;view=node('section');build(view);container.append(view);update(view,ctx)},
    async refresh(c,force){await refresh(c,force);update(view,c)},
    unmount(){view.remove()},
    getStatus:()=>({status:'mounted'})
   };
  }
 };
 const scheduled=[];let clock=0;
 new Function('window','DashboardPages','Q','SRC','QT','setTimeout','clearTimeout',home)(root,DashboardPages,Q,SRC,QT,(fn,delay)=>{scheduled.push({fn,delay});return ++clock},()=>{});
 const ctx={market:async(force,ids)=>{ctx.calls.push({force,ids})},calls:[],snapshot:()=>({knownSubtotal:17727973,complete:false})};
 const container=node('main'),instance=pages.home();instance.mount(container,ctx);
 return{container,instance,ctx,root,policy:root.HomeMarketPolicy,findButton:t=>descendants(container).find(x=>x.tagName==='BUTTON'&&x.textContent===t),find:cls=>descendants(container).find(x=>x.className.split(' ').includes(cls))};
}
test('home renders market-specific priorities, actual changes, partial asset label and regime',()=>{
 const x=setup(),mode=x.instance.getStatus().market;
 const cards=x.find('homev4-main').children;
 assert.equal(cards.length,mode==='KR'?7:6);
 assert.equal(cards[0].children[0].textContent,mode==='KR'?'KOSPI':'S&P 500');
 assert.match(text(x.container),/조회 자산/);
 assert.match(text(x.container),/부분 조회/);
 assert.match(text(x.container),/시장국면/);
 assert.match(text(x.container),/주요 지수 동반 상승/);
});
test('home controls switch markets without changing account settings',async()=>{
 const x=setup();x.findButton('미국').click();
 assert.equal(x.instance.getStatus().market,'US');
 assert.equal(x.find('homev4-main').children[0].children[0].textContent,'S&P 500');
 await Promise.resolve();await Promise.resolve();
 assert.ok(x.ctx.calls.some(v=>v.force===true&&v.ids.includes('^GSPC')));
 x.findButton('한국').click();assert.equal(x.instance.getStatus().market,'KR');
 assert.equal(x.find('homev4-main').children[0].children[0].textContent,'KOSPI');
 x.findButton('자동').click();
 assert.equal(x.instance.getStatus().market,x.policy.regionAt(new Date()));
 x.instance.unmount();
});
test('home primary KOSDAQ150 card remains visible and explicitly missing without fabricated quote',()=>{
 const x=setup();x.findButton('한국').click();
 const main=x.find('homev4-main');
 const cards=main.children.filter(n=>n.children[0]?.textContent==='KOSDAQ 150 선물');
 assert.equal(cards.length,1);
 assert.equal(cards[0].children[1].textContent,'미수신');
 assert.match(cards[0].children[3].textContent,/NH 코스닥150 선물 계약\/시세 확인 필요/);
 x.instance.unmount();
});
