/* MY INVEST V2 — standalone, safe-DOM investment research report.
 * No route changes, quote queries, storage, account access or order actions.
 */
(function(root){
'use strict';
const STYLE="\n.irr1{max-width:1180px;margin:0 auto;display:grid;gap:15px;color:#e9f0fb;font:14px/1.5 system-ui,-apple-system,\"Malgun Gothic\",sans-serif;min-width:0}.irr1 *{box-sizing:border-box}.irr1 h1,.irr1 h2,.irr1 h3,.irr1 p{margin:0}.irr1 h1{font-size:clamp(22px,2.7vw,32px);line-height:1.2;letter-spacing:-.04em}.irr1 h2{font-size:17px}.irr1 h3{font-size:14px}.irr1 .hero{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(180px,.8fr);gap:24px;background:linear-gradient(125deg,#172b47,#112137 70%,#19314e);border:1px solid #39526e;border-radius:18px;padding:clamp(17px,3vw,28px);min-width:0}.irr1 .eyebrow{font-size:10px;letter-spacing:.15em;color:#a8c8ee;font-weight:750;margin-bottom:10px}.irr1 .subhead{max-width:690px;color:#bacee6;font-size:13px;line-height:1.7;margin-top:12px}.irr1 .aside{border-left:1px solid #3a516c;padding-left:20px;display:grid;align-content:center;gap:14px;min-width:0}.irr1 .aside strong{display:block;font-size:17px;overflow-wrap:anywhere}.irr1 .aside small{font-size:11px;color:#a4b9d2}.irr1 .notice{background:#352a20;color:#f2d49e;border:1px solid #6b5235;padding:12px 14px;border-radius:11px;font-size:12px}.irr1 .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.irr1 .metric{border:1px solid #36516d;background:#14243a;border-radius:12px;padding:14px;min-width:0}.irr1 .metric small{font-size:11px;color:#b6c7de;display:block}.irr1 .metric strong{font-size:19px;display:block;margin-top:6px;overflow-wrap:anywhere}.irr1 .metric p{font-size:10px;color:#93aecb;margin-top:5px}.irr1 .section{border:1px solid #344b66;background:#122036;padding:clamp(12px,2vw,20px);border-radius:15px;min-width:0}.irr1 .header{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;justify-content:space-between;margin-bottom:13px}.irr1 .number{color:#8ac4e7;font-size:11px;letter-spacing:.08em;margin-right:9px}.irr1 .muted{font-size:11px;color:#a7bbd3}.irr1 .market-box{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.irr1 .market-cell{background:#0f1b2e;border-radius:10px;padding:16px;min-width:0}.irr1 .market-cell strong{display:block;font-size:20px;margin-bottom:7px}.irr1 .market-cell p{font-size:12px;color:#bfcee0;margin-top:7px}.irr1 .sector-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.irr1 .sector{border:1px solid #344c69;background:#0e1c2f;border-radius:11px;padding:13px;min-width:0}.irr1 .sector-title{display:flex;justify-content:space-between;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.irr1 .sector-name{font-weight:750;overflow-wrap:anywhere}.irr1 .pill{font-size:10px;color:#c4d9f1;background:#263d5a;border-radius:22px;padding:4px 8px}.irr1 .pill.good{color:#b3e5d9;background:#19403f}.irr1 .pill.warn{color:#eecf94;background:#443525}.irr1 .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.irr1 .fact small{display:block;font-size:10px;color:#a9bcd3}.irr1 .fact b{font-size:13px}.irr1 .tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.irr1 button{font:inherit;background:#152b45;color:#d8e9fa;border:1px solid #47607b;border-radius:8px;padding:7px 11px;min-height:39px;cursor:pointer}.irr1 button.active{background:#2c577d;border-color:#9cc7ed;color:white}.irr1 button:focus-visible{outline:2px solid #9bcdfd;outline-offset:2px}.irr1 .stocks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.irr1 .stock{background:#0e1a2b;border:1px solid #38516d;border-radius:12px;padding:15px;min-width:0;display:grid;gap:9px}.irr1 .stock-head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}.irr1 .stock-code{font-size:18px;font-weight:760;overflow-wrap:anywhere}.irr1 .stock-sector{font-size:11px;color:#91b2d7}.irr1 .description{font-size:12px;color:#b5c9dd;line-height:1.6}.irr1 .layer-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.irr1 .layer{border-radius:8px;background:#1b2c42;padding:8px;min-width:0}.irr1 .layer small{display:block;font-size:10px;color:#8dbfe7}.irr1 .layer strong{display:block;font-size:11px;margin-top:5px;overflow-wrap:anywhere}.irr1 .risk{font-size:11px;color:#a7bdd5;border-top:1px solid #32465b;padding-top:8px}.irr1 .history-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.irr1 .history-day{border:1px solid #304863;background:#0d1a2b;border-radius:9px;padding:10px;display:grid;gap:6px;min-width:0}.irr1 .history-day strong{font-size:12px}.irr1 .history-day small{font-size:10px;color:#9cbbd9}.irr1 .changes{display:grid;gap:7px;margin-top:12px}.irr1 .change{background:#102036;border:1px solid #2d4461;border-radius:8px;padding:9px 11px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px}.irr1 .change small{font-size:11px;color:#aec3d9}.irr1 .empty{font-size:12px;color:#adbed2;border:1px dashed #4b6079;border-radius:9px;padding:13px}.irr1 .foot{font-size:11px;color:#9db3cb;line-height:1.7;padding:3px 4px 16px}.irr1 .foot ul{margin:6px 0;padding-left:20px}@media(max-width:800px){.irr1 .hero{grid-template-columns:1fr}.irr1 .aside{border-left:0;border-top:1px solid #405775;padding:12px 0 0;grid-template-columns:repeat(2,minmax(0,1fr))}.irr1 .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.irr1 .sector-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.irr1{gap:11px}.irr1 .market-box,.irr1 .stocks{grid-template-columns:1fr}.irr1 .sector-grid{grid-template-columns:1fr}.irr1 .history-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:365px){.irr1 .metrics{gap:6px}.irr1 .metric{padding:10px}.irr1 .metric strong{font-size:16px}.irr1 .aside,.irr1 .layer-grid,.irr1 .history-strip{grid-template-columns:1fr}}\n";
const pct=x=>typeof x==='number'&&Number.isFinite(x)?
 x.toLocaleString('ko-KR',{maximumFractionDigits:1})+'%':'—';
const relative=x=>typeof x==='number'&&Number.isFinite(x)?
 (x>0?'+':'')+x.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%':'—';
function mount(host,input){
 if(!host||typeof host.replaceChildren!=='function'||!host.ownerDocument)
  return {ok:false,code:'INVALID_MOUNT_TARGET'};
 const doc=host.ownerDocument;
 const el=(tag,value,klass)=>{
  const v=doc.createElement(tag);
  if(value!==undefined)v.textContent=value;
  if(klass)v.className=klass;
  return v;
 };
 let removed=false,sourceInput=input,filter='all',current=null;
 const panel=el('main',undefined,'irr1'),style=el('style'),body=el('div');
 style.textContent=STYLE;body.style.display='contents';
 panel.append(style,body);host.replaceChildren(panel);
 const section=(id,name,note)=>{
  const box=el('section',undefined,'section'),header=el('div',undefined,'header');
  const title=el('h2');
  title.append(el('span',id,'number'),doc.createTextNode(name));
  header.append(title);
  if(note)header.append(el('span',note,'muted'));
  box.append(header);return box;
 };
 const metric=(wrap,title,value,desc)=>{
  const card=el('div',undefined,'metric');
  card.append(el('small',title),el('strong',value),el('p',desc));
  wrap.append(card);
 };
 const fact=(wrap,name,value)=>{
  const box=el('div',undefined,'fact');
  box.append(el('small',name),el('b',value));wrap.append(box);
 };
 function render(){
  if(removed)return {ok:false,code:'UNMOUNTED'};
  const model=root.MYInvestInvestmentResearchReportV1;
  current=model?.build?.(sourceInput)||null;
  body.replaceChildren();
  const hero=el('header',undefined,'hero');
  const intro=el('div');
  intro.append(el('p','MY INVEST V2 · OFFLINE RESEARCH','eyebrow'),
   el('h1','시장부터 종목까지,\n판단 근거 한눈에'),
   el('p','기존 시장·산업·종목 분석과 관찰 이력을 통합한 수동 검토 자료입니다. 실시간 시세·투자 추천이 아닙니다.','subhead'));
  hero.append(intro);
  if(!current||['blocked','empty'].includes(current.status)){
   const aside=el('div',undefined,'aside');
   aside.append(el('strong','근거 검증 보류'),el('small','현재 분석을 표시하지 않습니다.'));
   hero.append(aside);body.append(hero);
   const note=el('div','최신 관측일의 입력 근거가 부족합니다. 이전 기록을 현재 분석처럼 대체하거나 임의의 시세를 생성하지 않았습니다.','notice');
   note.setAttribute('role','note');body.append(note);
   return {ok:true,status:current?.status||'blocked'};
  }
  const aside=el('div',undefined,'aside');
  const marketAside=el('div');
  marketAside.append(el('small','관측 시장 · 일봉 스윙'),
   el('strong',current.market==='KR'?'한국 · 국내주식':'미국 · 해외주식'));
  const dateAside=el('div');
  dateAside.append(el('small','마지막 자료 거래일 · 원천 미인증'),
   el('strong',current.asOf));
  aside.append(marketAside,dateAside);hero.append(aside);
  body.append(hero);
  const notice=el('div','합성 또는 제공된 입력을 분석한 결과이며, 거래소 종가·휴장일·원천 진위·실제 주문은 확인하지 않았습니다.','notice');
  notice.setAttribute('role','note');body.append(notice);
  const metricRow=el('section',undefined,'metrics');
  metric(metricRow,'시장국면',current.marketSummary.classification,'원천 미인증 관찰');
  metric(metricRow,'관찰 산업',current.sectorRows.length+'개','시장 전체 순위 아님');
  metric(metricRow,'관찰 종목',current.candidateRows.length+'개','실제 보유 내역과 별개');
  metric(metricRow,'날짜별 자료',current.history.observedCount+'회','과거 관측일');
  body.append(metricRow);
  const market=section('01','시장환경','기준지수 '+current.marketSummary.benchmark);
  const marketBox=el('div',undefined,'market-box');
  const context=el('div',undefined,'market-cell');
  context.append(el('strong',current.marketSummary.classification),
   el('p',current.marketSummary.explanation));
  const width=el('div',undefined,'market-cell');
  width.append(el('h3','시장 표본 확인'),
   el('p','상승 종목 비율 '+pct(current.marketSummary.breadthPct)),
   el('p','시장 표본 커버리지 '+pct(current.marketSummary.coveragePct)),
   el('p','출처 표기: 지수 '+current.sources.benchmark+' · 시장 폭 '+current.sources.breadth),
   el('p','실제 시장 전체 대표성은 별도로 확인해야 합니다.'));
  marketBox.append(context,width);market.append(marketBox);body.append(market);
  const sector=section('02','산업·테마 관찰','관찰된 표본만 · 순위 아님');
  if(!current.sectorRows.length)sector.append(el('p','관찰 가능한 산업 자료가 없습니다.','empty'));
  else{
   const grid=el('div',undefined,'sector-grid');
   for(const item of current.sectorRows){
    const card=el('article',undefined,'sector'),head=el('div',undefined,'sector-title');
    head.append(el('span',item.id,'sector-name'),
     el('span',item.classification,'pill '+(item.eligible?'good':'warn')));
    const stats=el('div',undefined,'facts');
    fact(stats,'5일 상대강도',relative(item.relative5Pct));
    fact(stats,'20일 상대강도',relative(item.relative20Pct));
    fact(stats,'상승 종목 비율',pct(item.breadthPct));
    fact(stats,'구성 표본 커버리지',pct(item.coveragePct));
    card.append(head,stats);grid.append(card);
   }
   sector.append(grid);
  }
  body.append(sector);
  const stocks=section('03','종목 모멘텀 · 판단 근거','관찰 종목은 매수 추천이 아닙니다');
  const actions=el('div',undefined,'tools');
  const choices=[['all','전체'],['manual-review-only','근거 비교 가능'],
   ['insufficient-evidence','검증 보류']];
  for(const [id,label] of choices){
   const button=el('button',label+(id==='all'?' '+current.candidateRows.length+'개':''));
   button.type='button';button.setAttribute('data-filter',id);
   button.addEventListener('click',()=>{filter=id;drawCandidates()});
   actions.append(button);
  }
  const candidateList=el('div',undefined,'stocks');
  candidateList.setAttribute('data-report-stocks','');
  stocks.append(actions,candidateList);body.append(stocks);
  function drawCandidates(){
   if(removed)return;
   for(const button of actions.querySelectorAll('button')){
    const isSelected=button.getAttribute('data-filter')===filter;
    button.className=isSelected?'active':'';
    button.setAttribute('aria-pressed',String(isSelected));
   }
   candidateList.replaceChildren();
   const items=current.candidateRows.filter(x=>filter==='all'||x.status===filter);
   if(!items.length){
    candidateList.append(el('p','선택 조건에 맞는 관측 종목이 없습니다.','empty'));
    return;
   }
   for(const item of items){
    const card=el('article',undefined,'stock'),head=el('div',undefined,'stock-head');
    const name=el('div');
    name.append(el('strong',item.symbol||'식별 불가','stock-code'),
     el('p','연결 산업 '+(item.sectorId||'미연결'),'stock-sector'));
    head.append(name,el('span',item.observation,'pill '+(item.status==='manual-review-only'?'good':'warn')));
    card.append(head,el('p',item.explanation,'description'));
    if(item.layers.length){
     const layers=el('div',undefined,'layer-grid');
     for(const l of item.layers){
      const box=el('div',undefined,'layer');
      box.append(el('small',l.layer==='market'?'시장':l.layer==='sector'?'산업':'종목'),
       el('strong',l.title));layers.append(box);
     }
     card.append(layers);
    }
    card.append(el('p','가상 위험예산 상한 '+pct(item.hypotheticalPolicyRiskCeilingPct)+
     ' · 실제 투자비중이 아닙니다.','risk'));
    candidateList.append(card);
   }
  }
  drawCandidates();
  const history=section('04','날짜별 근거 변화','최근 12개 관측 기록');
  const days=el('div',undefined,'history-strip');
  for(const day of current.history.days){
   const card=el('div',undefined,'history-day');
   card.append(el('strong',day.asOf),
    el('span',day.marketClassification,'pill '+(day.quality==='unqualified'?'warn':'')),
    el('small','관찰 종목 '+day.candidateObservations+'개'));
   days.append(card);
  }
  history.append(days,el('p',current.history.reason,'muted'));
  if(current.history.status==='adjacent-observations-only'){
   const changes=el('div',undefined,'changes');
   for(const change of current.history.lastComparison.changes){
    const row=el('div',undefined,'change');
    row.append(el('strong',change.symbol||'종목 미확인'),
     el('small',change.description+' · '+change.previous+' → '+change.current));
    changes.append(row);
   }
   if(changes.childNodes.length)history.append(changes);
  }
  body.append(history);
  const footer=el('footer',undefined,'foot');
  footer.append(el('strong','추가 확인이 필요한 사항'));
  const list=el('ul');
  for(const item of current.limitations)list.append(el('li',item));
  footer.append(list);body.append(footer);
  return {ok:true,status:current.status};
 }
 const initial=render();
 return {ok:true,initialStatus:initial.status,
  status:()=>current?.status||'blocked',
  update:next=>{
   if(removed)return {ok:false,code:'UNMOUNTED'};
   sourceInput=next;filter='all';return render();
  },
  destroy:()=>{removed=true;host.replaceChildren();sourceInput=null;current=null}
 };
}
const api=Object.freeze({mount});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestInvestmentResearchReportPanelV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
