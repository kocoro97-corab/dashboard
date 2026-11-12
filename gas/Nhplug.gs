// ===== Nhplug.gs : NH투자증권(나무) PLUG 오픈API — 시세·계좌 "조회 전용" =====
// 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 아래 두 개를 직접 입력하세요. 코드·채팅에 적지 마세요.
//   NHPLUG_APP_KEY, NHPLUG_APP_SECRET
// 이 파일의 함수는 편집기에서 직접 실행하는 진단용입니다. doGet/doPost에 연결하기 전까지
// /exec 주소로는 호출되지 않습니다(계좌 정보 노출 방지).

const NH_BASE = 'https://api.nhplug.com:8443';

// 조회 경로만 허용. 주문(/order/)은 어떤 경우에도 막는다.
const NH_ALLOWED_PATHS = [
  '/n2/acctinfo',
  '/common/inquiry/',
  '/krfuture/quote/', '/krfuture/inquiry/',
  '/krstock/quote/', '/krstock/inquiry/',
  '/gbstock/quote/', '/gbstock/inquiry/'
];

function nhHeader_(headers, name) {
  const lower = name.toLowerCase();
  for (const k in headers) if (k.toLowerCase() === lower) return headers[k];
  return '';
}

// 접근토큰: 24시간 유효. 스크립트 속성에 만료시각과 함께 캐시해 재사용한다(재발급은 보안 알림을 유발).
function nhToken_(force) {
  const props = PropertiesService.getScriptProperties();
  const cached = function () {
    const tok = props.getProperty('NHPLUG_TOKEN');
    const exp = Number(props.getProperty('NHPLUG_TOKEN_EXP') || 0);
    return (tok && Date.now() < exp - 10 * 60 * 1000) ? tok : '';
  };
  if (!force) { const t = cached(); if (t) return t; }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!force) { const t = cached(); if (t) return t; }   // 기다리는 사이 다른 실행이 발급했을 수 있음
    const key = props.getProperty('NHPLUG_APP_KEY');
    const secret = props.getProperty('NHPLUG_APP_SECRET');
    if (!key || !secret) throw new Error('스크립트 속성에 NHPLUG_APP_KEY / NHPLUG_APP_SECRET 이 없습니다.');
    const url = NH_BASE + '/oauth2/token?appkey=' + encodeURIComponent(key) +
      '&appsecretkey=' + encodeURIComponent(secret) + '&grant_type=client_credentials&scope=oob';
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/x-www-form-urlencoded', payload: '', muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    let body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) { /* 아래에서 처리 */ }
    if (code !== 200 || !body.access_token) {
      // 주소(키 포함)와 응답 본문 전체는 남기지 않는다
      throw new Error('토큰 발급 실패 HTTP ' + code + (body.rsp_msg ? ' ' + String(body.rsp_msg).slice(0, 60) : ''));
    }
    props.setProperty('NHPLUG_TOKEN', body.access_token);
    props.setProperty('NHPLUG_TOKEN_EXP', String(Date.now() + Number(body.expires_in || 86400) * 1000));
    return body.access_token;
  } finally {
    lock.releaseLock();
  }
}

// 공통 호출. 반환: { http, body, cts, cts_flag }
function nhCall_(path, input, opt) {
  const okPath = NH_ALLOWED_PATHS.some(function (p) { return path.indexOf(p) === 0; });
  if (!okPath || path.indexOf('/order/') >= 0) throw new Error('허용되지 않는 경로입니다: ' + path);

  let token = nhToken_(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Authorization: 'Bearer ' + token };
    if (opt && opt.cts) { headers['cts'] = opt.cts; headers['cts_flag'] = opt.cts_flag || 'Y'; }
    const res = UrlFetchApp.fetch(NH_BASE + path, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ Input_0: input || {} }), muteHttpExceptions: true
    });
    const http = res.getResponseCode();
    if (http === 401 && attempt === 0) { token = nhToken_(true); continue; }   // 401일 때만 재발급
    Utilities.sleep(220);   // REST 초당 5건 제한 보호
    let body;
    try { body = JSON.parse(res.getContentText()); }
    catch (e) { body = { rsp_cd: 'PARSE', rsp_msg: String(res.getContentText()).slice(0, 200) }; }
    const h = res.getHeaders();
    return { http: http, body: body, cts: nhHeader_(h, 'cts'), cts_flag: nhHeader_(h, 'cts_flag') };
  }
}

