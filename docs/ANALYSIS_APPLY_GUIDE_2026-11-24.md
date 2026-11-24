# MY INVEST V2 — Codex 제한 기간 개발 적용·인수·릴리스 실행 안내

**2026-11-24 / 원본 소스:** `kocoro97-corab/dashboard` / `feat/nh-integration-v2`  
**별도 개발 게시본:** `kocoro97-corab/dashboard-v2-dev` / `dev-pages`  
**운영 보존:** `main`, `release/pages`, 운영 GAS/Sheets/Properties, 실제 NH 계좌/주문.

## 1. 이미 개발 브랜치에 직접 연결한 화면

현재 `#/strategy`에 접기/펼치기 형태의 **“통합 투자 분석 · 실데이터 근거 확인 (조회 없음)”** 모듈을 연결했다.

- `js/analysis-integration-panel-v1.js`: 이미 전달받은 `InvestWorkflow` 종목 일봉, `Q/SRC/QT` 공공 시장 지수 캐시에서 출처와 수신시각을 점검한다. 네트워크/계좌/주문 호출 없음.
- `js/market-regime-engine.js`: 같은 기준일 두 핵심 지수의 관측·수신시각이 충분할 때만 한국·미국 시장의 **당일 방향**을 구분.
- `js/page-strategy.js`: 현재 이미 조회 중인 `latestData`만 전달하고 기존 계산기/보유종목 기능을 유지한다.
- `index.html`: 위 두 모듈을 `page-strategy.js`보다 앞서 로드한다.
- `tests/analysis-integration-panel-v1.test.cjs`, `tests/analysis-integration-wiring.test.cjs`와 `.github/workflows/analysis-integration-panel.yml`: 구문·캐시만 사용·추가 조회/주문 없음·언마운트 확인.

현재 화면에서 **엄격한 단타/스윙 투자전략 결론은 의도적으로 미표시**한다. Yahoo `bars[].t`만으로 거래소 기준일 및 마지막 봉의 마감 여부를 확정할 수 없고, 산업/종목 소속 매핑과 공식 이벤트 완전성도 실검증이 필요하기 때문. 미확인 사항을 임의 보정하지 말 것.

### 2026-11-24 추가 검증·품질 보강

- `js/market-regime-engine.js`: 핵심 지수의 날짜가 달라 시장 방향을 판단하지 못할 때 `CORE` 기준일 불일치 사유가 근거 목록에 빠지던 오류 수정.
- `js/analysis-integration-panel-v1.js`: 기존 OHLCV 캐시의 원천 관측시각이 4일보다 오래됐거나 OHLC 가격 모순이 있으면 `received`로 표시하지 않음.
- 시장 위험 참고(VIX/환율) 검증 항목 및 사용한 시장 지수의 **출처·관측시각·수신시각·거래일** 표시를 추가.
- 해당 독립 JS 검증: 시장 국면 **47개**, 통합 패널 **23개** 항목 PASS. 이는 **전체 브라우저·GitHub CI 완료를 의미하지 않음**.

### 2026-11-24 거래소 현지 날짜·확정 일봉 실데이터 연결

**이번 개발에서 독립 분석 엔진과 기존 실제 조회 데이터가 처음으로 연결되는 범위를 확대했다.** 새 네트워크 호출·NH 권한 변경은 없다.

- `js/exchange-session-proof.js`: 이미 조회한 Yahoo 일봉 `timestamp`와 `meta.exchangeTimezoneName`을 통해 US(`America/New_York`)/KR(`Asia/Seoul`)의 거래소 현지 거래일을 분리한다. 장중 일봉은 제외하고, **현재 거래일 마감 여부는** 공급자의 `currentTradingPeriod.regular.end`와 `regularMarketTime` 증거가 맞는 경우만 확인한다. 시간대 누락·불일치면 강한 투자전략 판단 보류.
- `js/page-stocks.js`: 기존 `publicAnalysis()`의 `InvestWorkflow` 캐시에 `sessionProof`를 부착 (추가 시세 조회 없음).
- `js/stock-setup-adapter.js`: `adaptCached()`는 검증된 `sessionProof`가 있는 경우에만 현재 종목 차트를 `MYInvestStockSetup.assess()`에 연결한다.
- `js/analysis-integration-panel-v1.js`: `#/strategy`에서 실제 확정봉이 충분한 종목의 **추세·20봉 고점·거래량 기술적 관찰조건**을 추가 표시. 시장/산업/기업 이벤트의 필수 근거가 없으면 전체 투자전략은 여전히 판단 보류.
- `js/page-sectors.js`: 기존 `SERIES_CACHE`의 미국 섹터 ETF·SPY 일봉에 `sessionDates/sessionProof`를 기록하고 기존 계산에도 현지 거래일을 우선 사용.
- `js/sector-rotation-adapter.js`, `js/sector-cache-rotation-bridge.js`, `js/sector-rotation-engine.js`: **이미 조회된 SPY와 미국 섹터 ETF**의 1/5/20/60거래일 수익률·상대강도를 재검증하며, 산업·테마 화면의 별도 펼쳐보기에서 확인 가능. 시장 전체 산업 수익률, 종목 상승비율, 자금유입은 임의로 생성하지 않는다.
- `index.html`: 모듈을 원본 종목·산업·전략 페이지보다 앞서 로드.
- `tests/exchange-session-proof.test.cjs`, `tests/exchange-session-integration.test.cjs`, `tests/sector-cache-rotation-bridge.test.cjs` 및 추가 기존 어댑터·엔진 회귀로 검증.

