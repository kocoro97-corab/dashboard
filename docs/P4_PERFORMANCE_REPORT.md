# MY INVEST V2 — P4 표준 성과·위험 비교 보고서 (독립 모듈)

## 범위 및 코드 경계

- 구현: `js/strategy-performance-report-v1.js`
- 검증: `tests/strategy-performance-report-v1.test.cjs`
- 의존: `js/strategy-series-quality-v1.js`, `js/strategy-evaluation-v1.js`, `js/strategy-evaluation-review-v1.js`
- 브랜치: `feat/p4-strategy-evaluation-isolated`
- 네트워크·인증·NH·GAS·Worker·storage·실제 주문·운영 배포 접근 **없음**.
- 기존 Codex 수정 영역 `relay/`, `js/dev_market.js`, `js/transport.js`, `js/read-status.js`, `js/page-*.js`는 수정하지 않음.

## 목적

P4 과거 전략 성과를 **성공률 1개**가 아니라 다음 묶음으로 기록한다.

| 분류 | 출력과 의미 |
|---|---|
| 데이터 품질 | `block`, `review_required`, `structurally_ready`; 실제 원천 진위는 불명 |
| 수익 | 거래 횟수, 순수익률(%), 순손익(투자 초기 통화), 최종 자본 |
| 매매 기대값 | 거래당 평균 순손익, 평균/중앙값 net R, 손익비(손실이 없으면 null) |
| 승률 불확실성 | 승률, Wilson 95% 참고범위; 독립 거래 가정이 검증되지 않으므로 성과 증명 아님 |
| 위험 | 일별 종가 가상 청산기준 낙폭, 실현손익 낙폭, 위험예산 초과 거래 |
| 거래비용 | 매수/매도 수수료와 체결가격 슬리피지 거리의 근사 합계. 슬리피지 근사치는 무슬리피지 가상 P&L 변화가 아님 |
| 노출 | 평가기간 대비 보유한 거래일 비율 |
| 기준 비교 | 같은 종목 100% 장기보유와 최대 배분비율 장기보유; 노출·기간이 다르므로 alpha 아님 |
| 신뢰성 | 실제 원천 미검증, 외표본 독립성 미확인, 30건 미만 표본 주의 표시 |

**이 모듈은 전략을 자동 순위화·최적화·추천하지 않는다.** 동일 과거 표본에서 가장 높은 수익률 시나리오를 고르는 것은 데이터 스누핑 편향을 유발한다.

## 사용 방식 (합성 예시, 화면 연결 없음)

```js
const report = require('./js/strategy-performance-report-v1.js');
const output = report.generate({
  now: 1795262400000, // Unix ms, 호출자가 정확한 현재시각 제공
  cases: [
    {
      id: 'swing-v1', label: '20봉 돌파 · 위험 1%',
      series: {
        interval:'1d', market:'US', exchange:'NASDAQ', currency:'USD',
        symbol:'TSLA', finalized:true, priceConvention:'split_adjusted',
        sourceProvider:'SyntheticTest',
        observedAt: 1750000000000, purpose:'historical',
        bars:[/* 120봉 이상의 유효한 확정 일봉 {t,o,h,l,c,v} */]
      },
      strategy: {riskPct:1, maxAllocationPct:25, feeBps:10, slippageBps:10}
    }
  ]
});
```

- `now`는 **명시적 Unix ms**여야 한다. 함수는 오늘 날짜를 추측하지 않고 외부 API도 호출하지 않는다.
- `cases`는 **1~6개**; ID 중복·잘못된 타입이면 `invalid`.
- 개별 데이터 품질에 오류가 있으면 `blocked`, 구조적 이상 징후가 있으면 `review_required`; 두 경우 `metrics:null`. 품질 검토가 끝나지 않았는데 결과를 생성하지 않는다.
- 모든 품질 조건이 통과한 경우에만 P4 엔진으로 재실행하고, 거래 장부/성과 일치성을 확인해 `descriptive_only`로 표시한다. 원천 진위는 **이 경우에도 false**.
- 전략 입력의 `bars` 또는 `interval`로 이미 품질검사한 시계열을 바꿀 수 없도록 고정한다.
- 다른 시나리오의 숫자를 한 표에서 비교하려면 시장·거래소·종목·통화·가격조정·공급자·모든 OHLCV·평가구간·초기자본·수수료·슬리피지가 같아야 한다. 다르면 `comparison.eligible:false`.
- `riskPct`나 `maxAllocationPct`가 다르면 노출 차이를 경고하며, 비교가 가능해도 우승·추천 전략을 생성하지 않는다.
- 이 계산은 **고정 규칙의 가상 재현**이며 미분리 장중 가격 순서, 시장 충격, 실제 세금·외환, 살아남은 종목만 포함하는 편향 등을 해결하지 못한다.

## 후속 통합 작업 (현재 수행하지 않음)

실데이터 공급자 정책, 완결된 거래소별 가격조정 시계열, 실제 관측시각, 거래일 달력, 장기간 미사용 외표본 검증을 확인한 뒤에만 읽기 전용 대시보드 화면으로 연결한다. 이 통합·배포는 사용자가 추후 Codex 지시서 작성을 요청할 때 기존 Codex 작업과 중복되지 않도록 정리한다.
