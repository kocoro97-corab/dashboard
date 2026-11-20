'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','js',name),'utf8');
const sources={workflow:read('invest-workflow.js'),stocks:read('page-stocks.js'),strategy:read('page-strategy.js')};

class Node {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attrs={};this.dataset={};this.listeners={};this.style={};this.className='';this.classList={add(){} };this._value='';Object.defineProperty(this,'value',{get(){return this._value},set(v){this._value=String(v)}});this.textContent='';this.type='';this.hidden=false}
 append(...items){for(const c of items){if(c instanceof Node)c.parent=this;this.children.push(c)}}
 prepend(...items){for(const c of items){if(c instanceof Node)c.parent=this}this.children.unshift(...items)}
 replaceChildren(...items){this.children=[];this.append(...items)}
 setAttribute(k,v){this.attrs[k]=String(v)}
 addEventListener(k,fn){this.listeners[k]=fn}
 removeEventListener(k){delete this.listeners[k]}
 click(){this.listeners.click?.({preventDefault(){}});this.onclick?.({preventDefault(){}})}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
 querySelectorAll(q){const all=desc(this);if(q==='button')return all.filter(n=>n.tagName==='BUTTON');if(q==='.sva-tabs button')return all.filter(n=>n.tagName==='BUTTON'&&n.parent?.className.includes('sva-tabs'));return []}
 querySelector(){return null}
}
function desc(n){return [n,...n.children.flatMap(c=>c instanceof Node?desc(c):[])]}
function texts(n){return desc(n).map(x=>x.textContent||'').join(' ')}
function byButton(n,value){return desc(n).find(x=>x.tagName==='BUTTON'&&x.textContent===value)}
async function flush(){for(let i=0;i<25;i++)await Promise.resolve()}
function environment(){
 const local=new Map(),session=new Map(),listeners=new Map(),pages={};
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)});
 const localStorage=storage(local),sessionStorage=storage(session);
 const document={createElement:t=>new Node(t),createTextNode:t=>{const n=new Node('text');n.textContent=t;return n}};
 const root={location:{hash:''},InstrumentNames:{
  lookup:s=>s==='SERV'?{symbol:s,nameEn:'Serve Robotics'}:s==='AAPL'?{symbol:s,nameEn:'Apple Inc.'}:null,
  node:(s,n)=>{const t=new Node('span');t.textContent=n+' ('+s+')';return t},
  label:(s,n)=>n+' ('+s+')',ingest:()=>true,load:async()=>{},
  search:q=>['SERV','Serve Robotics'].some(x=>x.toLowerCase().includes(q.toLowerCase()))?[{symbol:'SERV',nameEn:'Serve Robotics',market:'US',exchange:'NASDAQ',type:'EQUITY'}]:q.toLowerCase().includes('apple')?[{symbol:'AAPL',nameEn:'Apple Inc.',market:'US',exchange:'NASDAQ',type:'EQUITY'}]:[]
 }};
 root.addEventListener=(type,fn)=>{const arr=listeners.get(type)||[];arr.push(fn);listeners.set(type,arr)};
 root.removeEventListener=(type,fn)=>listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));
 root.dispatchEvent=event=>{for(const cb of listeners.get(event.type)||[])cb(event)};
 const Event=class{constructor(type){this.type=type}};
 const DashboardPages={register:(id,create)=>{pages[id]=create},legacy:()=>({mount(){},unmount(){},refresh:async()=>{}})};
 const getJSON=async url=>{
  const symbol=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
  const kr=/^000660\.(KS|KQ)$/.test(symbol),base=kr?200000:symbol==='AAPL'?200:10,now=Math.floor(Date.now()/1000),timestamp=[],open=[],high=[],low=[],close=[],volume=[];
  for(let i=0;i<85;i++){const c=base+i*.11,t=now-(86-i)*86400;timestamp.push(t);open.push(c-.05);high.push(c+.8);low.push(c-.8);close.push(c);volume.push(100000+i*400)}
  return{chart:{result:[{timestamp,meta:{symbol,currency:kr?'KRW':'USD',exchangeName:kr?'KSC':'NMS',instrumentType:'EQUITY',longName:kr?'SK hynix':symbol==='AAPL'?'Apple Inc.':'Serve Robotics'},indicators:{quote:[{open,high,low,close,volume}]}}]}};
 };
 const THM=[{name:'국내 테마',rows:[{code:'000660',name:'SK하이닉스'}]}];
 const EXT_MASTER={byCode:new Map([['000660',{code:'000660',market:'KOSPI',name:'SK하이닉스'}]])};
 const loadExternalMaster=async()=>{};
 for(const src of [sources.workflow,sources.stocks,sources.strategy]){
  new Function('window','document','sessionStorage','localStorage','Event','DashboardPages','getJSON','showQ','THM','fetch','EXT_MASTER','loadExternalMaster',src)(
    root,document,sessionStorage,localStorage,Event,DashboardPages,getJSON,()=>{},THM,
    async()=>({ok:true,json:async()=>({schemaVersion:1,themes:[{name:'미국 로봇',instruments:[{symbol:'SERV',name:'Serve Robotics'}]}]})}),EXT_MASTER,loadExternalMaster
  );
 }
 const ctx={
  snapshot:()=>({details:[{code:'SERV',name:'Serve Robotics',market:'overseas',currency:'USD',instrumentId:'NH:XNAS:SERV',draft:false,quantity:172,avgPrice:7.5,broker:'NH',accountLabel:'일반계좌'},{code:'000660',name:'SK하이닉스',market:'domestic',currency:'KRW',draft:false,quantity:12,avgPrice:180000,broker:'NH',accountLabel:'국내계좌'}],result:{rows:[{identity:true,issues:[],returnPct:12.4},{identity:true,issues:[],returnPct:4.2}]}}),
  subscribe:()=>()=>{},chart:async()=>{},sectors:async()=>{}
 };
 function mount(page){const container=new Node('main'),instance=pages[page]();instance.mount(container,ctx);return{container,instance}}
 return{root,ctx,mount};
}

