# MY INVEST V2 — 시장·산업·종목 판단 근거의 날짜별 변화 추적 V1

## 개발 목표와 기존 모듈 재사용

이미 만들어진 `market-sector-stock-alignment-v1.js`의 시장·산업·종목 분류와 `investment-evidence-explanation-v1.js`의 검증된 한국어 근거 설명을 그대로 사용하여 **날짜별 관찰 변화**만 기록·비교한다.

새로 시장 수익률, 종목 지표, 상대강도, 모멘텀 또는 매수·매도 전략을 계산하지 않는다. 이 모듈이 말하는 '강화/약화'는 **입력 분류 조건의 변화**이며 주가 수익률이나 승률, 매매 타이밍이 아니다.

브랜치: `feat/investment-evidence-timeline-isolated`

### 신규 소스

- `js/investment-evidence-timeline-v1.js`: 순수 함수로 과거 스냅샷을 정제·검증하고 인접 관측일 사이의 변화만 계산
- `tests/investment-evidence-timeline-v1.test.cjs`: 날짜·출처·표본·중복종목·개인정보·오류 처리 등 합성 시나리오
- `tools/inspect_investment_timeline_v1.cjs`: 사용자 승인형 표준입력에서 JSON이나 **종목명 없이 집계하는** 요약 모드 출력
- `tests/investment-evidence-timeline-cli-v1.test.cjs`: CLI 입력 크기·형식·비밀정보/토큰 차단 테스트
- 이 문서 및 독립 GitHub CI 파일

## 데이터 연결 구조

```text
기존 시장·산업 데이터 + WorkTradingStrategy (직전 개발 단계, 직접 호출 없음)
  → market-sector-stock-adapter-v1.prepare(...)
    → market-sector-stock-alignment-v1.examine(...)
      → investment-evidence-explanation-v1.explain(adapterOutput)
        → investment-evidence-timeline-v1.compile(history)
          → 정제된 기간별 관찰 스냅샷 + 분류 변화 목록
```

동일한 `adapterOutput`을 `explain()`으로 **다시 검증한 후** 허용된 필드만 복사한다. 입력 계좌정보·실시간 호가·종목 원시 OHLCV·기술적 지표 원문은 반환하지 않는다.

### 입력 계약

```js
MYInvestInvestmentEvidenceTimelineV1.compile({
  market: 'KR', // 또는 US
  mode: 'swing',
  now: 1795000000000, // 예시 Unix 밀리초; 실제 호출 시 명시
  records: [
    { asOf: '2026-11-18', capturedAt: 1795000000000, adapterOutput: previousValidatedAdapterOutput },
    { asOf: '2026-11-19', capturedAt: 1795086400000, adapterOutput: nextValidatedAdapterOutput }
  ]
});
```

위 숫자는 **형태를 보여주는 예시**이며 실제 시장 캡처 시각을 의미하지 않는다. 호출자는 각 레코드의 실제 보관·수집시각을 명시적으로 넣어야 한다.

- `records`는 날짜와 capturedAt 모두 **엄격한 오름차순**, 같은 거래일 중복 불허.
- KR은 서울 현지 거래일, US는 뉴욕 현지 거래일을 사용한다. 미국 DST는 기존 `localDay()`를 재사용한다.
- 캡처시각은 자료 거래일보다 앞설 수 없고, 입력된 now보다 5분 이상 미래일 수 없다.
- 최대 90개 날짜, 기록당 직렬화 문자열 최대 196608자, 정제 후보 최대 60종목.
- 기존 어댑터 차단 출력도 고정된 검증 사유에 한해 기록할 수 있지만, 이 날은 `unqualified`로 분류하며 전후 변화 추정은 **보류**.

## 변화 판정 정책 (수익률 해석 금지)

| 변화 종류 | 설명 |
| --- | --- |
| context-strengthened | 기존 관찰 클래스가 defensive-watch → mixed-watch → aligned-watch 방향으로 이동 |
| context-weakened | 위 방향의 역전 |
| layer-changed | 전체 클래스는 같지만 시장·산업·종목 계층 중 구성 근거 변경 |
| context-unchanged | 비교 가능한 두 날짜에 관찰 클래스 및 계층 설명 유지 |
| evidence-recovered / evidence-lost | 종목 관측의 구조적 적격성 회복 또는 상실 |
| new-observation | 이번 표본에서 신규 등장. *새 상장·새 매수·추천 아님* |
| not-observed | 이번 표본에서 미관측. *매도·상장폐지 아님* |
| sector-reclassified | 종목의 산업 연결 분류가 달라져 강약 해석을 보류 |

