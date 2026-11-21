# MY INVEST V2 — 기존 시장·산업·종목 분석 재사용 어댑터 V1

## 개발 원칙

이번 모듈은 이미 운영 중인 분석 계산식을 다시 만들지 않습니다. `js/sector-insights.js`의 `metrics`·`sampleBreadth`와 `js/work-trading-strategy.js`의 `analyze` 결과를 **입력 그대로 재사용**하고, 서로 다른 계층의 관측일·표본·차트 수치가 일치할 때에만 기존 독립 `js/market-sector-stock-alignment-v1.js` 엔진으로 전달합니다.

- 기반 소스: `feat/market-sector-stock-alignment-isolated`
- 독립 브랜치: `feat/market-sector-stock-adapter-isolated`
- 신규 모듈: `js/market-sector-stock-adapter-v1.js`
- 테스트: `tests/market-sector-stock-adapter-v1.test.cjs`
- 기존 `js/page-*.js`, `index.html`, NEWS PR #8, Codex `integration/news-strategy-20261121`, `relay/`, Worker, GAS, NH, 운영 브랜치 변경 없음

이 모듈은 **실제 사이트·기존 UI에 아직 연결되지 않은 순수 데이터 어댑터**입니다. 실제 소스 수집·인증·계좌 조회·저장·주문·배포를 수행하지 않습니다.

## 입력 및 재사용 출처

`MYInvestMarketSectorStockAdapterV1.prepare(input, {insights: SectorInsights, alignment: MYInvestMarketSectorStockAlignmentV1})`

사용하는 `input` 스키마:

```text
{
  now, market: 'KR'|'US', mode: 'swing',
  benchmark: {symbol, evidence, series},
  marketBreadth: {universe, expectedCount, observedCount, advancers, evidence},
  sectors: [{id, evidence, series, expectedMembers, members}],
  stocks: [{symbol, sectorId, evidence, series, technical}]
}
```

- `benchmark.series` 및 각 산업/종목의 `series`: 기존 SectorInsights 구조의 `{times, bars, volume}`. `times`는 Unix **초**, 가격 배열과 거래량 배열의 길이는 동일해야 합니다.
- `benchmark.symbol`: 한국 `^KS11`, 미국 `^GSPC`만 허용합니다.
- `evidence`: `{source, asOf, phase, observedAt, receivedAt}` 정확한 필드. asOf는 현지 거래일 YYYY-MM-DD, `phase='close'`, 관측·수신시간은 Unix **밀리초**.
- `marketBreadth`: **주식시장 전체 관측모집단**이란 사실을 외부 데이터 수집단에서 확인해 넣어야 하며, 한국은 universe=`KR_LISTED`, 미국은 `US_LISTED`. 단순 산업 표본을 시장 전체 폭으로 대체하지 않습니다.
- `sectors.members`: 각 실제 구성종목 `{symbol, change, relative, asOf, observedAt, source}`. 출처와 관측일 없는 단순 산업 그룹 응답은 적격 표본이 아닙니다.
- `stocks.technical`: 원본 `WorkTradingStrategy.analyze({mode:'swing',interval:'1d',bars,...})` 결과. 코드가 반환한 16개 공식 필드만 허용하며, 상태 `ok`, `trend='up'`을 요구합니다.

## 실제 재사용 계산

