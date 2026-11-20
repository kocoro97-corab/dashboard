/* Homepage: concise KST market priorities and verified-observation context.
   No fresh external provider, credential, account write, trade or synthetic quote. */
(function(root){
'use strict';
const {node}=DashboardPages;
const css=`.homev4{display:grid;gap:9px}.homev4-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.homev4-title{margin:0;font-size:16px}.homev4-sub{font-size:11px;color:#b6c5d9;margin:0}.homev4-switch{display:flex;gap:5px;flex-wrap:wrap}.homev4 button{cursor:pointer}.homev4-switch button,.homev4-actions button{border:1px solid #465775;color:#e7eef9;background:#172238;border-radius:7px;padding:6px 10px;min-height:34px}.homev4-switch button[aria-pressed="true"]{border-color:#72b5ff;background:#264365}.homev4-main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.homev4-quote{border:1px solid #35445c;border-radius:9px;background:#172238;padding:10px;min-width:0;display:grid;gap:5px}.homev4-quote dt{font-size:12px;color:#b6c5d9}.homev4-quote dd{font-size:clamp(17px,1.9vw,23px);font-weight:750;letter-spacing:-.3px;margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.homev4-quote .homev4-provenance{font-size:10px;color:#afc1d6;overflow-wrap:anywhere;line-height:1.35}.homev4-percent{font-size:13px;font-weight:750}.homev4-support{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.homev4-support>div{padding:6px 9px;border:1px solid #35445c;border-radius:7px;min-width:0}.homev4-support strong{display:block;font-size:12px}.homev4-support small{display:block;color:#b6c5d9;font-size:10px}.homev4-bottom{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:7px}.homev4-panel{border:1px solid #35445c;background:#172238;padding:11px;border-radius:9px;min-width:0}.homev4-panel h3{font-size:14px;margin:0 0 6px}.homev4-panel p{font-size:12px;margin:4px 0;line-height:1.5}.homev4-panel .homev4-major{font-size:16px;font-weight:750}.homev4-actions{display:flex;gap:5px;flex-wrap:wrap}.homev4-muted{color:#b6c5d9;font-size:11px!important}.homev4-asset{font-size:19px!important;font-weight:750;font-variant-numeric:tabular-nums}.homev4-insight{font-size:12px;line-height:1.45;color:#b6c5d9}.homev4 .market-up{color:#ff7777}.homev4 .market-down{color:#79b8ff}.homev4 .market-flat{color:#e7eef9}@media(max-width:650px){.homev4-main{grid-template-columns:repeat(2,minmax(0,1fr))}.homev4-bottom{grid-template-columns:1fr}.homev4-quote{padding:8px}.homev4-quote dd{font-size:17px}.homev4-support{grid-template-columns:repeat(3,minmax(0,1fr))}.homev4-support>div{padding:6px}}`;
const time=t=>new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' KST';
const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'미수신';
const pct=v=>v===null?'등락률 미확인':(v>0?'+':'')+v.toFixed(2)+'%';
const dir=v=>v===null?'market-flat':v>0?'market-up':v<0?'market-down':'market-flat';
const unit=id=>id==='KRW=X'?' 원/USD':id==='^TNX'?' %':'';
const act=(label,path)=>{const b=node('button',label);b.type='button';b.addEventListener('click',()=>{root.location.hash='#/'+path});return b};
DashboardPages.register('home',()=>{
 let scope='AUTO',timer=null,active=false,viewRef=null,ctxRef=null;
 const effective=()=>scope==='AUTO'?root.HomeMarketPolicy.regionAt(new Date()):scope;
 function card(id,name){
  const m=root.HomeMarketPolicy.quote(id,Q,SRC,QT),el=node('dl',null,'homev4-quote');
  const value=node('dd',m.valid?num(m.price,id==='KRW=X'?2:2)+unit(id):'미수신');
  const change=node('div',m.valid?pct(m.delta):'등락률 미확인','homev4-percent '+dir(m.delta??null));
  const provenance=node('small',m.valid?m.source+' · '+(m.observedAt?'원천 '+time(m.observedAt):'원천 관측시각 미제공')+' · '+(m.receivedAt?'수신 '+time(m.receivedAt):'수신시각 미확인')+(m.stale?' · 오래된 자료 가능':''):'조회된 시세 없음','homev4-provenance');
  el.append(node('dt',name),value,change,provenance);return el;
 }
 function render(view,ctx){
  if(!view)return;
  const region=effective(),policy=root.HomeMarketPolicy;
  const title=view.querySelector('.homev4-title');title.textContent=(region==='KR'?'한국장':'미국장')+' 중심 · 핵심 지수';
  view.querySelector('.homev4-sub').textContent=scope==='AUTO'?'한국시간 07:00~20:59 한국 우선 / 21:00~06:59 미국 우선 · 자동 전환':'직접 선택 · 다른 시장은 보조 지표에서 확인';
  for(const b of view.querySelectorAll('.homev4-switch button'))b.setAttribute('aria-pressed',String(b.dataset.region===scope));
  const main=view.querySelector('.homev4-main');main.replaceChildren();
  for(const [id,name] of policy.MAIN[region])main.append(card(id,name));
  const support=view.querySelector('.homev4-support');support.replaceChildren();
  for(const [id,name] of policy.SECONDARY[region]){
   const m=policy.quote(id,Q,SRC,QT),box=node('div');
   const label=node('strong',name),small=node('small',m.valid?num(m.price,id==='KRW=X'?2:2)+unit(id)+' · '+pct(m.delta):'미수신');
   small.classList.add(dir(m.delta??null));box.append(label,small);support.append(box);
  }
  const judgement=policy.marketRegime(region,Q,SRC,QT),summary=view.querySelector('.homev4-summary');
  summary.replaceChildren(node('h3','시장국면 · 관측 기준'),node('p',judgement.title,'homev4-major'),node('p',judgement.basis));
  for(const note of judgement.notes)summary.append(node('p',note));
  summary.append(node('p','실제 수신된 지수의 전일 대비 등락으로만 설명합니다. 정규장 실시간 여부·수급·원천 관측시각이 미확인되면 매매 판단으로 사용하지 마세요.','homev4-muted'));
  const assets=view.querySelector('.homev4-assets');assets.replaceChildren(node('h3','조회 자산'));
  let snap=null;try{snap=ctx.snapshot()}catch{}
  const complete=snap?.complete===true,subtotal=snap?.knownSubtotal;
  assets.append(node('p',Number.isFinite(subtotal)?num(subtotal,0)+'원':'미조회','homev4-asset'),node('p',complete?'조회 범위 내 집계':'부분 조회 · 미조회 계좌/시세 포함 가능','homev4-muted'));
 }
 const legacy=DashboardPages.legacy({
  build(view){
   view.classList.add('homev4');const style=node('style',css);view.append(style);
   const top=node('div',null,'homev4-top'),titles=node('div'),buttons=node('div',null,'homev4-switch');
   titles.append(node('h2','한국장 중심 · 핵심 지수','homev4-title'),node('p',null,'homev4-sub'));
   for(const [id,label] of [['AUTO','자동'],['KR','한국'],['US','미국']]){
    const b=node('button',label);b.type='button';b.dataset.region=id;b.addEventListener('click',()=>{scope=id;render(view,ctxRef)});buttons.append(b);
   }
   top.append(titles,buttons);
   const main=node('div',null,'homev4-main'),support=node('div',null,'homev4-support'),bottom=node('div',null,'homev4-bottom'),summary=node('section',null,'homev4-panel homev4-summary'),assets=node('section',null,'homev4-panel homev4-assets');
   bottom.append(summary,assets);
   const actions=node('div',null,'homev4-actions');for(const [label,path] of [['시장 상세','market'],['산업·테마','sectors'],['투자전략','strategy']])actions.append(act(label,path));
   view.append(top,main,node('p','보조 지표 · 다른 시장의 최근 수신값','homev4-muted'),support,bottom,actions);
   viewRef=view;
  },
  refresh:(ctx,force)=>{
   const region=effective(),base=[...root.HomeMarketPolicy.MAIN[region],...root.HomeMarketPolicy.SECONDARY[region]].map(x=>x[0]);
   return ctx.market(force,[...new Set(base)].filter(id=>id!=='k4'));
  },
  update(view,ctx){ctxRef=ctx;render(view,ctx)}
 });
 function tick(){if(!active)return;const delay=60000-Date.now()%60000+50;timer=setTimeout(()=>{if(active){if(scope==='AUTO')render(viewRef,ctxRef);tick()}},delay)}
 return {
  mount(container,ctx){active=true;ctxRef=ctx;legacy.mount(container,ctx);tick()},
  refresh:(ctx,force)=>legacy.refresh(ctx,force),
  unmount(){active=false;if(timer!==null){clearTimeout(timer);timer=null}ctxRef=null;viewRef=null;legacy.unmount()},
  getStatus:()=>({...legacy.getStatus(),market:effective(),scope})
 };
});
})(window);