// ---------- 진단 함수 (편집기에서 선택해 ▶ 실행, 실행 로그 확인) ----------

// 1) 토큰 발급 확인 (토큰 값은 출력하지 않음)
function nhTestToken() {
  const t = nhToken_(false);
  const exp = Number(PropertiesService.getScriptProperties().getProperty('NHPLUG_TOKEN_EXP'));
  Logger.log('토큰 OK (길이 ' + t.length + '), 만료까지 약 ' + Math.round((exp - Date.now()) / 3600000) + '시간');
}

// 2) 계좌 목록 확인 (계좌번호는 끝 4자리만 출력)
function nhTestAccounts() {
  const r = nhCall_('/n2/acctinfo', {});
  const list = (r.body && r.body.Output_0) || [];
  Logger.log('HTTP ' + r.http + ' / rsp_cd ' + r.body.rsp_cd + ' / rsp_msg ' + r.body.rsp_msg);
  list.forEach(function (a) {
    Logger.log('acct_type=' + a.acct_type + ' / 계좌 끝 4자리 ' + String(a.acct_no).slice(-4));
  });
}

// 3) 선물 시세(주간) 호출 형식 탐색: 코스피200(대조군)과 코스닥150 월물 코드 후보를 하나씩 시험한다.
//    결과 로그를 그대로 보내 주세요(키·토큰·계좌 정보는 들어 있지 않습니다).
function nhProbeFutQuote() {
  const candidates = [
    ['코스피200 대조', 'KR4A016C0004'],
    ['코스피200 대조', 'A016C000'],
    ['코스닥150 후보', 'KR4A066C0003'],
    ['코스닥150 후보', 'A066C000']
  ];
  candidates.forEach(function (c) {
    const r = nhCall_('/krfuture/quote/v1/day', { iem_cd: c[1] });
    Logger.log('[' + c[0] + '] iem_cd=' + c[1] + ' → HTTP ' + r.http +
      ' / rsp_cd ' + r.body.rsp_cd + ' / rsp_msg ' + r.body.rsp_msg);
    const keys = Object.keys(r.body || {}).filter(function (k) { return k.indexOf('Output_') === 0; });
    keys.forEach(function (k) {
      Logger.log('   ' + k + ': ' + JSON.stringify(r.body[k]).slice(0, 600));
    });
  });
}

// ---------- 명세 확인용 (공개 명세만 읽음: 키·토큰·계좌 정보 없이 실행됨) ----------

// 명세 파일 내려받기: 일시적 오류가 나면 잠시 쉬었다가 최대 4번까지 다시 시도
function nhFetchSpec_(g) {
  for (let i = 1; i <= 4; i++) {
    try {
      const res = UrlFetchApp.fetch('https://www.nhplug.com/openapi-docs/' + g + '/openapi.json', { muteHttpExceptions: true });
      return JSON.parse(res.getContentText());
    } catch (e) {
      Logger.log('[' + g + '] 명세 로드 실패 ' + i + '/4: ' + e);
      if (i < 4) Utilities.sleep(2500 * i);
    }
  }
  return null;
}

