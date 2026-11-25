'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','js','page-sectors.js'),'utf8');

class FakeNode {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.attrs={};this.style={};this.textContent='';this.className='';this.hidden=false}
 append(...items){this.children.push(...items)}
 appendChild(item){this.children.push(item);return item}
 prepend(...items){this.children.unshift(...items)}
 replaceChildren(...items){this.children=items}
 setAttribute(key,value){this.attrs[key]=String(value)}
 addEventListener(key,cb){this.handlers[key]=cb}
 querySelector(){return null}
 remove(){}
 click(){this.handlers.click?.({preventDefault(){}})}
}
function setup(){
 const stored=new Map();
 const localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
 const document={createElement:tag=>new FakeNode(tag)};
 const root={MYINVEST_TRANSPORT_CONFIG:{publicIndustries:false}};
 const pages={};
 const DashboardPages={legacy:()=>({mount(){},unmount(){},refresh:async()=>{}}),register:(key,factory)=>{pages[key]=factory}};
 const themes=[{name:'검증용 국내 테마',rate:1.2,sc:85,rows:[]}];
 new Function('window','DashboardPages','document','localStorage','setTimeout','clearTimeout','THM',source)(root,DashboardPages,document,localStorage,()=>1,()=>{},themes);
 const ctx={development:()=>true,publicConnected:()=>false,subscribe:()=>()=>{},sectors:async()=>{}};
 return {stored,ctx,mount(){const container=new FakeNode('main'),app=pages.sectors();app.mount(container,ctx);const nodes=node=>[node,...node.children.flatMap(child=>child instanceof FakeNode?nodes(child):[])];return {app,container,nodes:()=>nodes(container),button:text=>nodes(container).find(x=>x.tagName==='BUTTON'&&x.textContent===text),findHeading:text=>nodes(container).find(x=>x.tagName==='H3'&&x.textContent===text)}}};
}
test('selecting swing shows 5/20/60-day intervals',()=>{
 const h=setup().mount();assert.ok(h.button('스윙'));h.button('스윙').click();
 assert.equal(h.app.getStatus().mode,'swing');
 assert.equal(h.app.getStatus().period,'5d');
 assert.ok(h.button('5일'));assert.ok(h.button('20일'));assert.ok(h.button('60일'));
});
test('selected 20-day period and combined market survive remount',()=>{
 const source=setup(),h=source.mount();h.button('스윙').click();h.button('20일').click();h.button('한국+미국').click();
 assert.equal(h.app.getStatus().market,'MIX');
 h.app.unmount();
 const next=source.mount();assert.equal(next.app.getStatus().period,'20d');assert.equal(next.app.getStatus().mode,'swing');
 assert.equal(next.app.getStatus().market,'MIX');assert.equal(next.button('한국+미국').attrs['aria-pressed'],'true');
 assert.ok(next.nodes().some(x=>String(x.textContent).includes('혼합 비교는')));
});
test('domestic industry refresh is right of its heading in day and swing mode',()=>{
 const h=setup().mount();
 h.button('한국').click(); // Explicit session-independent market selection.
 h.button('분석: 테마 → 산업').click();
 let heading=h.findHeading('국내 산업 · 네이버 업종 분류');
 assert.ok(heading);
 let row=h.nodes().find(x=>x.children.includes(heading));
 assert.equal(row.children[1].textContent,'국내 섹터 갱신');
 h.button('스윙').click();
 heading=h.findHeading('국내 산업 구성종목 표본 분석');assert.ok(heading);
 row=h.nodes().find(x=>x.children.includes(heading));
 assert.equal(row.children[1].textContent,'국내 섹터 갱신');
});
test('market controls expose separate Korea, US and mixed choices',()=>{
 const h=setup().mount();
 for(const market of ['한국','미국','한국+미국'])assert.ok(h.button(market));
 h.button('미국').click();assert.equal(h.app.getStatus().market,'US');
 h.button('한국').click();assert.equal(h.app.getStatus().market,'KR');
 h.button('한국+미국').click();assert.equal(h.app.getStatus().market,'MIX');
});

test('swing periods sit immediately to the right on the same horizontal control line',()=>{
 const h=setup().mount();
 h.button('스윙').click();
 const line=h.nodes().find(x=>x.className==='stv2-mode-line');
 assert.ok(line,'same-line mode controls must exist');
 assert.equal(line.children.length,2);
 const modes=line.children[0],intervals=line.children[1];
 assert.equal(intervals.className,'stv2-swing-periods');
 assert.deepEqual(modes.children.map(x=>x.textContent),['단타','스윙']);
 assert.deepEqual(intervals.children[0].children.map(x=>x.textContent),['5일','20일','60일']);
 h.button('단타').click();
 assert.ok(!h.nodes().some(x=>x.className==='stv2-swing-periods'),'intervals hidden in daytrade mode');
});
