# MY INVEST V2 — P4 공개 일봉 품질 검증 (독립 모듈)

## 소유권 및 상태

- 순수 JavaScript 모듈: `js/strategy-series-quality-v1.js`
- 합성 회귀 테스트: `tests/strategy-series-quality-v1.test.cjs`
- 독립 브랜치: `feat/p4-strategy-evaluation-isolated`; Codex 작업과 병렬 진행
- **실제 Yahoo/Naver/NH 시세 연결, 인증, GAS, Worker, 개발 Pages, 운영 환경 변경 없음**

이 검증기는 사용자 또는 별도 어댑터가 넘긴 OHLCV **구조와 이상 징후**만 확인한다. 외부 공급자가 실제로 해당 시세를 제공했는지 확인하지 못하며 `realSourceVerified:false`를 항상 반환한다.

## 입력 규격

```js
const quality = require('./js/strategy-series-quality-v1.js');
const report = quality.inspect({
  interval:'1d',                         // 필수
  market:'US',                           // 'US' | 'KR'
  exchange:'NASDAQ',                     // 거래소 직접 명시
  currency:'USD',                         // KR은 KRW, US는 USD
  symbol:'TSLA',                          // 실제 상품/시장 식별은 별도 검증
  finalized:true,                         // 소스의 일봉 마감 확정을 호출자가 진술
  priceConvention:'split_adjusted',      // raw | split_adjusted | total_return_adjusted
  sourceProvider:'DECLARED_SOURCE_ONLY',  // 명칭 선언이지 원천 진위 증명이 아님
  purpose:'historical',                   // historical | current
  observedAt: Date.now(),                 // 원천 응답 관측시각 (Unix milliseconds)
  now:Date.now(),                         // 실환경에선 현재시각
  bars:[{t:1735862400000,o:100,h:103,l:99,c:102,v:10000} /* ...최소 22봉 */]
});
```

`t`는 밀리초 단위이며 일봉의 시작 타임스탬프일 수도 있으므로 `finalized:true`는 실제 공급자 응답과 거래일 기준으로 외부 검증되어야 한다. 날짜 자체만으로 봉 마감 확정을 추론하지 않는다.

## 검증 규칙

| 범주 | 동작 |
|---|---|
| 식별 | US/KR 시장, 알려진 거래소, 종목 코드, 통화 조합이 없거나 틀리면 BLOCK |
| 구조 | 1일봉 여부, 최소 22개, 최대 5천개, 유효한 OHLC, 오름차순·18시간 이상 일봉 간격 |
| 달력 | 뉴욕/서울 거래소 로컬 날짜 기준 중복 데이터 BLOCK |
| 거래량 | 음수·문자열 거래량 BLOCK, 누락/null·0 거래량 REVIEW |
| 시간 | 현재 시점 이후 데이터 및 관측시각 불일치 BLOCK; 오래된 CURRENT 시계열 REVIEW |
| 주식분할 의심 | 종가 40% 이상 변화는 REVIEW; 분할 여부를 임의로 확정하거나 자동 보정하지 않음 |
| 장중 가격범위 | 고가/저가 대비 넓은 가격범위 REVIEW |
| 긴 공백 | 10일 초과 간격 REVIEW; 휴장인지 상장정지인지 추정하지 않음 |
| 조정주가 | 미명시 또는 총수익 수정 방식의 OHLCV 일관성 미확인 시 REVIEW |
| 표본 | 120봉 미만 REVIEW; 30거래 승리/실패 기록만으로 전략 유효성을 확정하지 않음 |
| 원천정보 | 공급자 명칭·관측시각 미기재 시 REVIEW; 기재되어도 진위 자체는 미검증 |

`status`는 `block` / `review` / `structurally_ready` 중 하나다. `eligibleForProvisionalBacktest`는 하드 오류와 검토 경고가 모두 0일 때만 `true`다. 그러나 **이 값이 true여도 원천 검증 또는 실전 성과 검증은 아니다.** 이 모듈만으로 실데이터 PASS, 매수 신호, 유료 API 호출, 실제 주문을 실행해서는 안 된다.

## 통합 전 과제 (현재 미실시)

기존 Codex 실데이터 연결 작업이 끝난 뒤, 검증된 공개 데이터 어댑터가 완결된 일봉, 시장·상품 코드, 통화, 분할/배당 조정정책, 관측 시각을 전달해야 한다. 이후 본 모듈로 이상 징후를 검사하고, `review`/ `block`은 백테스트 성과 발표를 보류한다. 반영과 브라우저 테스트, 개발 사이트 게시, 운영 승인은 각각 별도다.

정책적으로 의심스러운 고변동 종목을 임의 삭제하지 않는다. 그 경우 `review`로만 분류해 투자자가 데이터 품질의 한계를 확인할 수 있게 한다.
