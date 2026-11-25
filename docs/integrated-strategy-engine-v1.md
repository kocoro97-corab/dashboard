# MY INVEST V2 — 통합 투자전략 엔진 V1 (2026-11-23)

## 구현 범위

`js/integrated-strategy-engine.js`: 기존 **검증된** 세 분석 결과를 단일 읽기 전용 시나리오로 조합.

1. `MYInvestMarketRegime.assess`의 KR/US 시장 방향·VIX 위험·중기 모멘텀. 두 핵심 지수의 **실제 기준 거래일**이 종목 확정봉 날짜와 일치해야만 verified.
2. `MYInvestSectorRotation.assess`의 산업/테마 상대강도. 엔진 결과 내 동일 거래일과 **별도 검증된 종목→산업 소속 매핑**(`sectorLink`)이 모두 존재해야만 관련 산업 근거로 인정.
3. `MYInvestStockSetup.assess`의 종목 추세, 단타 확정봉 돌파/거래량, 스윙 눌림목/돌파 및 종목 대비 5·20일 상대수익률.
4. `js/integrated-event-adapter.js`: `MYInvestEventContext.collect()`가 이미 검증한 **공개** BLS·BEA·BOK·FOMC·확정 실적 이벤트를 변환. 데이터 재조회 없음. 소스 하나라도 빠지면 `partial`/coverage 미확인; 그래도 이미 확인된 중요 발표는 위험 차단 조건 유지.
5. `holding`은 사용자 브라우저 내부에서만 입력. 계좌번호, 증권사, 수량, 평균매입가를 리턴하지 않고, 해당 단일 보유 레코드의 평단 대비 상대상태만 전달. **별도 공개 JSON/Pages/뉴스/섹터로 절대 전송하지 않음.**

## 조합 스키마

```js
const result = MYInvestIntegratedStrategy.assess({
  intent:'candidate', // 'candidate' 또는 'holding'
  mode:'swing',        // 'day' 또는 'swing'
  stock:verifiedStockSetup, // 같은 mode, symbol, market, asOf
  regime:verifiedMarketRegime, // 같은 market, verified core referenceDay
  sector:verifiedSectorCandidate, // same market, sector.asOf===stock.asOf
  sectorLink:{verified:true,symbol:'SERV',market:'US',sectorId:'US_TECH',
    asOf:'2026-11-23',source:'official component membership'},
  event:MYInvestIntegratedEventAdapter.eventsFromPublicContext(
    MYInvestEventContext.collect({from:'2026-11-23',to:'2026-12-14'}),
    {symbol:'SERV',market:'US',asOf:'2026-11-23',mode:'swing'}),
  holding:null, // 'holding' 모드에서만 검증된 비공개 로컬 레코드 전달
  nowDay:'2026-11-23'
});
```

코드 예시의 날짜·종목 매핑은 **형식 설명일 뿐 공식 시장 상태나 기업 이벤트 사실을 의미하지 않음**. 실제 API 연결이나 실계좌 데이터 적용 전에는 캐시/소속정보 모두 검증해야 한다.

`result`의 `status`는 `observed`, `review-required`, `insufficient` 중 하나. `action`은 반드시 `review-only` 또는 `no-action`; **매수/매도/비중·손절 주문을 반환하지 않음**. `blocking`, `reasons`, `conditions`, `evidence`, `marketContext`, `sectorContext`, `events`를 함께 노출하여 근거 확인과 판단 보류 사유 표시.

## 후보와 보유종목의 별도 대응

- **신규 후보**: 시장 고변동성/공식 경제·실적 임박 → `신규 진입 경계`; 자료가 부족하면 추가 확인. 단타 확정봉 돌파+거래량, 스윙 상대강도·돌파·눌림목은 *관측 조건*일 뿐 매수 추천이 아님.
- **보유 종목**: 고변동성/중요 발표, 추세 훼손, 참조 지지선, 평단 대비 상태를 검토. 계좌별 원금·수량은 기존 사용자 전용 화면에만 보관. 투자전략 엔진에서 실거래 주문이나 자동 손절하지 않음.
- **이벤트 자료 부족**: 절대로 '위험 없음'으로 표시하지 않음. 일부 이벤트가 공식 검증되어 있는 경우 해당 위험 경고를 유지하면서 나머지 공급자 미연결도 명시.
- **산업 연결 미확인**: 강한 산업을 임의로 특정 종목의 소속 산업으로 취급하지 않음. `sectorLink`는 사용자 선택 라벨만으로 생성 금지; 실제 매핑 출처와 거래일 검증 필요.

## 개발·검증·통합 경계

신규 파일만 추가했으며 Codex가 작업 중인 `index.html`, `js/page-strategy.js`, `js/page-stocks.js`, `js/page-market.js`, `js/page-sectors.js`, `js/invest-workflow.js`, 캘린더·GAS·주문 기능은 이번 작업에서 수정하지 않음.

```sh
node --check js/integrated-strategy-engine.js
node --check js/integrated-event-adapter.js
node tests/integrated-strategy-engine.test.cjs
node tests/integrated-event-adapter.test.cjs
```

자동 테스트: `.github/workflows/integrated-strategy.yml`. 실데이터 시세, NH 조회, 실제 개인 구글 캘린더, 운영 배포, PC/Fold6 화면 테스트는 **별도 통합 단계**. 자체 단위 테스트는 이를 대체하지 않음.

후속 인수 단계에서 모든 시장·산업·종목·공개 이벤트 데이터가 실제로 준비된 경우에만 기존 캐시를 재사용하며 화면에 근거·판단 보류 사유 표시. 소스 추가 조회가 필요한 경우 기존 호출 정책을 준수하고 공개 엔진은 조회하지 않음. 전체 회귀 통과 및 명시적 운영 승인 전까지 production 금지.
