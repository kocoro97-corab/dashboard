// ===== Nhplug.gs : NH투자증권(나무) PLUG 오픈API — 시세·계좌 "조회 전용" =====
// 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 아래 두 개를 직접 입력하세요. 코드·채팅에 적지 마세요.
//   NHPLUG_APP_KEY, NHPLUG_APP_SECRET
// 이 파일의 함수는 편집기에서 직접 실행하는 진단용입니다. doGet/doPost에 연결하기 전까지
// /exec 주소로는 호출되지 않습니다(계좌 정보 노출 방지).

// Thin UI compatibility adapters. All outbound NH traffic lives in NhGatewayV2.gs.
let NH_GATEWAY_V2_INSTANCE;
function nhGatewayV2_(){
  if(!NH_GATEWAY_V2_INSTANCE)NH_GATEWAY_V2_INSTANCE=createNhGatewayV2_({
    fetch:(url,options)=>UrlFetchApp.fetch(url,options),
    properties:()=>PropertiesService.getScriptProperties(),now:()=>Date.now(),sleep:ms=>Utilities.sleep(ms),
    withLock:fn=>{const lock=LockService.getScriptLock();lock.waitLock(15000);try{return fn()}finally{lock.releaseLock()}}
  });
  return NH_GATEWAY_V2_INSTANCE;
}
function nhRequest_(origin,path,method,purpose,data){return nhGatewayV2_().request(origin,path,method,purpose,data)}
function nhHeader_(headers, name) {
  const lower = name.toLowerCase();
  for (const k in headers) if (k.toLowerCase() === lower) return headers[k];
  return '';
}

// 접근토큰: 24시간 유효. 스크립트 속성에 만료시각과 함께 캐시해 재사용한다(재발급은 보안 알림을 유발).
// Only locally defined codes and validated HTTP statuses may cross diagnostic boundaries.
const NH_DIAGNOSTIC_CODES=['NH_OK','NH_TOKEN','NH_CONFIG','NH_NETWORK','NH_JSON','NH_HTTP','NH_RSP','NH_PATH','NH_REFERENCE_UNAVAILABLE','NH_REFERENCE_INVALID','NH_IDENTITY_UNVERIFIED','NH_IDENTITY_AMBIGUOUS','NH_CURRENCY_MISMATCH','NH_SYMBOL_MISMATCH','NH_NO_BLOCK','NH_NO_PRICE','NH_CONTRACT','NH_UNSUPPORTED','NH_UPSTREAM','NH_SPEC_OK','NH_SPEC_FAILED','NH_ACCOUNTS_OK','NH_DOMESTIC_OK','NH_OVERSEAS_OK','NH_FUTURE_OK'];
function nhSafeDiagnostic_(error) {
  const code=error&&NH_DIAGNOSTIC_CODES.indexOf(error.safeCode)>=0?error.safeCode:'NH_UPSTREAM';
  const http=error&&Number.isInteger(error.safeHttp)&&error.safeHttp>=100&&error.safeHttp<=599?error.safeHttp:null;
  return {code:code,http:http};
}
function nhFailure_(code,http) {
  const safe=nhSafeDiagnostic_({safeCode:code,safeHttp:http});
  const error=new Error(safe.code+(safe.http?' / HTTP '+safe.http:''));
  error.safeCode=safe.code;error.safeHttp=safe.http;return error;
}
function nhSafeErrorText_(error){const d=nhSafeDiagnostic_(error);return d.code+(d.http?' / HTTP '+d.http:'')}
function nhLog_(code,http){Logger.log('NH_DIAGNOSTIC / '+nhSafeErrorText_({safeCode:code,safeHttp:http}))}
function nhRspCode_(value){return ['0','0000','00000','00166','00218','PARSE'].indexOf(value)>=0?value:value?'UNRECOGNIZED':null}
function nhAssertResponse_(r){
  if(!r||r.http!==200)throw nhFailure_('NH_HTTP',r&&r.http);
  const b=r.body;if(!b||typeof b!=='object'||Array.isArray(b)||b.rsp_cd==='PARSE')throw nhFailure_('NH_JSON',r.http);
  const code=String(b.rsp_cd||'');if(code&&!/^0+$/.test(code)&&code!=='00166'&&code!=='00218')throw nhFailure_('NH_RSP',r.http);
}
function nhToken_(force) {
  try{return nhLoadToken_(force)}catch(error){const d=nhSafeDiagnostic_(error);throw nhFailure_(d.code==='NH_UPSTREAM'?'NH_TOKEN':d.code,d.http)}
}
function nhLoadToken_(force){return nhGatewayV2_().token(force)}
function nhReadCall_(path,input,opt){return nhGatewayV2_().read(path,input,opt,force=>nhToken_(force))}
function nhCall_(path,input,opt){try{return nhReadCall_(path,input,opt)}catch(error){const d=nhSafeDiagnostic_(error);throw nhFailure_(d.code==='NH_UPSTREAM'?'NH_NETWORK':d.code,d.http)}}