로컬 또는 GitHub Actions 검사:

```bash
node --check js/exchange-session-proof.js
node --check js/page-stocks.js
node --check js/page-sectors.js
node --check js/analysis-integration-panel-v1.js
node tests/exchange-session-proof.test.cjs
node tests/exchange-session-integration.test.cjs
node tests/sector-cache-rotation-bridge.test.cjs
node tests/stock-setup-adapter.test.cjs
node tests/sector-rotation-adapter.test.cjs
node tests/analysis-integration-panel-v1.test.cjs
node tests/analysis-integration-wiring.test.cjs
```

**개발 Pages 적용 시 파일 병합 범위 갱신:** `js/exchange-session-proof.js`, `js/stock-setup-engine.js`, `js/stock-setup-adapter.js`, `js/sector-rotation-engine.js`, `js/sector-rotation-adapter.js`, `js/sector-cache-rotation-bridge.js`, `js/analysis-integration-panel-v1.js`을 새로 복사/갱신. 원본의 `js/page-stocks.js`, `js/page-sectors.js`, `js/page-strategy.js`에는 **현지 날짜·캐시·화면 연결 코드 차이만 병합**. `index.html`에는 이들의 script 태그 순서만 반영하고 **개발 환경 CSP·OAuth·릴레이/중계·기타 파일을 덮어쓰지 않는다**.

**적용 후 검사:** `#/strategy`에서 실제 한국/미국 종목의 확정봉 기술 관찰 및 근거 보류; `#/sectors`에서 US ETF 수익률 펼쳐보기; 개발자 도구 네트워크에서 **추가 조회 0건**, 기존 계좌/뉴스/캘린더 기능 회귀. GitHub 전체 CI와 PC/Fold6 브라우저 테스트가 끝나기 전 또는 사용자의 운영 배포 승인이 있기 전에는 운영에 반영하지 않는다.

### 2026-11-24 통합 후보·보유전략 화면 연결 (개발 브랜치)

- `js/integrated-strategy-engine.js`, `js/integrated-event-adapter.js`, `js/opportunity-review-queue.js`, `js/cached-strategy-bridge.js`를 전략 화면보다 먼저 로드.
- `js/page-strategy.js`: 기존 `InvestWorkflow.ensure()` 결과와 검증된 **현재 브라우저 보유 행**, `MYInvestEventContext.collect()`의 **이미 수집된 공식 공개 일정**을 선택 종목에 한하여 읽기 전용으로 연결. 추가 시세/계좌/공식 일정 API 조회 없음. Google 개인 캘린더 접근 없음.
- `js/analysis-integration-panel-v1.js`: **신규 후보**와 **기존 보유종목**의 검토상태를 구별하고, 데이터 미확인 `blocking` 및 공식 실적·거시 이벤트 위험을 표시한다.
- 동일 종목을 복수 계좌에서 보유한 경우 하나의 계좌 판단을 모든 계좌로 일반화하지 않는다. 각 기록을 별도 검토하며 종목 단위 단일 계좌 우선순위는 생성하지 않는다.
- **개인정보 비노출:** 계좌번호, 증권사명, 평단, 수량, 토큰을 새 분석의 공개 출력에 포함하지 않는다. 기존 사용자의 보호된 보유 계좌 화면은 변경하지 않았다.
- **미완료 연결:** 특정 종목의 주도 산업 소속/5·20일 동일 거래일 상대강도는 독립적으로 입증되지 않으면 `sector-unverified`/`relative-unverified`. 확정된 매수 추천·자동 주문·푸시 알림 기능이 아니다.