// groups = { 그룹명: [경로 정규식, ...] } — 그룹별로 시세·조회 경로 목록을 찍고,
// 정규식에 맞는 API의 입력(*=필수)·응답 필드 이름을 요약해서 로그에 남긴다.
function nhDumpGroups_(groups) {
  Object.keys(groups).forEach(function (g) {
    const spec = nhFetchSpec_(g);
    if (!spec) return;
    const paths = Object.keys(spec.paths || {});
    Logger.log('[' + g + '] 시세·조회 경로: ' + paths.filter(function (p) { return /\/(quote|inquiry)\//.test(p); }).join(' , '));
    paths.forEach(function (p) {
      if (!groups[g].some(function (re) { return re.test(p); })) return;
      const op = spec.paths[p].post || {};
      Logger.log('=== ' + p + ' (' + (op.summary || '') + ')');
      const inp = (((((op.requestBody || {}).content || {})['application/json'] || {}).schema || {}).properties || {}).Input_0 || {};
      const req = inp.required || [];
      Logger.log('입력: ' + Object.keys(inp.properties || {}).map(function (k) {
        return k + (req.indexOf(k) >= 0 ? '*' : '') + '=' + String(inp.properties[k].description || '').slice(0, 160);
      }).join(' | '));
      const out = ((((((op.responses || {})['200'] || {}).content || {})['application/json'] || {}).schema || {}).properties) || {};
      Object.keys(out).filter(function (k) { return k.indexOf('Output_') === 0; }).forEach(function (k) {
        const o = out[k];
        const props = o.type === 'array' ? ((o.items || {}).properties || {}) : (o.properties || {});
        const line = Object.keys(props).map(function (f) { return f + '=' + String(props[f].description || '').split(' / ')[0]; }).join(', ');
        Logger.log(k + ' (' + (o.type === 'array' ? '배열' : '객체') + '): ' + line.slice(0, 1800));
      });
    });
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
  throw new Error('선물 월물 계산 실패');
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
    throw new Error((r.body && r.body.rsp_msg) || ('HTTP ' + r.http));
  }
  const nd = nhFutNorm_(o0, r.body.Output_1);
  if (!nd) throw new Error('시세 해석 실패');
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
      else throw new Error('지원하지 않는 항목');
    } catch (e) {
      errors[k] = String((e && e.message) || e).slice(0, 120);
    }
  });
  return jsonResponse({ success: true, data: data, errors: errors });
}

// 편집기에서 실행하는 시험: 월물 코드·시세·등락 판정 근거를 로그로 확인 (키·토큰은 출력 안 됨)
function nhTestFutures() {
  ['A01', 'A06'].forEach(function (pf) {
    try {
      const q = nhFutQuote_(pf);
      Logger.log(pf + ' → ' + q.code + ' ' + q.name + ' / 현재가 ' + q.p + ' / 전일 기준 ' + q.prev +
        ' / 베이시스 ' + (q.basis == null ? '없음' : q.basis.toFixed(2)) + ' / 시각 ' + q.t + ' / 등락 판정 ' + q.dir);
    } catch (e) { Logger.log(pf + ' 실패: ' + e); }
  });
}

// ---------- 일반계좌 잔고 조회 전용 (ISA·연금저축·IRP 및 모의계좌 제외) ----------
// 계좌번호는 서버 안에서만 사용하고 브라우저에는 끝 4자리만 전달한다.
function nhReadPaged_(path, input, maxPages) {
  const rows = [];
  let summary = {}, last = null, cts = '', pages = 0, notice = '', partial = false;
  const limit = Math.max(1, Math.min(Number(maxPages || 20), 20));
  const seen = {};
  for (let page = 0; page < limit; page++) {
    const opt = cts ? { cts: cts, cts_flag: 'Y' } : null;
    last = nhCall_(path, input, opt); pages++;
    const b = last.body || {}, code = String(b.rsp_cd || '');
    if (last.http !== 200) throw new Error('HTTP ' + last.http + ' · ' + String(b.rsp_msg || '조회 실패').slice(0, 90));
    // 00218: 연속조회 안내. 이미 수신한 잔고 블록을 버리지 않는다.
    if (code && !/^0+$/.test(code) && code !== '00218' && code !== '00166') {
      throw new Error('응답 ' + code + ' · ' + String(b.rsp_msg || '조회 실패').slice(0, 90));
    }
    if (code === '00218') notice = '연속조회 안내(00218)';
    if (code === '00166') notice = '조회 완료(00166)';
    const blocks = [b.Output_0, b.Output_1, b.Output_2];
    // NH balance: Output_0 = 요약, Output_1 = 종목. API 변형에서 배열이 Output_0에 올 수도 있어 보존.
    if (b.Output_0 && !Array.isArray(b.Output_0)) summary = Object.assign({}, summary, b.Output_0);
    const holdingBlocks = Array.isArray(b.Output_1) ? [b.Output_1] :
      (Array.isArray(b.Output_0) ? [b.Output_0] : []);
    holdingBlocks.forEach(function(block) { block.forEach(function(x) {
      const k = JSON.stringify(x);
      if (!seen[k]) { seen[k] = true; rows.push(x); }
    }); });
    const next = String(last.cts || b.cts || '');
    const flag = String(last.cts_flag || b.cts_flag || '').toUpperCase();
    if (next && next !== cts && (flag === 'Y' || code === '00218')) { cts = next; continue; }
    if (code === '00218') { partial = true; notice = '연속조회 필요(00218): 연속조회 헤더 미수신 · NH 응답 확인 필요'; }
    break;
  }
  if (pages === limit && cts) { partial = true; notice = '최대 연속조회 횟수 도달'; }
  return { summary: summary, rows: rows, pages: pages, notice: notice, partial: partial,
    rsp_msg: last && last.body && last.body.rsp_msg || '' };
}

function nhAccountBalance_(acctNo, acctType) {
  const result = { domestic: null, overseas: null, errors: [] };
  // 국내주식: 현재가 기준(5), 상장종목(1), 순자산(1), 통합시세(UNT), 전체장(2)
  try {
    const d = nhReadPaged_('/krstock/inquiry/v1/balance', {
      act_no: acctNo, bnc_bse_cd: '5', ltg_aot_dit_cd: '1',
      aet_bse: '1', qut_dit_cd: 'UNT', aly_qut_cd: '2'
    }, 10);
    if (d.partial) result.errors.push('국내주식: ' + d.notice);
    result.domestic = {
      summary: {
        deposit: nhNum_(d.summary.dca), netAsset: nhNum_(d.summary.nas_amt),
        totalAsset: nhNum_(d.summary.tot_aet_amt), buyAmount: nhNum_(d.summary.tot_byn_amt),
        evalAmount: nhNum_(d.summary.tot_eal_amt) || d.rows.reduce(function(v,x){return v+nhNum_(x.eal_amt)},0), profit: nhNum_(d.summary.tot_eal_pls) || d.rows.reduce(function(v,x){return v+nhNum_(x.eal_pls_amt)},0),
        returnRate: nhNum_(d.summary.pft_rt)
      },
      holdings: d.rows.map(function (x) { return {
        name: String(x.iem_nm || ''), code: String(x.iem_cd || ''),
        quantity: nhNum_(x.itg_bnc_qty), avgPrice: nhNum_(x.phs_pr), currentPrice: nhNum_(x.now_pr),
        evalAmount: nhNum_(x.eal_amt), profit: nhNum_(x.eal_pls_amt), returnRate: nhNum_(x.pft_rt), currency: 'KRW'
      }; })
    };
  } catch (e) { result.errors.push('국내주식: ' + String(e.message || e).slice(0, 110)); }

  // 해외주식: 전체 시장·전체 통화(원화 환산값 포함)
  try {
    const g = nhReadPaged_('/gbstock/inquiry/v1/balance', {
      act_no: acctNo, qut_iqr_dit_cd: '9', fc_sec_trd_nat_cd: '000', cur_cd: 'KRW', xns_dit_cd: '1'
    }, 10);
    if (g.partial) result.errors.push('해외주식: ' + g.notice);
    result.overseas = {
      summary: {
        evalAmount: nhNum_(g.summary.eal_amt_sum) || g.rows.reduce(function(v,x){return v+nhNum_(x.krw_eal_amt)},0), profit: nhNum_(g.summary.eal_pls_sum_amt) || g.rows.reduce(function(v,x){return v+nhNum_(x.krw_eal_pls_amt)},0),
        returnRate: nhNum_(g.summary.krw_pft_rt), deposit: nhNum_(g.summary.krw_dca),
        totalAsset: nhNum_(g.summary.tot_aet_amt)
      },
      holdings: g.rows.map(function (x) { return {
        name: String(x.iem_nm || ''), code: String(x.iem_cd || ''), country: String(x.fc_sec_trd_nat_nm || ''),
        quantity: nhNum_(x.cns_bse_bnc_qty), avgPrice: nhNum_(x.fc_avg_phs_pr != null ? x.fc_avg_phs_pr : x.fc_phs_uit_pr),
        currentPrice: nhNum_(x.fc_sec_end_pr), evalAmount: nhNum_(x.krw_eal_amt), profit: nhNum_(x.krw_eal_pls_amt),
        returnRate: nhNum_(x.eal_pft_rt), currency: String(x.cur_cd || '')
      }; })
    };
  } catch (e) { result.errors.push('해외주식: ' + String(e.message || e).slice(0, 110)); }
  return result;
}

function handleNhAccounts(token) {
  if (!sessionUser_(token)) return jsonResponse({ success: false, message: '로그인이 필요합니다. 다시 로그인하세요.' });
  try {
    const r = nhCall_('/n2/acctinfo', {});
    if (r.http !== 200) throw new Error('계좌목록 HTTP ' + r.http);
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
      return { masked: '••••' + no.slice(-4), acctType: String(a.acct_type), domestic: data.domestic,
        overseas: data.overseas, errors: data.errors };
    });
    return jsonResponse({ success: true, accounts: accounts, excludedMockCount: all.filter(function (a) { return String(a.acct_type) === '03'; }).length,
      updatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') });
  } catch (e) {
    return jsonResponse({ success: false, message: String(e.message || e).slice(0, 160) });
  }
}

// 편집기 진단: 계좌번호 전체와 보유종목 원문은 로그에 남기지 않는다.
function nhTestAccountBalances() {
  const r = nhCall_('/n2/acctinfo', {});
  const all = Array.isArray(r.body && r.body.Output_0) ? r.body.Output_0 : [];
  all.filter(function (a) { return /^(01|02)$/.test(String(a.acct_type)); }).forEach(function (a) {
    const x = nhAccountBalance_(String(a.acct_no), String(a.acct_type));
    Logger.log('계좌 끝 ' + String(a.acct_no).slice(-4) + ' / 국내 ' + (x.domestic ? x.domestic.holdings.length + '종목, 평가 ' + x.domestic.summary.evalAmount + ', 손익 ' + x.domestic.summary.profit : '조회 실패') +
      ' / 해외 ' + (x.overseas ? x.overseas.holdings.length + '종목, 평가 ' + x.overseas.summary.evalAmount + ', 손익 ' + x.overseas.summary.profit : '조회 실패') +
      (x.errors.length ? ' / 오류 ' + x.errors.join(' | ') : ''));
  });
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
  codes.forEach(function(raw){
    const code=String(raw==null?'':raw).trim();
    function reject(reason,layer,http,rsp,fields){
      const diagnostic={layer:layer,code:reason,http:http==null?null:http,rspCode:rsp||null,fields:fields||[]};
      diagnostics[code.slice(0,24)]=diagnostic;
      errors[code.slice(0,24)]=layer+' / '+reason+(http?' / HTTP '+http:'')+(rsp?' / rsp_cd '+rsp:'');
    }
    if(!/^[A-Z0-9]{6}$/.test(code)){reject('INVALID_SYMBOL','gas');return}
    if(seen[code])return;seen[code]=true;
    try{
      const r=nhCall_('/krstock/quote/v1/currentPrice',{market_cd:'UNT',iem_cd:code});
      const body=r.body||{},block=body.Output_0;
      const o=Array.isArray(block)?(block.find(x=>x&&String(x.iem_cd||'').trim()===code)||block[0]||{}):(block||{});
      const fields=Object.keys(o).filter(k=>/^[A-Za-z0-9_]{1,40}$/.test(k)).slice(0,8);
      const rawRsp=String(body.rsp_cd==null?'':body.rsp_cd).trim();
      const rsp=/^[A-Za-z0-9_-]{1,20}$/.test(rawRsp)?rawRsp:(rawRsp?'INVALID_RSP_CODE':'');
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