// ---------- 진단 함수 (편집기에서 선택해 ▶ 실행, 실행 로그 확인) ----------

// 1) 토큰 발급 확인 (토큰 값은 출력하지 않음)
function nhTestToken() {
  try{nhToken_(false);nhLog_('NH_OK')}catch(error){const d=nhSafeDiagnostic_(error);nhLog_(d.code,d.http)}
}

// 2) 계좌 목록 호출 상태만 확인 (식별값·수량·원문 메시지 출력 금지)
function nhTestAccounts() {
  try{const r=nhCall_('/n2/acctinfo',{});nhAssertResponse_(r);nhLog_('NH_ACCOUNTS_OK',r.http)}catch(error){const d=nhSafeDiagnostic_(error);nhLog_(d.code,d.http)}
}

// 3) 선물 시세(주간) 호출 형식 탐색: 코스피200(대조군)과 코스닥150 월물 코드 후보를 하나씩 시험한다.
//    결과에는 안전한 상태 코드만 남긴다.
function nhProbeFutQuote() {
  const candidates = [
    ['코스피200 대조', 'KR4A016C0004'],
    ['코스피200 대조', 'A016C000'],
    ['코스닥150 후보', 'KR4A066C0003'],
    ['코스닥150 후보', 'A066C000']
  ];
  candidates.forEach(function (c) {
    try{const r=nhCall_('/krfuture/quote/v1/day',{iem_cd:c[1]});nhAssertResponse_(r);nhLog_('NH_FUTURE_OK',r.http)}catch(error){const d=nhSafeDiagnostic_(error);nhLog_(d.code,d.http)}
  });
}

// ---------- 명세 확인용 (공개 명세만 읽음: 키·토큰·계좌 정보 없이 실행됨) ----------

// 명세 파일 내려받기: 일시적 오류가 나면 잠시 쉬었다가 최대 4번까지 다시 시도
function nhFetchSpec_(g) {
  const path='/openapi-docs/'+g+'/openapi.json';
  nhGatewayV2_().validate('https://www.nhplug.com',path,'get','spec');
  for (let i = 1; i <= 4; i++) {
    try {
      const res = nhRequest_('https://www.nhplug.com',path,'get','spec');
      return JSON.parse(res.getContentText());
    } catch (e) {
      nhLog_('NH_SPEC_FAILED');
      if(e&&e.safeCode==='NH_HTTP'&&e.safeHttp>=300&&e.safeHttp<400)return null;
      if (i < 4) Utilities.sleep(2500 * i);
    }
  }
  return null;
}

// groups = { 그룹명: [경로 정규식, ...] } — 그룹별로 시세·조회 경로 목록을 찍고,
// 원문 명세 대신 로드 상태만 기록한다.
function nhDumpGroups_(groups) {
  Object.keys(groups).forEach(function (g) {
    const spec = nhFetchSpec_(g);
    if (!spec) return;
    // The specification is upstream content too: never dump descriptions or field names.
    nhLog_('NH_SPEC_OK');
  });
}

// 4) 1차 명세 요약 (이미 실행해 로그를 받았습니다)
function nhDumpSpec() {
  nhDumpGroups_({
    krfuture: [/\/krfuture\/quote\/v1\/(day|daily)$/],
    krstock:  [/\/krstock\/quote\/v1\/currentPrice$/, /\/krstock\/inquiry\/v1\/balance$/],
    gbstock:  [/\/gbstock\/quote\/v1\/[^/]*(current|price)[^/]*$/i, /\/gbstock\/inquiry\/v1\/balance$/]
  });
}

