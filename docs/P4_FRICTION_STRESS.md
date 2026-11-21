# MY INVEST V2 — P4 거래비용 및 갭 하락 스트레스 분석 (독립 모듈)

## 설계 목적

스윙 전략의 수수료·슬리피지 가정이 변경되면 과거 모의 결과가 어떻게 달라지는지 보여주고, **계획 손절가보다 불리하게 체결될 경우 1회 위험예산을 초과할 수 있음**을 가상 계산으로 확인한다.

- 모듈: `js/strategy-friction-stress-v1.js`
- 합성 회귀 테스트: `tests/strategy-friction-stress-v1.test.cjs`
- 기존 의존: `js/strategy-series-quality-v1.js`, `js/strategy-evaluation-v1.js`, `js/strategy-evaluation-review-v1.js`
- 독립 브랜치: `feat/p4-strategy-evaluation-isolated`
- **실제 NH·공개 API 호출, 계좌·인증·Worker·GAS·주문·개발/운영 Pages 변경 없음**.

## 시나리오 (고정, 최적화 없음)

기존 P4 고정 스윙 규칙과 동일한 종목·확정 일봉을 재사용한다. 실무 운영용 숫자가 아니라 사전에 고정한 합성 스트레스 레벨이다.

| 비용 시나리오 | 수수료 추가 | 슬리피지 추가 |
|---|---:|---:|
| 기준 | 0bp | 0bp |
| 수수료 +10bp | +10bp | 0bp |
| 슬리피지 +10bp | 0bp | +10bp |
| 복합 +10bp | +10bp | +10bp |
| 수수료 +30bp | +30bp | 0bp |
| 슬리피지 +30bp | 0bp | +30bp |
| 복합 +30bp | +30bp | +30bp |

1bp=0.01%p. 각 시나리오는 **원래 고정 규칙을 처음부터 다시 실행**하여 진입가·목표가·포지션 수량·손절·보유일을 다시 계산한다. 따라서 기준 대비 순손익 차이는 단순히 수수료 금액만 빼서 설명할 수 없다. 각 시나리오 거래 경로와 포지션 크기가 달라질 수 있으므로 차이를 **순수 비용인과효과**로 호칭하지 않는다.

모델이 지원하는 비용 상한은 각 200bp이므로, 현재 가정에 +30bp를 더하면 상한을 넘는 입력은 명확히 `blocked`로 반환한다. 실제 수수료에 대한 추정치나 최적의 거래비용을 예측하지 않는다.

## 갭 하락 가상 충격

이 모듈은 과거 P4 백테스트의 **이미 관측된 각 진입 거래**를 개별적으로 다음과 같이 가정한다.

```
가상 갭 시가 = 계획 손절가 × (1 − 충격률)
가상 청산 체결가 = 가상 갭 시가 × (1 − 슬리피지)
가상 손익 = 수량 × (청산 체결가 − 기존 진입 체결가)
            − 진입 수수료 − 청산 수수료
```

- 충격률은 **계획 손절가 대비 -5%, -10%** 두 가지 고정 가정이다.
- 원래 P4가 정한 포지션 수량·진입 체결가·계획 위험예산을 유지한다.
- 각 거래를 **하나씩** 충격받는 것으로 검토하며, 과거 전체 거래가 동시에 손절된 것처럼 손익을 합산하지 않는다.
- `worstSingleTrade.netPnl`, `worstSingleTrade.netR`, `riskBudgetOverrunIfShockedCount`를 반환한다.
- 거래가 0회라면 최악 손실을 0원으로 **날조하지 않고 null**로 표기한다.
- 어느 정도의 충격이 실제 발생할지, 특정 충격 수준이 '최악'인지, 사용자 전체 계좌가 얼마나 잃을지 예측하는 기능이 아니다. `portfolioVar:null`, `portfolioReturnPct:null`.

## 입력 및 결과 예제

```js
const stress = require('./js/strategy-friction-stress-v1.js');
const result = stress.analyze({
  now: Date.now(),                    // 계산 전 현재시각
  series: {
    market: 'US', exchange: 'NASDAQ', currency: 'USD',
    symbol: 'SERV', finalized: true, interval: '1d',
    priceConvention: 'split_adjusted', sourceProvider: 'DECLARED_SOURCE',
    purpose: 'historical', observedAt: Date.now(),
    bars: [/* 최소 120봉 이상의 확정 {t,o,h,l,c,v} */]
  },
  strategy: {riskPct:1, maxAllocationPct:25,
    feeBps:10, slippageBps:10, targetR:2}
});
```

- 데이터 구조가 P4 품질검사 `structurally_ready`가 아니라면 분석 보류.
- 실제 시세를 수신했다는 검증 없이 `verification.sourceVerified:false` 유지.
- 신호 발생일 종가 후 판단, 다음 거래일 시가 진입, 일봉 손절/목표 동시 충족 시 손절 우선 등 기존 P4 모델에 의존.
- 날짜 구간을 정한 `strategy.testStartAt`도 모든 비용 재실행에 그대로 적용하며, 미래 봉을 의사결정에 사용하지 않는다.
- 기존 리뷰 엔진이 모든 비용 시나리오의 거래 장부를 독립 재검증하지 못하면 분석 결과를 거부.
- 현재 버전은 **단일 고정 전략의 가상 스윙 과거검증만** 지원한다. 분봉 단타/실시간 매수 신호/AI 모델 최적화/실제 주문은 제외.

## 코드·배포 경계

Codex가 진행 중인 중계 장애·시세 연결·기존 화면·Worker/GAS/개발 사이트 게시 파일은 수정하지 않는다. 후속 실데이터 어댑터, 화면 통합, 실사용 기기 검증, 개발용 1시간 세션 실제 배포는 별도 Codex 보류 목록에 기록하고, 사용자가 지시문 작성을 요청하기 전에는 Codex에게 지시하지 않는다.

실제 데이터의 체결 가능성, 호가 공백, 정규장/시간외, 기업행동, 상장폐지, 슬리피지 분포, 한국/미국 거래비용 정책 등은 **별도 검증 필요**. 이 도구의 스트레스 숫자를 금융손실의 상한이나 투자 권고로 사용하지 않는다.