test('sector stock selection carries the same US symbol through analysis and strategy',async()=>{
 const x=environment();
 assert.equal(x.root.MYInvestStockSelection.open('SERV',{name:'Serve Robotics',theme:'미국 로봇',mode:'swing',period:'20d',source:'theme',themeReturn:3}),true);
 assert.equal(x.root.location.hash,'#/stocks');
 const stock=x.mount('stocks');await flush();
 assert.equal(stock.instance.getStatus().symbol,'SERV');
 assert.match(texts(stock.container),/종합 판단/);
 assert.match(texts(stock.container),/테마 미국 로봇/);
 assert.match(texts(stock.container),/스윙 · 선택기간 20일/);
 byButton(stock.container,'이 종목 투자전략').click();assert.equal(x.root.location.hash,'#/strategy');
 const selection=x.root.InvestWorkflow.current();
 assert.equal(selection.symbol,'SERV');assert.equal(selection.theme,'미국 로봇');assert.equal(selection.period,'20d');
 stock.instance.unmount();
 const strategy=x.mount('strategy');await flush();
 assert.match(texts(strategy.container),/선택 종목: Serve Robotics \(SERV\)/);
 assert.match(texts(strategy.container),/스윙 20일 관찰/);
 assert.match(texts(strategy.container),/기존 보유종목 관리/);
 assert.match(texts(strategy.container),/평균매입가 7.5 USD/);
 byButton(strategy.container,'종목분석 보기').click();assert.equal(x.root.location.hash,'#/stocks');
 strategy.instance.unmount();
});
test('strategy symbol switch removes old company and requests the new analysis',async()=>{
 const x=environment();x.root.InvestWorkflow.select('SERV',{name:'Serve Robotics',mode:'swing',source:'holding'});
 const strategy=x.mount('strategy');await flush();
 const search=desc(strategy.container).find(x=>x.tagName==='INPUT'&&x.attrs['aria-label']==='국내 6자리 코드 또는 미국 티커');
 assert.ok(search);search.value='Apple';
 search.listeners.input?.({});await flush();
 const choice=desc(strategy.container).find(n=>n.tagName==='BUTTON'&&texts(n).includes('Apple Inc. (AAPL)'));
 assert.ok(choice,'verified company search result');
 choice.click();await flush();
 assert.equal(x.root.InvestWorkflow.current().symbol,'AAPL');
 assert.match(texts(strategy.container),/선택 종목: Apple Inc. \(AAPL\)/);
 assert.match(texts(strategy.container),/신규 투자 후보 관찰/);
 assert.ok(!texts(strategy.container).includes('선택 종목: Serve Robotics'));
 strategy.instance.unmount();
});
test('theme selector loads both US and Korean groups even if KR was already registered',async()=>{
 const x=environment();
 x.root.InvestWorkflow.registerThemes([{name:'기존 한국 테마',market:'KR',stocks:[{symbol:'000660',name:'SK하이닉스'}]}]);
 const selected=[];
 const picker=x.root.InvestWorkflow.selector({ctx:x.ctx,onSelect:s=>selected.push(s)});
 byButton(picker.element,'테마 종목').click();await flush();
 const all=texts(picker.element);
 assert.match(all,/기존 한국 테마/);
 assert.match(all,/미국 로봇/);
 const group=desc(picker.element).find(n=>n.tagName==='SUMMARY'&&n.textContent.includes('미국 로봇'));
 assert.ok(group);
 const button=desc(picker.element).find(n=>n.tagName==='BUTTON'&&n.textContent.includes('Serve Robotics (SERV)'));
 assert.ok(button);button.click();
 assert.equal(selected.at(-1).symbol,'SERV');assert.equal(selected.at(-1).theme,'미국 로봇');
 picker.destroy();
});