자동 테스트/구문 검사:

```bash
node --check js/cached-strategy-bridge.js
node --check js/integrated-strategy-engine.js
node --check js/integrated-event-adapter.js
node --check js/opportunity-review-queue.js
node --check js/page-strategy.js
node --check js/analysis-integration-panel-v1.js
node tests/cached-strategy-bridge.test.cjs
node tests/integrated-strategy-engine.test.cjs
node tests/integrated-event-adapter.test.cjs
node tests/analysis-integration-panel-v1.test.cjs
node tests/analysis-integration-wiring.test.cjs
node tests/exchange-session-integration.test.cjs
```

**개발 사이트 복사/병합 추가 범위:** 이번에는 새 JS 4개(`integrated-strategy-engine`, `integrated-event-adapter`, `opportunity-review-queue`, `cached-strategy-bridge`)를 복사하고, 기존 개발 게시본의 `js/page-strategy.js` 및 `js/analysis-integration-panel-v1.js`에서 공개 일정/보유행 메모리 전달·구분 표시 변경만 병합. 기존 CSP·OAuth·로그인·중계 설정·GAS 전체는 유지. 신규 스크립트는 `analysis-integration-panel-v1.js`보다 먼저 포함한다.

**실행 상태:** 원본 개발 브랜치에 연결 코드 반영 및 모의 종단 간 테스트 통과. `dashboard-v2-dev/dev-pages` 게시·실 NH/실 Yahoo 브라우저 테스트·전체 CI PASS·운영 배포는 아직 미완료. 사용자의 운영 배포 승인 전에는 운영 레포지토리 변경 불가.

## 2. 원본 개발 브랜치 검증

Codex 사용한도가 해제되지 않아도 GitHub Actions 또는 PC에서 다음 명령으로 검증할 수 있다.

```bash
git clone https://github.com/kocoro97-corab/dashboard.git
cd dashboard
git switch feat/nh-integration-v2
git pull --ff-only
node --check js/market-regime-engine.js
node --check js/analysis-integration-panel-v1.js
node --check js/page-strategy.js
node tests/market-regime-engine.test.cjs
node tests/analysis-integration-panel-v1.test.cjs
node tests/analysis-integration-wiring.test.cjs
```

기존 `PR regression tests`가 전체 통과했는지 반드시 GitHub Actions에서 확인. 특히 계좌·뉴스·캘린더의 전체 기존 회귀를 건너뛰지 말 것. 이 통합 단계의 단위 테스트가 통과해도 **실제 브라우저·실계좌·Google OAuth 성공을 뜻하지 않는다**.

## 3. 별도 개발 게시본 적용 (운영 아님)

원본 `dashboard`와 개발 Pages `dashboard-v2-dev`는 서로 **다른 레포지토리**이다. 개발 Pages의 `index.html`에는 추가 CSP·개발 중계 URL·로그인 설정이 있으므로 파일 전체를 덮어쓰지 말 것.

개발 게시본 `dev-pages`에 다음을 순서대로 반영한다.

1. **기존 개발 배포본을 백업**하고 현재 HEAD SHA를 기록한다. 기존 연결 상태, 통합 계좌 화면, 개발 중계, Google 인증을 먼저 살핀다.
2. `js/market-regime-engine.js`, `js/analysis-integration-panel-v1.js` 두 파일을 원본 브랜치에서 복사한다.
3. `index.html`의 **기존 CSP/로그인·중계·스크립트 순서를 보존**하면서, `page-strategy.js` 스크립트 바로 앞에 두 개의 **same-origin** 스크립트 로드 태그만 넣는다.
4. `js/page-strategy.js`는 원본 전체 덮어쓰기가 아닌 코드 조각 병합: `readinessPanel` 상태 변수, `loadStrategy` 성공/실패 후 `readinessPanel.update()`, `view.append(comparisonStyle,compareDisclosure)` 다음의 `integration.mount(view,currentPublic)`, `unmount`의 `readinessPanel.destroy()`를 반영. 개발 배포본의 다른 기능 변경은 보존한다.
5. 새 모듈만으로 화면을 그릴 수 있다. **GAS/Sheets/Properties/NH OAuth/Google OAuth를 새로 등록하거나 변경하지 않는다.**
6. 개발 사이트 `#/strategy`에 접속하여 정확한 **“통합 투자 분석 · 실데이터 근거 확인 (조회 없음)”** 섹션이 보이는지 확인한다. 종목 선택 없이 펼치면 '검증된 종목 선택 없음', 이미 조회된 종목이 있으면 공개 일봉 출처·데이터 누락 사유를 보여야 한다.
7. 네트워크 개발자 도구에서 패널을 접고 펼치고 모드를 바꾸는 동안 **추가 시세/계좌 요청 0건** 확인. 기존 전략 분석 자체의 `InvestWorkflow.ensure()` 요청은 분리하여 판단.
8. 1440px PC, 690px Fold6 펼침, 344px 접힘 브라우저에서 글자 넘침·버튼 접근성·콘솔 오류·종목 변경/로그아웃 후 데이터 정리 검증.