| 내용 | 재사용 구현 | 어댑터 추가 검증 |
| --- | --- | --- |
| 벤치마크 5·20일 수익률 | SectorInsights.metrics(benchmark, benchmark) | 두 기간 정합성, 종가 현지일 |
| 산업 5·20일 상대강도 | SectorInsights.metrics(sector, benchmark) | 종목별 원천 거래일 21개와 벤치마크의 동일일 정렬 |
| 산업 거래량 배율 | metrics.volumeChange | `(1 + volumeChange/100)`의 명시적 단위 변환 |
| 산업 표본 상승·커버리지 | SectorInsights.sampleBreadth(members, expectedMembers) | 독립 실제 표본 출처 및 관측시각, 유효 표본 60% 이상 |
| 종목 상대강도·거래량 배율 | SectorInsights.metrics(stock, benchmark) | 5일 수익률과 WorkTradingStrategy.momentumPct, 20일 기준 거래량 배율과 WorkTradingStrategy.volumeRatio의 수치 교차검증 |
| 종목 기술분석 | WorkTradingStrategy.analyze의 기존 출력 | 상태 `ok`, swing 모드, 동일 마지막 확정일봉 시각, turnoverRatio 확인 |
| 종목 20개 일봉 평균대비 변화 | 기존 차트의 마지막 20개 종가 | 벤치마크와 동일한 21거래일을 갖는 시계열만 사용; 누락·이중집계 금지 |
| 최종 관찰 분류·가상 위험상한 | 기존 market-sector-stock-alignment-v1.examine | 재계산/순위화하지 않음 |

## 중요한 보호 조건

1. **스윙 분석만 연결**: `WorkTradingStrategy`에서 day는 1m~1h 분봉이 필수입니다. 일봉 산업 강도만으로 단타의 분봉/VWAP 진입 타이밍을 인증할 수 없어 `DAY_INTRADAY_EVIDENCE_NOT_CONNECTED`로 보류합니다.
2. **UTC 날짜와 거래소 현지 날짜 일치**: 기존 SectorInsights.aligned는 UTC 날짜로 일봉을 조인합니다. 원천 캔들의 UTC 날짜가 뉴욕/서울 현지 거래일과 달라질 수 있으면 잘못 결합하지 않고 차단합니다.
3. **동일 21거래일**: 마지막 거래일만 같은 자료가 아니라 전후 21일의 관측 거래일 배열이 동일해야 합니다. 누락된 거래일·중복 날짜를 무작정 합치지 않습니다.
4. **시장 폭과 산업 폭 분리**: `industry-data.js`의 산업 그룹에는 시각이 누락될 수 있습니다. 관측시각이 확인되지 않거나 구성종목 상대강도가 없으면 시장·산업 대표성을 임의로 만들지 않습니다.
5. **가격·거래량·시간의 불명확성 차단**: 최근 원천시각 96시간, 수신시각 30분, 미래 5분 제한을 두고 각 구성종목 시각이 산업 응답 수신보다 미래인 경우도 차단합니다.
6. **출처·데이터 진위 미인증**: `source`와 `phase='close'`가 입력되었다고 거래소 공식 시세나 실제 마지막 거래일을 검증한 것이 아닙니다. 장내 실제 호가/수정주가·공휴일/조기폐장·실시간 데이터 인증은 외부 후속 작업입니다.
7. **비공개 데이터 차단**: 임의 계좌번호·토큰·주문·URL/요청 원문 필드를 수용하지 않고, 검증 실패 시 입력 원문을 출력하지 않습니다.

## 기본 출력

- 정상: `{status:'coherent-input', context:{...기존 정합성 분류}, mapping:{...실제 재사용 경로}, marketSources:{...}}`
- 검증 실패: `{status:'blocked', code:'사유', comparison:null, ...}`
- `tradeApproved`, `canPlaceOrder`, `dataVerified`는 언제나 false
- 실제 보유종목 전략, 종목 추천, 매매 우선순위 또는 주가 예측을 자동으로 생성하지 않습니다.

## 한계 및 다음 통합 순서

이 모듈은 *데이터 형식·상호 일관성* 검증입니다. 표본의 대표성·휴장일·조정주가·수집 지연·거래소 권위는 확인하지 못하므로 실데이터 투자판단에 직접 연결하지 않습니다.

Codex 통합 브랜치가 안정화된 후 ① 최신 파일·CI·PR 확인 → ② 기존 종목/산업/시장 화면이 실제 제공하는 필드만 읽기 전용으로 매핑 → ③ 원천시각·모집단·거래일 누락 시 보류 → ④ PC/Fold6 회귀 → ⑤ 사용자 승인 후 개발 사이트 게시 순서로만 통합합니다. 임의 API 호출이나 운영 배포는 승인하지 않습니다.