// 5) 2차 명세 요약: 지수·환율·해외선물·시장 수급을 NH로 받을 수 있는지 확인
//    - krstock period / currentInvestor : 국내 지수나 시장 수급이 들어 있는지
//    - gbstock symbolIndexFxPeriod / period : 해외 지수·환율이 들어 있는지
//    - gbfuture 현재가 : 나스닥·S&P·유가 선물 등을 받을 수 있는지
function nhDumpSpec2() {
  nhDumpGroups_({
    krstock:  [/\/krstock\/quote\/v1\/(period|currentInvestor)$/],
    gbstock:  [/\/gbstock\/quote\/v1\/(symbolIndexFxPeriod|period)$/],
    gbfuture: [/\/gbfuture\/quote\/v1\/[^/]*(current|price)[^/]*$/i]
  });
}

// ---------- 대시보드용: 선물 시세 (5단계) ----------

// 한국 시간 기준 현재 시각
function nhKstNow_() {
  const p = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-M-d-H-m').split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2], hh: p[3], mm: p[4] };
}

// 매월 둘째 목요일(선물 최종거래일)의 날짜
function nhSecondThursday_(y, m) {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0=일요일
  return 1 + ((4 - dow + 7) % 7) + 7;
}

// 가장 가까운 분기월(3·6·9·12) 선물 코드. 상품 앞부분 A01=코스피200, A06=코스닥150.
// 형식: 앞부분 + 연도 끝 한 자리 + 월(1~9, A=10, B=11, C=12) + 000  예) 2026년 12월물 → A066C000
// 최종거래일 15:45 이후에는 다음 분기월로 넘어간다.
function nhFutCode_(prefix, now) {
  const n = now || nhKstNow_();
  const QM = [3, 6, 9, 12];
  for (let add = 0; add < 3; add++) {
    const y = n.y + add;
    for (let i = 0; i < QM.length; i++) {
      const m = QM[i], ed = nhSecondThursday_(y, m);
      const valid = y > n.y || m > n.m || (m === n.m && (n.d < ed || (n.d === ed && n.hh * 60 + n.mm < 945)));
      if (valid) return prefix + (y % 10) + '123456789ABC'.charAt(m - 1) + '000';
    }
  }
  throw nhFailure_('NH_CONTRACT');
}

function nhNum_(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[,+\s]/g, ''));
  return isFinite(n) ? n : null;
}

// 선물 시세 응답 → {p 현재가, prev 전일 기준, basis 베이시스, t 시각, name, code, dir 등락 판정 근거}
// 등락부호(sign)는 상승일 때 빈 값으로 확인됐고 하락일의 값은 아직 모른다.
// 그래서 sign → 등락폭의 부호 → 기준가(sdpr)와의 비교 순서로 방향을 정하고, 어느 근거를 썼는지 dir에 남긴다.
function nhFutNorm_(o0, o1) {
  const p = nhNum_(o0.prpr);
  if (p == null || p <= 0) return null;
  const vr = nhNum_(o0.vrss), sd = nhNum_(o0.sdpr);
  const sg = String(o0.sign == null ? '' : o0.sign).trim();
  let dir = 0, how = '';
  if (/^(4|5|-|▼|하락|하한)$/.test(sg)) { dir = -1; how = 'sign'; }
  else if (/^(1|2|\+|▲|상승|상한)$/.test(sg)) { dir = 1; how = 'sign'; }
  else if (sg === '3' || /보합/.test(sg)) { dir = 0; how = 'sign'; }
  else if (vr != null && vr < 0) { dir = -1; how = 'vrss'; }
  else if (sd != null && sd > 0 && Math.abs(p - sd) > 1e-9) { dir = p > sd ? 1 : -1; how = 'sdpr'; }
  else { dir = 1; how = 'assume'; }
  let prev;
  if (vr != null) prev = (vr === 0) ? p : p - dir * Math.abs(vr);
  else if (sd != null && sd > 0) prev = sd;
  else return null;
  const unas = o1 ? nhNum_(o1.unas_prpr) : null;
  const basis = unas != null ? p - unas : nhNum_(o0.mrkt_basis);
  return { p: p, prev: prev, basis: basis, t: String(o0.bsop_hour || ''), name: String(o0.iem_nm || ''), code: String(o0.iem_cd || ''), dir: how };
}