예시로 현재 개발 브랜치 코드를 가져오는 `git` 명령을 사용하되, **별도 개발 게시 저장소에서 원본의 `index.html`을 통째로 복사하지 않는다.** `dev-pages` 보호/게시 설정이 다른 경우 담당 저장소 규칙을 우선 준수한다.

## 4. 아직 화면에 직접 연결하지 않은 분석 엔진

아래는 **개발 브랜치의 독립 모듈·테스트 완료** 상태다. 실데이터 계약 검증 없이 `index.html`에 전부 로드했다고 해서 완성된 투자전략으로 표시하면 안 된다.

- `js/sector-rotation-engine.js` / `js/sector-rotation-adapter.js`: 산업 1/5/20/60 거래일 상대강도. **실제 거래소 세션 날짜/공식 종목 소속·통화·구성종목** 연동 필요.
- `js/stock-setup-engine.js` / `js/stock-setup-adapter.js`: 종목 20봉 돌파/거래량/ATR. **거래소 거래일과 완료봉 확인 필수**.
- `js/integrated-strategy-engine.js` / `js/integrated-event-adapter.js`: 신규 후보/보유 전략의 출처 조인 및 공개 이벤트 수집 범위 확인 필수.
- `js/opportunity-review-queue.js`: 후보/보유 위험 검토 작업 대기열.
- `js/invest-evidence-audit.js`: 출처·관측시각·수신시각·기준일·미연결 근거 점검.
- `js/analysis-change-snapshot.js` / `js/analysis-change-tracker.js`: **실제 이전 확정 거래일 스냅샷**이 있어야 변화 비교 가능. 계좌 정보를 공개·자동 저장 금지.
- `js/strategy-alert-planner.js`: **위험 알림 후보 판단만 구현**. 사용자 동의 없는 실제 발송/푸시는 미구현.

## 5. 운영 반영 전에 꼭 필요한 승인 및 완료 조건

1. 모든 신규 단위 테스트와 기존 GitHub 전체 CI, 합성 브라우저 회귀 **100% PASS**.
2. 개발 사이트 실제 시장·종목 시세의 원천/시각/심볼·거래일 검증, 한국·미국장 및 공휴일 확인.
3. 실제 Google Calendar 실연동은 별도 사용자 OAuth 동의·신뢰 백엔드·인증 준비가 되었을 때에만 활성화.
4. 개인 Google 일정/토큰, NH 계좌번호, 보유 수량, 평단, 주문 가능 권한 공개 전송 **0건**.
5. 1440/690/344px 및 가능한 실제 Fold6 검증, 시세 요청 중복 증가 0건.
6. 개발 게시본에서 1~2거래일 이상 관측하며 새 오류 유무 확인. 운영 `main`/ `release/pages` 변경은 **사용자가 최종 승인한 후** 병합/게시한다.
7. 운영 변경 전 커밋 SHA, 영향 파일, 복구 SHA/작업 절차를 기록하고 실패 시 신속히 롤백할 것.

## 6. 간단한 사용자 직접 적용 절차

GitHub 웹에서 **개발 적용**:
- 저장소 `dashboard` → 브랜치 `feat/nh-integration-v2` → Actions → 관련 테스트 결과 확인.
- 저장소 `dashboard-v2-dev` → `dev-pages` → 현재 버전 백업/변경 SHA 기록.
- 위 3절의 **신규 JS 2개 + index 스크립트 2줄 + page-strategy 연결 코드**만 병합하고 커밋.
- 개발 Pages 사이트 `#/strategy` 열기 → 종목 선택 → 분석 근거 패널 펼치기 → 누락 근거/시각·새로운 API 요청 유무 확인.
- 문제 있으면 `dev-pages` 직전 정상 커밋으로 되돌릴 것. **개발 테스트 성공은 운영 배포 승인이 아님**.

**원칙:** Codex 사용이 막혀도 신규 JS/테스트/개발 적용은 계속 가능. 단, 운영 계좌/인증/배포는 사용자 승인이 필요하다.
