# MY INVEST V2 — 시장 국면 분석 엔진 V1

**개발 상태:** 독립 엔진 및 단위 테스트 완료. **기존 홈/시장/전략 화면 미연결**. 다른 개발자(Codex)의 캘린더·화면 통합 작업과 충돌하지 않도록 신규 파일만 추가했다.

## 목적과 제한

`js/market-regime-engine.js`는 이미 받은 시장 자료를 **조회 없이** 분석하는 결정론적 읽기 전용 함수 집합이다. 한국·미국 핵심 지수 두 개를 각각 독립적으로 평가하고, 5·20일 종가 분석이 가능할 때만 모멘텀을 평가한다. 자료가 부족하면 `insufficient` / `unknown`으로 반환한다.

- 한국: `^KS11`, `^KQ11`
- 미국: `^GSPC`, `^IXIC`
- 참고 자료: `^VIX`, `KRW=X`, `^SOX`
- 미연결 자료: 시장 상승종목 비율, 거래대금/시장 breadth, NYSE `$TICK` 공식 원천값 (수치를 생성하지 않음).
- 데이터 사용: 현존 `Q`(지수 시세), `SRC`(공급자 코드), `QT`(수신시각)와 기수집 일봉 데이터. `ctx.market()`, `ctx.data.publicRead()` 등 **추가 호출 없음**.
- 실행/주문/종목 추천과 분리한다. 결과는 **관측에 기초한 설명**이며 추세 예측이나 매매 신호가 아니다.

## 입력 계약

```js
// Context-adapter example. Pseudocode for future integration ONLY.
// Call in a trusted existing browser renderer where Q, SRC, QT are defined;
// do not copy real account data or private sessions.
const now=Date.now();
const quotes=MYInvestMarketRegime.adaptQuotes(Q,SRC,QT,now);
const resultKR=MYInvestMarketRegime.assess({
  region:'KR',observations:quotes,now,
  histories:{'^KS11':existingKOSPIbars,'^KQ11':existingKOSDAQbars},
  eventRisk:MYInvestEventContext?.assessment({mode:'day',now})
});
const resultUS=MYInvestMarketRegime.assess({
  region:'US',observations:quotes,now,
  histories:{'^GSPC':existingSP500bars,'^IXIC':existingNASDAQbars}
});
```

`histories[symbol]`는 오름차순 종가 배열: `[{date:'YYYY-MM-DD',close:...},...]` 또는 `[{at:'2026-11-23T15:00:00Z',close:...},...]`. 거래소 기준 날짜가 포함된 일봉은 `date`를 우선 사용한다. 21개 이상의 실제 기준일별 데이터가 있어야 20일 변화율을 계산하며, 평균선 위/아래 여부도 검증된 20개 종가로만 판정한다.

`observations[symbol]`은 `{symbol,value,previous,observedAt,receivedAt,source,failed}`를 받는다. 지수 전일 대비율만 알고 전일 종가 또는 원천 관측시각을 모르면 방향을 판정하지 않는다. `observedAt`/ `receivedAt`를 합치거나 receipt를 원천시각으로 위장하지 않는다. 두 핵심 지수의 관측 기준일이 다르면 `insufficient` 반환.

### 국면 해석

- **방향**: 두 핵심 지수 전일 대비 각각 +0.2% 이상이면 `up`, -0.2% 이하이면 `down`; 나머지는 `mixed`. 1일 변화이므로 `당일 상승/하락 우위`이지 중장기 추세가 아님.
- **모멘텀**: 두 지수 모두 5일·20일 양(음)의 변화 및 종가가 MA20 위(아래)면 `strengthening`(`weakening`); 불일치 시 `divergent`. 해당 일봉이 부족하거나 시세 관측일 이후 자료면 `unknown`.
- **VIX 위험 구간**: VIX 20/30 기준은 간단한 편의적 위험 참고 수준으로, 과거 수익을 검증한 예측 모델/확률이 아니다. VIX가 없으면 위험 정도를 `unknown`으로 유지.
- **환율**: 원/달러 전일 대비 절댓값 1% 이상이면 환율 변동 경계 근거를 추가.
- **이벤트**: 공식 일정의 미연결/주요 발표 위험을 경고 문구로만 전달; 시장 방향 예측에 추가하지 않음.
- **단타·스윙**: `execution.day`/`execution.swing`은 `undetermined`, `caution`, `context-only` 중 하나. `context-only`는 매매 적합함이 아니라 위험 자료 참고 가능함을 의미한다.

데이터 품질: 수신시각 30분, 관측시각 4일 초과면 사용 차단. 과거 종가가 최신 수신됐더라도 지연 플래그와 '최근 확인 종가 기준'을 보존한다. 국가별 휴장일·세션 계약은 별도의 거래소 달력/데이터 검증 계층에서 처리해야 하며 이 엔진은 실시간 거래 상태를 단언하지 않는다.

## 반환값

`{schemaVersion,region,status,direction,momentum,risk,execution,delayed,evidence,extras,missing,history,liquidity,tick,warnings}`

`evidence`의 실제 지수값, 일별 변동률, 공급자, 원천 관측시각과 수신시각을 UI 근거 펼쳐보기에서 사용한다. `liquidity`와 `tick`은 실데이터 계약이 구현되지 않는 한 반드시 `unavailable` 유지.

## 검사 방법

```bash
node --check js/market-regime-engine.js
node tests/market-regime-engine.test.cjs
```

개발 브랜치 자동 실행: `.github/workflows/market-regime.yml`.

테스트 항목은 양국 지수 상승·하락·혼조, 구두 시점 불일치, 최근 종가 지연, VIX·환율, 5·20일 일봉 누락/중복, 미국 date-only 거래일 보존, 원천시각 누락·실패, 위험 이벤트, 미확인 TICK, 순수 함수·추가 호출 없음이다.

## 후속 화면 연동의 인수 조건

Codex가 캘린더를 수정 중이므로 기존 `js/page-home.js`, `js/page-market.js`, `js/page-strategy.js`, `index.html`은 이번 작업에서 수정하지 않았다.

해당 담당자와 충돌이 없는 시점에 다음을 통합한다.

1. `index.html`에 엔진 스크립트 1회 로드 (홈/시장보다 먼저).
2. 기존 `Q/SRC/QT` 및 유효한 일봉 캐시로만 입력 어댑터 구성. 일봉이 없으면 `momentum.unknown`을 유지. 히스토리 데이터를 가져오는 것은 별도 데이터 수집 파이프라인의 책임.
3. 홈 시장국면 요약 및 글로벌 시장 화면에 `direction`/`risk`/`momentum`을 독립 표기하고 `evidence` 펼쳐보기 제공.
4. 한국장·미국장 기준일 차이, 장 개장 전/휴장·종가 확정 여부, VIX/환율 수신시각, 344px·690px·1440px 시각 및 접근성 테스트.
5. 신규 전략은 검증된 공식 시장 데이터만 인용하고 확인되지 않은 `$TICK`/market breadth/외부 일정/실적은 수치화하지 않는다.
6. 전체 회귀 PASS 및 실제 데이터 검증 후 사용자 승인 없는 운영 배포 금지.

**주의:** 단위 테스트는 모의 입력을 검증한다. 실제 시세 공급자의 symbol/통화·원천시각·호가단위·수신시점, 화면 출력은 아직 미검증이다.