// 선물 1종목 조회 (5초 캐시로 연속 호출 보호)
function nhFutQuote_(prefix) {
  const code = nhFutCode_(prefix);
  const cache = CacheService.getScriptCache();
  const hit = cache.get('nhq_' + code);
  if (hit) return JSON.parse(hit);
  const r = nhCall_('/krfuture/quote/v1/day', { iem_cd: code });
  const o0 = r.body && r.body.Output_0;
  if (r.http !== 200 || !o0 || typeof o0 !== 'object' || o0.prpr == null) {
    throw nhFailure_('NH_HTTP',r.http);
  }
  const nd = nhFutNorm_(o0, r.body.Output_1);
  if (!nd) throw nhFailure_('NH_NO_PRICE');
  cache.put('nhq_' + code, JSON.stringify(nd), 5);
  return nd;
}

// 대시보드 요청 처리: 로그인한 사용자만. items = [{k:'k3', t:'fut', c:'A01'}, ...]
function handleNhQuotes(token, items) {
  if (!sessionUser_(token)) return jsonResponse({ success: false, message: '로그인이 필요합니다. 다시 로그인하세요.' });
  if (!Array.isArray(items) || !items.length || items.length > 40) {
    return jsonResponse({ success: false, message: '요청 형식 오류' });
  }
  const data = {}, errors = {};
  items.forEach(function (it) {
    const k = String((it && it.k) || '').slice(0, 24);
    if (!k) return;
    try {
      if (it.t === 'fut' && /^A0[0-9]$/.test(String(it.c))) data[k] = nhFutQuote_(String(it.c));
      else throw nhFailure_('NH_UNSUPPORTED');
    } catch (e) {
      errors[k] = nhSafeErrorText_(e);
    }
  });
  return jsonResponse({ success: true, data: data, errors: errors });
}

// 편집기 시험은 조회 성공/실패 코드만 기록한다.
function nhTestFutures() {
  ['A01', 'A06'].forEach(function (pf) {
    try {
      const q = nhFutQuote_(pf);
      nhLog_('NH_FUTURE_OK');
    } catch (e) {const d=nhSafeDiagnostic_(e);nhLog_(d.code,d.http)}
  });
}

// ---------- 일반계좌 잔고 조회 전용 (ISA·연금저축·IRP 및 모의계좌 제외) ----------
// 계좌번호는 서버 안에서만 사용하고 브라우저에는 끝 4자리만 전달한다.
function nhReadPaged_(path,input,maxPages){return nhAccountServiceV2_().page(path,input,maxPages)}
function nhAccountBalance_(acctNo,acctType){return nhAccountServiceV2_().balance(acctNo)}

