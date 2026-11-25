/* MY INVEST V2 — day/swing comparison with optional public-analysis projection.
 * No direct API, storage, accounts, orders, HTML injection or navigation.
 */
(function(root){
'use strict';
const DEFAULT={
 common:{market:'KR',capital:10000000,cashAvailable:5000000,
  usedExposure:0,usedOpenRisk:0,feeBps:10,slippageBps:20,lotSize:1},
 day:{entry:50000,stop:48000,target:57000,riskPct:1,allocationPct:20,stressGapPct:5},
 swing:{entry:50000,stop:46000,target:62000,riskPct:1.5,allocationPct:25,stressGapPct:8}
};
const COMMON=[['capital','가상 총자본','금액'],['cashAvailable','가용 현금','금액'],
 ['usedExposure','이미 배분된 금액','금액'],['usedOpenRisk','기존 미청산 위험','금액'],
 ['feeBps','편도 수수료','bp'],['slippageBps','편도 슬리피지','bp'],
 ['lotSize','거래단위','주']];
const MODE_FIELDS=[['entry','진입가','금액'],['stop','손절가','금액'],
 ['target','목표가','금액'],['riskPct','위험예산 요청','%'],
 ['allocationPct','배분 요청','%'],['stressGapPct','손절 이후 급락 가정','%']];
const WARN={
 REQUESTED_RISK_POLICY_CAPPED:'요청 위험예산이 모드 정책에 따라 줄었습니다.',
 REQUESTED_ALLOCATION_POLICY_CAPPED:'요청 배분금이 모드 정책에 따라 줄었습니다.',
 NO_REMAINING_OPEN_RISK_BUDGET:'남은 미청산 위험예산이 없습니다.',
 NO_REMAINING_ALLOCATION:'남은 배분예산이 없습니다.',
 INSUFFICIENT_CASH_FOR_LOT:'현금이 최소 거래단위보다 부족합니다.',
 REWARD_RISK_BELOW_MODE_THRESHOLD:'비용 반영 손익비가 최소 기준에 미달합니다.',
 ZERO_HYPOTHETICAL_QUANTITY:'가상 수량이 0입니다.',
 MARKET_CLOSE_DATA_NOT_QUALIFIED:'시장 종가 데이터는 확인되지 않았습니다.',
 OUTSIDE_REGULAR_CLOCK_WINDOW:'현재 시장 정규장 시간대가 아닙니다.',
 NO_EXCHANGE_OR_QUOTE_TRUTH_VERIFICATION:'거래소 개장·시세 진위는 확인되지 않았습니다.',
 GAP_SLIPPAGE_FEES_AND_TAXES_MAY_EXCEED_ASSUMPTIONS:'실제 손실·세금·체결 비용은 가정을 초과할 수 있습니다.'
};
const CSS='.msc1{max-width:1120px;margin:auto;display:grid;gap:12px;color:#e8edf7;font:14px system-ui,sans-serif}.msc1 *{box-sizing:border-box}.msc1 header,.msc1 article,.msc1 section.msc1-frame{border:1px solid #36506c;background:#142137;border-radius:13px;padding:14px;min-width:0}.msc1 h1,.msc1 h2,.msc1 h3{margin:0 0 9px}.msc1 h1{font-size:22px}.msc1 h2{font-size:17px}.msc1 h3{font-size:15px}.msc1 p{line-height:1.5;margin:7px 0}.msc1 .muted{font-size:12px;color:#c0cede}.msc1 .warning{color:#ffd7a1}.msc1 .shared{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.msc1 .modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.msc1 .fields,.msc1 .stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.msc1 label{display:grid;gap:4px;min-width:0}.msc1 label span{font-size:12px;color:#c2d2e8}.msc1 label small{font-size:10px;color:#8eaccd}.msc1 input,.msc1 select{border:1px solid #5a718c;border-radius:8px;background:#0c192a;color:white;padding:9px;min-height:42px;min-width:0;width:100%;font:inherit}.msc1 button{border:1px solid #5579a4;border-radius:8px;background:#244a6d;color:#fff;min-height:42px;padding:9px 13px;margin:7px 6px 4px 0;cursor:pointer}.msc1 button:focus-visible,.msc1 input:focus,.msc1 select:focus{outline:2px solid #93cfff;outline-offset:2px}.msc1 .stat{padding:9px;border:1px solid #314862;background:#0e1b2f;border-radius:8px;min-width:0;overflow-wrap:anywhere}.msc1 .stat small{font-size:11px;color:#bdcde1;display:block}.msc1 .stat strong{font-size:17px;display:block;margin-top:4px;font-variant-numeric:tabular-nums}.msc1 ul{padding-left:18px;margin:5px 0}.msc1 li{font-size:12px;margin:5px 0;color:#c1d2e5}.msc1 .delta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}@media(max-width:780px){.msc1 .shared{grid-template-columns:repeat(2,minmax(0,1fr))}.msc1 .delta{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.msc1 .modes{grid-template-columns:1fr}.msc1 header,.msc1 article,.msc1 section.msc1-frame{padding:11px}}@media(max-width:370px){.msc1 .delta{grid-template-columns:1fr}}';
const number=text=>text.trim()===''?NaN:Number(text);
const format=(value,currency,digits=0)=>Number.isFinite(value)?
 value.toLocaleString('ko-KR',{maximumFractionDigits:digits})+(currency==='KRW'?'원':'달러'):'미계산';
function mount(host,{linked=false}={}){
 if(!host||typeof host.replaceChildren!=='function'||!host.ownerDocument)
  return {ok:false,code:'INVALID_MOUNT_TARGET'};
 const doc=host.ownerDocument,inputs={},modeInputs={day:{},swing:{}};
 const make=(tag,text,cls)=>{
  const x=doc.createElement(tag);
  if(text!==undefined)x.textContent=text;
  if(cls)x.className=cls;
  return x;
 };
 const page=make('section',undefined,'msc1');
 const style=make('style');style.textContent=CSS;page.append(style);
 const header=make('header');
 header.append(make('h1','단타·스윙 가상 시나리오 비교'),
  make('p','직접 입력한 숫자로 단타와 스윙을 각각 비교합니다. 같은 자본에 대한 대안이며 두 포지션을 동시에 보유한 것으로 계산하지 않습니다.','muted'),
  make('p',linked?'선택 종목의 공개 일봉을 연결합니다. 자본·현금·기존 배분·미청산 위험은 직접 입력하세요. 비용·위험 비율은 가정이며 계좌·주문은 연결하지 않습니다.':'초기 입력은 합성 예시입니다. 실제 시세·계좌·주문 데이터는 연결하지 않았습니다.','warning'));
 page.append(header);
 const linkArea=make('section',undefined,'msc1-frame'),linkText=make('p'),caseSelect=make('select'),applyMarket=make('button','수신 일봉 조건 다시 적용');
 caseSelect.setAttribute('aria-label','일봉 스윙 조건');applyMarket.type='button';
 if(linked){linkArea.dataset.marketLink='unavailable';linkText.textContent='선택 종목의 공개 일봉 미연결 · 위에서 종목을 선택하세요.';linkArea.append(linkText,caseSelect,applyMarket);page.append(linkArea)}
 const shared=make('section',undefined,'msc1-frame');
 shared.append(make('h2','1. 공통 자본·비용 가정'));
 const sharedGrid=make('div',undefined,'shared'),marketWrap=make('label');
 marketWrap.append(make('span','시장 · 통화'));
 const market=make('select');market.setAttribute('aria-label','시장 · 통화');
 market.disabled=linked;
 for(const [value,text] of [['KR','한국 · KRW'],['US','미국 · USD']]){
  const option=make('option',text);option.value=value;market.append(option);
 }
 marketWrap.append(market);sharedGrid.append(marketWrap);
 function buildField(parent,key,label,unit,value,group){
  const wrap=make('label');
  wrap.append(make('span',label),make('small',unit));
  const entry=make('input');entry.type='number';entry.inputMode='decimal';
  entry.step=key==='lotSize'?'1':'any';entry.value=linked&&((group!=='공통'&&['entry','stop','target'].includes(key))||['capital','cashAvailable','usedExposure','usedOpenRisk'].includes(key))?'':String(value);
  entry.setAttribute('aria-label',group+' · '+label);
  wrap.append(entry);parent.append(wrap);
  return entry;
 }
 for(const [key,label,unit] of COMMON)
  inputs[key]=buildField(sharedGrid,key,label,unit,DEFAULT.common[key],'공통');
 shared.append(sharedGrid);
 const calc=make('button','가상 수량·손익 비교');
 calc.type='button';calc.setAttribute('data-action','compare');
 const reset=make('button',linked?'입력 초기화':'합성 예시 초기화');
 reset.type='button';reset.setAttribute('data-action','reset');
 shared.append(calc,reset);page.append(shared);
 const modes=make('div',undefined,'modes'),outputs={};
 for(const mode of ['day','swing']){
  const article=make('article');article.setAttribute('data-scenario',mode);
  article.append(make('h2',mode==='day'?'2. 단타 설정':'3. 스윙 설정'));
  const fields=make('div',undefined,'fields');
  for(const [key,label,unit] of MODE_FIELDS)
   modeInputs[mode][key]=buildField(fields,key,label,unit,DEFAULT[mode][key],mode);
  article.append(fields);
  outputs[mode]=make('div');outputs[mode].setAttribute('data-result',mode);
  article.append(outputs[mode]);modes.append(article);
 }
 page.append(modes);
 const difference=make('section',undefined,'msc1-frame');
 difference.setAttribute('data-result','comparison');page.append(difference);
 page.append(make('p','시장 시간대는 기기 현재 시각으로만 계산합니다. 실제 거래소 운영·실시간 호가·종목 상장 여부·세금·유동성은 검증하지 않습니다. 가상 계산은 주문 승인과 무관합니다.','muted'));
 host.replaceChildren(page);
 let disposed=false,last=null,marketState=null,lastIdentity='',priceDirty=false;
 const unit=()=>market.value==='KR'?'KRW':'USD';
 function snapshot(){
  const common={market:market.value,currency:unit(),now:Date.now()};
  for(const [key] of COMMON)common[key]=number(inputs[key].value);
  const scenarios={};
  for(const mode of ['day','swing']){
   const row={};
   for(const [key] of MODE_FIELDS)row[key]=number(modeInputs[mode][key].value);
   scenarios[mode]=row;
  }
  return {common,scenarios};
 }
 function stat(parent,label,value){
  const item=make('div',undefined,'stat');
  item.append(make('small',label),make('strong',value));parent.append(item);
 }
 function drawMode(mode,result,reason){
  const out=outputs[mode];out.replaceChildren();
  if(!result||result.status==='invalid'){
   const messages={MARKET_LINK_UNAVAILABLE:'선택 종목의 공개 일봉 연결을 먼저 확인하세요.',INVALID_CAPITAL_OR_LONG_PRICE:'자본·현금·가격을 확인하세요. 손절가 < 진입가 < 목표가가 필요합니다.',INVALID_RISK_ASSUMPTIONS:'비용·위험 비율과 정수 거래단위를 확인하세요.',INVALID_MODE_MARKET_CURRENCY:'선택 종목의 시장·통화를 확인하세요.'};
   out.append(make('p','입력 확인: '+(messages[result?.reason||reason]||'계산 입력값과 모듈 연결을 확인하세요.'),'warning'));
   return;
  }
  out.append(make('h3',result.status==='hypothetical'?'가상 계획 산출':'조건 재검토 필요'));
  const tiles=make('div',undefined,'stats');
  stat(tiles,'가상 수량',result.quantity.toLocaleString('ko-KR')+'주');
  stat(tiles,'투입 가정금',format(result.cost,unit()));
  stat(tiles,'손절 가정손실',format(result.baseRisk,unit()));
  stat(tiles,'갭 급락 가정손실',format(result.stressRisk,unit()));
  stat(tiles,'목표 가정이익',format(result.reward,unit()));
  stat(tiles,'비용 반영 손익비',Number.isFinite(result.rewardRisk)?result.rewardRisk.toFixed(2)+':1':'미확인');
  out.append(tiles);
  const ul=make('ul');
  for(const code of [...new Set(result.warnings)])
   ul.append(make('li',WARN[code]||'추가 확인: '+code));
  out.append(ul);
 }
 function drawDifference(result){
  difference.replaceChildren();
  difference.append(make('h2','4. 스윙 − 단타 비교'));
  if(!result||result.status==='invalid'||result.status==='invalid-scenarios'){
   difference.append(make('p','입력값을 확인하세요. 조건이 유효하지 않아 가상 차이를 계산하지 않았습니다.','warning'));
   return;
  }
  if(!result.comparable){
   difference.append(make('p','두 가상 계획 모두 유효할 때만 수량·손실·이익 차이를 비교합니다.','warning'));
   return;
  }
  const delta=result.comparison;
  const grid=make('div',undefined,'delta');
  stat(grid,'수량 차이',delta.swingMinusDayQuantity.toLocaleString('ko-KR')+'주');
  stat(grid,'투입금 차이',format(delta.swingMinusDayCost,unit()));
  stat(grid,'급락 손실 차이',format(delta.swingMinusDayStressRisk,unit()));
  stat(grid,'목표이익 차이',format(delta.swingMinusDayPotentialGain,unit()));
  stat(grid,'손익비 차이',delta.swingMinusDayRewardRisk.toFixed(2));
  difference.append(grid,make('p',result.note,'muted'));
 }
 function calculate(){
  if(disposed)return {status:'invalid',code:'UNMOUNTED'};
  const result=(linked&&(marketState?.status!=='ready'||market.value!==marketState.market)?{status:'invalid',code:'MARKET_LINK_UNAVAILABLE'}:root.MYInvestStrategyScenarioCompareV1?.compare?.(snapshot()))||
   {status:'invalid',code:'COMPARE_ENGINE_MISSING'};
  last=result;
  drawMode('day',result.day,result.code);drawMode('swing',result.swing,result.code);
  drawDifference(result);
  return result;
 }
 function resetAll(){
  if(disposed)return;
  if(linked){
   for(const [key] of COMMON)inputs[key].value=['capital','cashAvailable','usedExposure','usedOpenRisk'].includes(key)?'':String(DEFAULT.common[key]);
   for(const mode of ['day','swing'])for(const key of ['riskPct','allocationPct','stressGapPct'])modeInputs[mode][key].value=String(DEFAULT[mode][key]);
   priceDirty=false;clearPrices();if(marketState?.status==='ready')applyReference();else calculate();return;
  }
  market.value='KR';
  for(const [key] of COMMON)inputs[key].value=String(DEFAULT.common[key]);
  for(const mode of ['day','swing'])
   for(const [key] of MODE_FIELDS)modeInputs[mode][key].value=String(DEFAULT[mode][key]);
  calculate();
 }
 function clearPrices(){for(const mode of ['day','swing'])for(const key of ['entry','stop','target'])modeInputs[mode][key].value=''}
 function applyReference(){
  if(disposed||marketState?.status!=='ready')return;
  clearPrices();modeInputs.day.entry.value=String(marketState.lastClose);
  const choice=marketState.cases[Number(caseSelect.value)];
  if(choice){for(const key of ['entry','stop','target'])modeInputs.swing[key].value=String(choice[key])}
  else modeInputs.swing.entry.value=String(marketState.lastClose);
  priceDirty=false;calculate();
 }
 function updateMarket(state){
  if(disposed||!linked)return;
  if(!state||state.status!=='ready'){
   marketState=null;clearPrices();priceDirty=false;caseSelect.replaceChildren();caseSelect.disabled=true;applyMarket.disabled=true;
   linkArea.dataset.marketLink=state?.status||'unavailable';
   linkText.textContent=state?.status==='loading'?'공개 일봉 조회 중 · 이전 가격 조건을 정리했습니다.':'공개 일봉 미연결 또는 검증 실패 · 종목·통화·출처·봉 기준시각을 확인하고 페이지를 갱신하세요.';
   calculate();return;
  }
  const identity=state.market+':'+state.symbol+':'+state.currency;
  if(lastIdentity&&lastIdentity!==identity){clearPrices();priceDirty=false}
  if(market.value!==state.market||(marketState&&marketState.currency!==state.currency)||(lastIdentity&&lastIdentity.split(':').at(-1)!==state.currency))
   for(const key of ['capital','cashAvailable','usedExposure','usedOpenRisk'])inputs[key].value='';
  lastIdentity=identity;marketState=state;market.value=state.market;
  linkArea.dataset.marketLink='ready';
  const fmtTime=t=>new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST';
  linkText.textContent=state.name+' ('+state.symbol+') · '+state.exchange+' · 일봉 기준 가격 '+format(state.lastClose,state.currency,4)+' · '+state.source+' · 봉 기준 '+fmtTime(state.barAt)+' (봉 시작 기준·종가 확정 미검증) · 수신 '+fmtTime(state.receivedAt)+' · 실시간 현재가 아님. 단타 손절·목표는 분봉 미연결로 직접 입력합니다. 스윙은 기존 일봉 조건부 계산입니다.';
  const oldChoice=caseSelect.value;caseSelect.replaceChildren();
  state.cases.forEach((s,i)=>{const option=make('option',s.name);option.value=String(i);caseSelect.append(option)});
  caseSelect.value=/^\d+$/.test(oldChoice)&&state.cases[Number(oldChoice)]?oldChoice:'0';caseSelect.disabled=!state.cases.length;applyMarket.disabled=false;
  if(!priceDirty)applyReference();else calculate();
 }
 for(const mode of ['day','swing'])for(const key of ['entry','stop','target'])modeInputs[mode][key].addEventListener('input',()=>{priceDirty=true});
 applyMarket.addEventListener('click',applyReference);caseSelect.addEventListener('change',applyReference);
 calc.addEventListener('click',calculate);
 reset.addEventListener('click',resetAll);
 market.addEventListener('change',calculate);
 calculate();
 return {ok:true,calculate,reset:resetAll,updateMarket,
  status:()=>last?.status||'unavailable',
  destroy:()=>{disposed=true;host.replaceChildren()}};
}
const api=Object.freeze({mount});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestScenarioComparePanelV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