test('domestic industry stock keeps its 5-day sector context and verified holdings through strategy',async()=>{
 const x=environment();
 assert.equal(x.root.MYInvestStockSelection.open('000660',{name:'SK하이닉스',industry:'반도체',mode:'swing',period:'5d',source:'industry'}),true);
 const stock=x.mount('stocks');await flush();
 assert.equal(stock.instance.getStatus().symbol,'000660');
 assert.match(texts(stock.container),/산업 반도체/);
 assert.match(texts(stock.container),/선택기간 5일/);
 assert.match(texts(stock.container),/종합 판단/);
 byButton(stock.container,'이 종목 투자전략').click();
 assert.equal(x.root.InvestWorkflow.current().symbol,'000660');
 assert.equal(x.root.InvestWorkflow.current().period,'5d');
 stock.instance.unmount();
 const strategy=x.mount('strategy');await flush();
 assert.match(texts(strategy.container),/스윙 5일 관찰/);
 assert.match(texts(strategy.container),/선택 종목: SK하이닉스 \(000660\)/);
 assert.match(texts(strategy.container),/기존 보유종목 관리/);
 assert.match(texts(strategy.container),/평균매입가 180,000 KRW/);
 strategy.instance.unmount();
});
test('verified holdings are selectable directly without an extra manual ticker entry',()=>{
 const x=environment(),picked=[];
 const selector=x.root.InvestWorkflow.selector({ctx:x.ctx,onSelect:s=>picked.push(s)});
 byButton(selector.element,'내 보유종목').click();
 assert.match(texts(selector.element),/Serve Robotics/);
 assert.match(texts(selector.element),/SK하이닉스/);
 const choice=desc(selector.element).find(n=>n.tagName==='BUTTON'&&n.textContent.includes('SK하이닉스 (000660)'));
 assert.ok(choice);
 choice.click();
 assert.equal(picked.at(-1).symbol,'000660');
 assert.equal(picked.at(-1).source,'holding');
 selector.destroy();
});
