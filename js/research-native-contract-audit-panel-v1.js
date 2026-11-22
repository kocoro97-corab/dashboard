/* Development-only safe-DOM native contract readiness panel.
 * Uses the audited synthetic public return shapes; never fetches live prices.
 */
(function(root){
'use strict';
const labels=Object.freeze({
 home:'홈 지수 단일 시세',sector:'산업 페이지 21일 시계열',
 industry:'산업 구성종목 표본',stock:'종목 일봉 기술분석',
 breadth:'시장 전체 상승/하락 폭',calendar:'거래소 휴장/종가 검증',
 history:'날짜별 저장 계약',intraday:'단타 분봉 증거'
});
const status=Object.freeze({
 'structure-present':'형식상 존재','partial-structure':'일부 자료',
 blocked:'검증 보류',absent:'미수신','not-exported':'외부 접근 불가',
 'proxy-only':'대리지표 한정',unavailable:'미제공',unverified:'미검증',
 'not-connected':'미연결'
});
function mount(host,input){
 if(!host||typeof host.replaceChildren!=='function'||!host.ownerDocument)
  return {ok:false,code:'INVALID_HOST'};
 const doc=host.ownerDocument;
 let disposed=false,current=null;
 const create=(tag,text,cls)=>{
  const node=doc.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
 };
 const section=create('section',undefined,'native-contract-panel');
 const css=create('style');
 css.textContent='.native-contract-panel{margin-top:15px;background:#102338;border:1px solid #426081;border-radius:11px;padding:14px;min-width:0;color:#d9ecff;font:12px/1.6 system-ui,"Malgun Gothic",sans-serif}.native-contract-panel h3{font-size:16px;margin:0 0 7px}.native-contract-panel p{margin:4px 0}.native-contract-panel .gate-note{color:#f0d6a8}.native-contract-panel .gate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}.native-contract-panel .gate-card{padding:9px;background:#19314c;border-radius:8px;min-width:0}.native-contract-panel .gate-card b{display:block;overflow-wrap:anywhere}.native-contract-panel .gate-card small{color:#aed1ed;display:block}.native-contract-panel details{margin-top:10px}.native-contract-panel summary{cursor:pointer;min-height:32px}.native-contract-panel ul{margin:8px 0;padding-left:20px;display:grid;gap:4px}.native-contract-panel li{overflow-wrap:anywhere}@media(max-width:620px){.native-contract-panel .gate-grid{grid-template-columns:1fr}}';
 host.append(css,section);
 function draw(next){
  if(disposed)return {ok:false,code:'DESTROYED'};
  const engine=root.MYInvestNativeDataContractAuditV1;
  current=typeof engine?.audit==='function'?engine.audit(next):null;
  section.replaceChildren();
  section.append(create('h3','현재 대시보드 데이터 → 리포트 연결 가능성'),
   create('p','이 화면은 기존 반환 객체와 같은 형식의 합성 자료를 검사합니다. 실제 공급자 조회나 계좌 자료를 사용하지 않습니다.','gate-note'));
  if(!current||current.status==='blocked'){
   section.append(create('p','계약 입력 형식이 잘못되어 검사 결과를 표시할 수 없습니다.','gate-note'));
   return {ok:true,status:'blocked'};
  }
  section.append(create('p','검토 대상: '+(current.market==='KR'?'한국':'미국')+
   ' · 미충족 확인항목 '+current.totalMissing+'건 · 실제 리포트 실데이터 연결: 보류','gate-note'));
  const grid=create('div',undefined,'gate-grid');
  for(const row of current.layers){
   const item=create('div',undefined,'gate-card');
   item.append(create('b',labels[row.name]||'자료 계층'),
    create('small',status[row.status]||'확인 필요'));
   grid.append(item);
  }
  section.append(grid);
  const all=create('details');all.setAttribute('data-contract-reasons','');
  all.append(create('summary','미충족 사유 '+current.totalMissing+'건 확인'));
  const list=create('ul');
  for(const item of current.needs){
   const row=create('li');
   row.append(create('strong',item.code+' · '),doc.createTextNode(item.description));
   list.append(row);
  }
  all.append(list);section.append(all);
  section.append(create('p','SPY·섹터 ETF는 지수·산업 전체 증거가 아니며, 데이터 수신시각은 확정 종가 인증이 아닙니다.','gate-note'));
  return {ok:true,status:current.status};
 }
 const result=draw(input);
 return {ok:true,initialStatus:result.status,
  update:next=>draw(next),
  getStatus:()=>current?.status||'blocked',
  destroy(){disposed=true;current=null;host.replaceChildren()}
 };
}
const api=Object.freeze({mount});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestNativeContractAuditPanelV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
