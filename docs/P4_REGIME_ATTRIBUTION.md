# MY INVEST V2 — P4 시장국면별 스윙 전략 사후 성과 분석

## 목표 및 독립 소유권

P4 스윙 백테스트의 **신호가 확정된 시점의 벤치마크 추세**에 따라 성과를 집계한다. Codex 진행 파일을 수정하지 않고, 백테스트 모듈·품질 검사기를 재사용한다.

- 모듈: `js/strategy-regime-analysis-v1.js`
- 합성 단위 테스트: `tests/strategy-regime-analysis-v1.test.cjs`
- 독립 소스 브랜치: `feat/p4-strategy-evaluation-isolated`
- 의존: `strategy-series-quality-v1.js`, `strategy-evaluation-v1.js`, `strategy-evaluation-review-v1.js`
- **GAS, Worker, NH/증권사 계좌, 브라우저 저장소, 공개 시세 호출, 실시간 주문 없음.**
- 운영/개발 사이트 게시 및 화면 통합은 보류. Codex에 현재 작업을 추가로 지시하지 않음.

## 장세 정의: 시장 예측이 아닌 고정된 후행 분류

벤치마크(미국: SPY 등, 한국: 적절한 동일 시장 지수)의 **확정된 일별 종가**를 기준으로 20거래일 수익률을 계산한다.

\[
R_{20}(t)=100\left(\frac{C_t}{C_{t-20}}-1\right)
\]

- **상승 추세(UPTREND)**: `R20 >= +3%`
- **하락 추세(DOWNTREND)**: `R20 <= -3%`
- **횡보 추세(SIDEWAYS)**: 그 사이
- 20거래일과 ±3%는 P4 기준선 **임의 고정 값**이지 최적 임계치나 경제학적 장세 정의가 아니다.
- 신호일 `t`의 **장 마감 후** 해당 시점까지의 벤치마크 데이터로 국면을 결정한다. 실제 매수는 `t+1`의 시가에서만 허용.
- 뒤에 생긴 시세로 과거 국면을 다시 분류하거나 당일 미완성 봉을 사용하지 않는다.

## 입력 검증 및 무결성

```js
const api = require('./js/strategy-regime-analysis-v1.js');
const result=api.analyze({
  now: 1795262400000,                    // 호출자 기준시각 Unix ms
  series:{
    market:'US',exchange:'NASDAQ',currency:'USD',symbol:'SERV',
    interval:'1d',sourceProvider:'SOURCE_DECLARATION',priceConvention:'split_adjusted',
    finalized:true,purpose:'historical',observedAt:1790000000000,
    bars:[/* 최소 120개 확정일봉: {t,o,h,l,c,v} */]
  },
  benchmark:{
    market:'US',currency:'USD',symbol:'SPY',interval:'1d',
    sourceProvider:'SOURCE_DECLARATION',priceConvention:'price_return',
    finalized:true,observedAt:1790000000000,
    bars:[/* series.bars와 동일 길이·Unix ms 타임스탬프: {t,c} */]
  },
  strategy:{riskPct:1,maxAllocationPct:25,feeBps:10,slippageBps:10,targetR:2}
});
```

- 기초 종목은 기존 P4 일봉 품질검사에서 `structurally_ready`가 되어야 한다.
- 벤치마크는 시장·통화·종목 식별·출처 선언·수정주가 규약·확정 일봉 여부·관측일·미래시각·모든 `t,c`를 검사.
- 벤치마크의 연속 종가 간 40% 이상 급변은 오류·분할·이례적 변동 중 무엇인지 원천 검증 전에는 알 수 없으므로 장세 분류를 보류한다.
- 양쪽 거래일은 **정확히 같은 시각의 타임스탬프**여야 한다. 공급자 차이로 시간대가 다른 자료의 임의 조인/전날 값 보간은 허용하지 않는다. 실제 어댑터는 원시 수신값을 검증한 후 거래소 정규 세션별로 명확하게 정규화해야 한다.
- 벤치마크는 지수 가격수익률 기준으로 분류할 수 있으나 **배당 포함 총수익률이나 실현 수익률과 혼동하지 않는다.**
- 입력값의 출처 이름이나 `finalized:true` 표기는 선언일 뿐, 외부 원천의 진위가 입증되는 것은 아니다.

## 집계 방법

1. 기존 P4 엔진으로 다음 거래일 시가 진입·수수료·슬리피지·손절/2R 목표·갭 리스크를 계산.
2. 기존 P4 리뷰 엔진으로 거래장부·총손익을 **독립 재실행하여 대조**.
3. 각 거래의 **신호를 결정한 날 종가의 국면**에 거래를 할당한다. 이후 여러 국면을 거친 보유기간의 손익도 신호일 국면 하나에 귀속한다.
4. 3개 국면별로 분류 대상 일수, 거래 수, 승률·Wilson 참고범위, 총 순손익, 초기자본 대비 순손익 *기여도(%p)*, 평균 순손익·R, 최악 R, 연속손실·계획 위험예산 초과 건수, profit factor를 제공한다.
5. 30건 미만 거래는 근거 부족, 30건 이상도 **독립 검증이나 통계적 유의성이 입증된 것은 아님**으로 분류한다.
6. **합계 검증**: 3국면 손익 합이 전체 P4 거래 순손익과 같아야 하며 거래 건수 합계도 같아야 한다. 불일치하면 결과를 차단.
7. `testStartAt`이 있으면 첫 평가 진입일 **직전 신호일**을 분류에 포함해 다음날 시가 진입을 누락하지 않는다.

## 해석 제한

- `initialCapitalContributionPctPoints`는 공통 최초 자본을 분모로 한 손익 기여도이며 **국면마다 100% 자본을 운용했을 때의 수익률이 아니다**.
- 국면별 거래 승률을 직접 비교해 매수 확률·추천 우선순위·자동 전략 선택으로 변환하지 않는다.
- 이 분류는 선행 지표가 아니며 시장 상승·하락을 **예측하는 AI 모델이 아니다**.
- 거래를 신호일 국면에 귀속하기 때문에, 포지션 보유기간에 발생한 다른 국면의 효과를 별도로 측정하지 못한다.
- 외부 가격 원천의 진위, corporate action/상폐/생존편향, 세금·유동성·가격충격, 비독립 신호, 실제 시장 거래·미사용 독립 외표본은 검증되지 않았다.
- 실제 P4 화면 표시/데이터 어댑터/PC·Fold6 실환경 검증은 Codex 작업 완료 후 별도 결정한다.

## 상태

합성 자동 테스트의 통과는 **구현·회귀 확인**만을 뜻한다. 실데이터 성과 확인 및 운영 배포 PASS와 구분해 보고해야 한다.