function handleNhAccounts(token) {
  if (!sessionUser_(token)) return jsonResponse({ success: false, message: '로그인이 필요합니다. 다시 로그인하세요.' });
  try {
    const r = nhCall_('/n2/acctinfo', {});
    nhAssertResponse_(r);
    const all = Array.isArray(r.body && r.body.Output_0) ? r.body.Output_0 : [];
    // acct_type 01/02만 운영 일반계좌. 03 모의투자는 이번 화면에서 제외.
    const seen = {};
    const accounts = all.filter(function (a) {
      const no = String(a.acct_no || ''), type = String(a.acct_type || '');
      if (!no || !/^(01|02)$/.test(type) || seen[no]) return false;
      seen[no] = true; return true;
    }).map(function (a) {
      const no = String(a.acct_no);
      const data = nhAccountBalance_(no, String(a.acct_type));
      const accountKey=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token+'|'+no).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
      return {accountKey:accountKey,acctType:String(a.acct_type),domestic:data.domestic,
        overseas: data.overseas, errors: data.errors };
    });
    return jsonResponse({ success: true,gatewayVersion:2,capabilities:nhAccountCapabilitiesV2_(),accounts: accounts, excludedMockCount: all.filter(function (a) { return String(a.acct_type) === '03'; }).length,
      updatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') });
  } catch (e) {
    return jsonResponse({success:false,code:nhSafeDiagnostic_(e).code,message:nhSafeErrorText_(e)});
  }
}

// 편집기 진단: 계좌 식별값(끝자리 포함), 종목, 금액, 원문 오류를 기록하지 않는다.
function nhTestAccountBalances() {
  try{
  const r = nhCall_('/n2/acctinfo', {});
  nhAssertResponse_(r);
  const all = Array.isArray(r.body && r.body.Output_0) ? r.body.Output_0 : [];
  all.filter(function (a) { return /^(01|02)$/.test(String(a.acct_type)); }).forEach(function (a) {
    const x = nhAccountBalance_(String(a.acct_no), String(a.acct_type));
    nhLog_(x.domestic?'NH_DOMESTIC_OK':'NH_UPSTREAM');nhLog_(x.overseas?'NH_OVERSEAS_OK':'NH_UPSTREAM');
  });
  }catch(error){const d=nhSafeDiagnostic_(error);nhLog_(d.code,d.http)}
}


// ---------- 외부계좌 종목의 NH PLUG 국내주식/ETF 현재가 조회 전용 ----------
// 공식 currentPrice 명세의 현재가는 stck_prpr. 기존 응답 필드도 양수인 경우에만 호환한다.
function nhExternalPrice_(o) {
  const fields=['stck_prpr','now_pr','cur_pr','prpr','trd_pr'];
  for(let i=0;i<fields.length;i++) {
    const text=String(o[fields[i]]==null?'':o[fields[i]]).replace(/[,\s]/g,'');
    if(!/^\+?\d+(?:\.\d+)?$/.test(text))continue;
    const n=Number(text);if(isFinite(n)&&n>0)return n;
  }
  return null;
}
function handleNhExternalQuotes(token, codes) {
  if(!sessionUser_(token))return jsonResponse({success:false,code:'AUTH_REQUIRED',layer:'gas',message:'로그인이 필요합니다.'});
  if(!Array.isArray(codes)||!codes.length||codes.length>40)return jsonResponse({success:false,code:'INVALID_CODES',layer:'gas',message:'종목코드는 1~40개까지 요청할 수 있습니다.'});
  const prices=Object.create(null),errors=Object.create(null),diagnostics=Object.create(null),seen=Object.create(null);
  codes.forEach(function(raw,index){
    const code=String(raw==null?'':raw).trim();
    const diagnosticKey=/^[A-Z0-9]{6}$/.test(code)?code:'invalid_'+(index+1);
    function reject(reason,layer,http,rsp,fields){
      http=Number.isInteger(http)&&http>=100&&http<=599?http:null;
      const diagnostic={layer:layer,code:reason,http:http==null?null:http,rspCode:rsp||null,fields:fields||[]};
      diagnostics[diagnosticKey]=diagnostic;
      errors[diagnosticKey]=layer+' / '+reason+(http?' / HTTP '+http:'')+(rsp?' / rsp_cd '+rsp:'');
    }
    if(!/^[A-Z0-9]{6}$/.test(code)){reject('INVALID_SYMBOL','gas');return}
    if(seen[code])return;seen[code]=true;
    try{
      const r=nhCall_('/krstock/quote/v1/currentPrice',{market_cd:'UNT',iem_cd:code});
      const body=r.body||{},block=body.Output_0;
      const o=Array.isArray(block)?(block.find(x=>x&&String(x.iem_cd||'').trim()===code)||block[0]||{}):(block||{});
      const fields=Object.keys(o).filter(k=>['stck_prpr','now_pr','cur_pr','prpr','trd_pr','iem_cd','iem_nm'].indexOf(k)>=0);
      const rawRsp=String(body.rsp_cd==null?'':body.rsp_cd).trim();
      const rsp=nhRspCode_(rawRsp);
      if(r.http!==200){reject('NH_HTTP','nh',r.http,rsp,fields);return}
      if(rsp==='PARSE'){reject('GAS_UPSTREAM_JSON','gas',r.http,rsp,fields);return}
      if(rsp&&!/^0+$/.test(rsp)&&rsp!=='00166'){reject('NH_RSP','nh',r.http,rsp,fields);return}
      if(!block||Array.isArray(block)&&!block.length){reject('NH_NO_BLOCK','nh',r.http,rsp,fields);return}
      if(o.iem_cd&&String(o.iem_cd).trim()!==code){reject('NH_SYMBOL_MISMATCH','nh',r.http,rsp,fields);return}
      const price=nhExternalPrice_(o);
      if(price==null){reject('NH_NO_PRICE','nh',r.http,rsp,fields);return}
      prices[code]={price:price,name:String(o.iem_nm||''),updatedAt:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss')};
    }catch(error){
      // Upstream exceptions can contain URLs with credentials. Classify; never echo them.
      const tokenFailure=/토큰|TOKEN|APP_KEY|APP_SECRET|oauth/i.test(String(error&&error.message||''));
      reject(tokenFailure?'GAS_TOKEN':'GAS_UPSTREAM','gas');
    }
  });
  return jsonResponse({success:true,prices:prices,errors:errors,diagnostics:diagnostics,updatedAt:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss')});
}