시장 자체도 supportive/mixed/defensive 변화를 별도로 표시한다. 그러나 **연속 거래일 확인**, 실제 수익률, 승률, 가격 전망 또는 종목 순위는 생성하지 않는다.

### 날짜 비교를 중단하는 경우

- 두 날짜 사이의 자료 중 하루라도 원천 근거가 보류(`unqualified`)
- 기준지수 또는 시장 전체 상승종목 데이터의 표시 출처 ID 변경
- 시장 모집단 커버리지 차이가 15%p를 초과 (비교 가능한 표본이 아닐 수 있음)
- 두 관측일 간 달력일 기준 7일 초과 (휴장일 여부는 확인되지 않아 추세 연결 금지)

토·일요일·공휴일 사이에서 관측일이 끊겨도 **실제 영업일의 연속성은 검증하지 않는다**. 두 날짜를 '인접한 저장된 관찰'로만 표현한다.

### 해석의 제한

- `archiveReady:true`는 JSON 형식의 정제 결과를 외부 파일에 저장하기 적합하다는 뜻이지, **어디에도 실제 저장했다는 뜻이 아니다.** 결과에는 항상 `stored:false`가 있다.
- `marketPriceVerified`, `sourceAuthenticityVerified`, `calendarVerified`, `actualPricePerformanceComputed`, `orderApproved`, `automaticTrading`는 항상 false.
- `hypotheticalRiskCeilingPct`는 기존 개발용 위험정책 예시 값이다. 이력의 종목별 매수 추천 비중이나 실제 손익이 아니다.
- 매수·매도 자동주문, 브리핑 내용 변경, 암호·계좌·GAS/Sheets/Properties 쓰기, 데이터 유료 API 호출 없음.

## 오프라인 CLI 사용

이전 단계에서 생성한 어댑터 출력(계좌·인증정보 제외)을 날짜·수집시각과 함께 JSON으로 **사용자가 직접** 준비한 경우:

```sh
node tools/inspect_investment_timeline_v1.cjs --stdin --ack-historical-observations --summary < safe-history-input.json
node tools/inspect_investment_timeline_v1.cjs --stdin --ack-historical-observations --json < safe-history-input.json
```

`--summary`는 종목 ID를 노출하지 않고 날짜별 관찰 종목 수, 시장 국면, 분류 변화 횟수, 비교 보류 이유만 출력한다. `--json`은 정제된 종목 관찰 항목을 포함하므로 승인된 로컬 분석 용도에서만 보관하고 공개 저장소에 업로드하지 않는다.

CLI는 표준입력 4MiB를 넘으면 오류코드만 출력한다. 원문 계좌번호·토큰·미인증 원천 오류를 출력하지 않고, 파일을 생성하거나 저장하지 않는다.

## 검증 및 Codex와의 격리

- 상속한 시장·산업·종목 정합성 테스트 39개
- 기존 분석 재사용 어댑터 테스트 43개
- 기존 한국어 설명 엔진 테스트 35개와 CLI 테스트 9개
- 신규 날짜별 정합성·변화·보류·중복·개인정보 테스트 46개, 신규 CLI 테스트 8개
- 합성 데이터만 사용하며 최종 Node CI PASS 여부와 모든 테스트 숫자는 실행 결과로 확인
- **기존 파일 0개 수정**. Codex의 `integration/news-strategy-20261121`, PR #7/#8 및 뉴스 파일, `page-*.js`, index, GAS, NH, 운영 main/release/pages, dev-pages를 수정하거나 배포하지 않는다.

## 다음 개발

Codex 통합이 완료되면 실제 앱에서 제공하는 시장·산업·종목 관찰 데이터의 날짜/출처 신뢰성 검증을 선행한 후, 허가된 **별도 보관 경로**를 설계할 수 있다. 저장소와 접근권한/개인화 범위가 승인되기 전 이 모듈 자체는 데이터를 영구 저장하지 않는다.