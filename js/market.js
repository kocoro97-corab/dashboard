/* ===== market.js: 시장 종합 시세 및 설정 관리 ===== */

const DEFAULT_CONFIG = {
  KR: [
    { id: "k1", name: "코스피", val: "2,580.45", chg: "+0.45%", dir: 1, vis: true, sym: "NYSEARCA:EWY" },
    { id: "k2", name: "코스닥", val: "745.20", chg: "-0.12%", dir: -1, vis: true, sym: "NYSEARCA:EWY" },
    { id: "k3", name: "코스피200 선물", val: "348.10", chg: "+0.60%", dir: 1, vis: true, sym: "NYSEARCA:EWY" },
    { id: "k4", name: "코스닥150 선물", val: "1,240.50", chg: "-0.05%", dir: -1, vis: true, sym: "NYSEARCA:EWY" },
    { id: "k5", name: "달러/원", val: "1,337.50", chg: "-2.30", dir: -1, vis: true, sym: "FX_IDC:USDKRW" },
    { id: "k6", name: "프로그램 매매", val: "+1,240억", chg: "순매수", dir: 1, vis: true, sym: "NYSEARCA:EWY" },
    { id: "k7", name: "외국인 수급", val: "+2,150억", chg: "순매수", dir: 1, vis: true, sym: "NYSEARCA:EWY" }
  ],
  US: [
    { id: "u1", name: "S&P 500", val: "5,743.98", chg: "+0.28%", dir: 1, vis: true, sym: "AMEX:SPY" },
    { id: "u2", name: "나스닥", val: "18,119.85", chg: "+0.27%", dir: 1, vis: true, sym: "NASDAQ:QQQ" },
    { id: "u3", name: "다우존스", val: "42,120.10", chg: "+0.15%", dir: 1, vis: true, sym: "NYSEARCA:DIA" },
    { id: "u4", name: "주요 선물 (NQ1!)", val: "20,150.25", chg: "+0.35%", dir: 1, vis: true, sym: "CME_MINI:NQ1!" },
    { id: "u5", name: "필라델피아 반도체", val: "5,184.00", chg: "+1.76%", dir: 1, vis: true, sym: "NASDAQ:SOXX" },
    { id: "u6", name: "NYSE $TICK", val: "+420", chg: "중립매수", dir: 1, vis: true, sym: "INDEX:TICK" },
    { id: "u7", name: "VIX (변동성)", val: "15.42", chg: "-3.10%", dir: -1, vis: true, sym: "TVC:VIX" },
    { id: "u8", name: "미국 10년물 금리", val: "4.21%", chg: "-0.02", dir: -1, vis: true, sym: "TVC:US10Y" },
    { id: "u9", name: "WTI 유가", val: "$70.45", chg: "+0.85%", dir: 1, vis: true, sym: "TVC:USOIL" }
  ]
};

let userConfig = JSON.parse(localStorage.getItem('invest_dash_config')) || JSON.parse(JSON.stringify(DEFAULT_CONFIG));

function getSessionType() {
  const h = new Date().getHours();
  return (h >= 7 && h < 21) ? "KR" : "US";
}

function renderMarketCards() {
  const session = getSessionType();
  const badge = document.getElementById("sessionBadge");
  const title = document.getElementById("marketTitle");
  const sub = document.getElementById("marketSub");

  if (session === "KR") {
    badge.className = "badge badge-kr";
    badge.textContent = "🇰🇷 한국장 (07:00~20:59)";
    title.textContent = "시장 종합 · 한국장 우선 표시";
    sub.textContent = "코스피, 코스닥, 선물, 달러/원, 수급 지표";
  } else {
    badge.className = "badge badge-us";
    badge.textContent = "🇺🇸 미국장 (21:00~06:59)";
    title.textContent = "시장 종합 · 미국장 우선 표시";
    sub.textContent = "S&P500, 나스닥, SOXX, TICK, VIX, 금리, 유가";
  }

  const items = userConfig[session].filter(x => x.vis);
  document.getElementById("marketCards").innerHTML = items.map(x => `
    <div class="card" style="cursor:pointer" onclick="changeChartSymbol('${x.sym}')">
      <div class="card-label"><span>${x.name}</span><span>📈</span></div>
      <div class="value">${x.val}</div>
      <div class="change ${x.dir > 0 ? 'up' : x.dir < 0 ? 'down' : 'neutral'}">${x.chg}</div>
    </div>
  `).join("");
}

function moveItem(idx, dir) {
  const arr = userConfig[currentSettingTab];
  const target = idx + dir;
  if (target < 0 || target >= arr.length) return;
  const temp = arr[idx];
  arr[idx] = arr[target];
  arr[target] = temp;
  renderSettings();
}

function deleteItem(idx) {
  userConfig[currentSettingTab].splice(idx, 1);
  renderSettings();
}

function addNewIndexPrompt() {
  const name = prompt("새 지수/항목 이름을 입력하세요:");
  if (!name) return;
  const sym = prompt("TradingView 티커 심볼을 입력하세요 (예: NASDAQ:AAPL):", "AMEX:SPY");
  userConfig[currentSettingTab].push({
    id: "custom_" + Date.now(),
    name: name,
    val: "1,000.00",
    chg: "+0.00%",
    dir: 1,
    vis: true,
    sym: sym || "AMEX:SPY"
  });
  renderSettings();
}

function resetSettings() {
  userConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  localStorage.removeItem('invest_dash_config');
  renderSettings();
  renderMarketCards();
}

function saveSettings() {
  localStorage.setItem('invest_dash_config', JSON.stringify(userConfig));
  renderMarketCards();
  closeModal();
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = `${now.getMonth() + 1}.${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} KST`;
}

loadChart("AMEX:SPY");
renderMarketCards();
renderHoldings();
updateClock();
setInterval(updateClock, 1000);
setInterval(renderMarketCards, 30000);
