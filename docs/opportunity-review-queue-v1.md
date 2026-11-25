# MY INVEST V2 — 투자기회 후보·보유종목 검토 대기열 V1

## 개발 범위

`js/opportunity-review-queue.js`는 기존 `MYInvestIntegratedStrategy.assess()`의 검증 결과들을 **한 번 더 조회하지 않고** 읽어, 다음 두 독립 목록으로 분리하는 순수 로직이다.

- `candidateQueue`: **신규 매수 후보 검토**. 강한 시장/산업/종목 관찰조건이 있더라도 공식 이벤트·위험지표 누락, 시장 고변동성 등을 먼저 점검.
- `holdingQueue`: **기존 보유종목 위험관리 검토**. 추세 약화, 위험 이벤트와 필요한 확인자료를 먼저 표시. 보유수량·평단·계좌번호는 목록에 출력/저장하지 않는다.

두 목록은 서로 순위·점수 비교하지 않는다. `reviewOrder`는 **검토 작업 순서**로서 예상수익률, 성공확률, 매수 우선순위, 추천 등급이 아니다.

## 실데이터 사용 계약

```js
const opportunityReview = MYInvestOpportunityQueue.collect({
  mode:'swing', // 'day' 또는 'swing'
  nowDay:verifiedMarketDay, // YYYY-MM-DD, 거래소 기준 검증된 날짜
  candidates:alreadyValidatedCandidateStrategyResults, // 동일 모드, intent:'candidate'
  holdings:alreadyValidatedHoldingStrategyResults, // 동일 모드, intent:'holding'
  maxResults:100
});
```

입력은 **기존 통합 투자전략 결과**여야 하며, 종목별 최신 1개를 조회 단계에서 확인하고 전달한다. 신규 API 호출, 시장/섹터/종목 재수집, NH 거래 권한, 데이터 영속화는 전혀 없다.

### 검증 규칙

- 한국 종목 6자리/미국 티커, 국가, 거래일, 투자 기간 및 candidate/holding 유형 일치.
- `schemaVersion` 1, 확인된 stock evidence, `review-only` 또는 `no-action` 전용, 기타 행동·주문값 거부.
- 매매 판단을 만들지 않는 정렬: 위험 이벤트(시장 고위험/발표임박) → 근거 누락 → 기술 관찰/일반 모니터링. **이 정렬은 검토 긴급도이며 매수 기회 순위가 아님**.
- 자료가 불완전한 종목은 `needs-evidence`/판단 보류로 처리. 결과가 아예 불충분·위조·오래된 경우 제외하고 `errors`에 사유 표시.
- **동일 목록에 같은 티커가 중복되면 두 결과 모두 제외**한다. 임의로 먼저/나중 결과를 선택해 위험 경고를 숨기는 실수를 방지한다. 최종 연동자는 원인 확인 후 종목 1개의 승인된 분석 결과만 다시 전달해야 한다.
- 오래된 최종 거래일(기준 `nowDay`와 10일 이상 차이) 및 미래 거래일을 거절한다. 공식 휴장일 검증과 관측시각 변환은 상위 데이터 레이어 책임이다.
- 리포트 출력 필드는 허용목록으로 한정하며 계좌번호, 사용자 ID, 토큰, 보유 수량, 평균매입가, 주문정보 및 평가금액을 보유하지 않는다. 근거 출처·기준일과 검토 이유만 담는다.

### 우선 검토 분류

| 목록 | risk-review | needs-evidence | 기술/보통 |
|---|---|---|---|
| 신규 후보 | 시장 고위험·공식 발표일 임박 → **진입 위험 먼저 확인** | 불완전 데이터·기술 조건 부족 | `technical-watch`: 확정봉 돌파/거래량 등의 관찰조건 |
| 보유종목 | 시장 위험·이벤트·하락 추세 → **보유 위험 먼저 확인** | 보유·시장·산업 등 검증 자료 부족 | `monitor`: 추세·참조 지지선 모니터링 |

**결과에 추천 점수·매수가·매도 비중·주문이 없다.**

## 출력 스키마

```js
{
 schemaVersion:1,mode,evaluatedOn,status,
 candidateQueue:{items:[...],errors:[...],total,reviewed,truncated},
 holdingQueue:{items:[...],errors:[...],total,reviewed,truncated},
 coverage:{candidates:{total,verified,invalid},holdings:{total,verified,invalid}},
 warnings:[...]
}
```

각 `items` 행에는 `symbol,market,intent,mode,asOf,reviewLane,reviewOrder,label,blocked,requiresEvidence,observedTechnicalCondition,reasons,conditions,blocking,risk,evidence`만 포함한다.

`risk.observedSupport`는 과거 일봉에서 관측된 기술적 참조 지지선이지 실제 자동 손절가가 아니다.

## 검증 및 구현 경계

```sh
node --check js/opportunity-review-queue.js
node tests/opportunity-review-queue.test.cjs
node tests/opportunity-review-contract.test.cjs
```

CI: `.github/workflows/opportunity-review.yml` (Node 22).

단위 테스트는 신규 후보/보유종목 분리, 고위험 경계, 근거 부족, 종목·시장 혼합, 날짜 유효기간, 중복 제거, 출력 필드 비노출 및 실제 `js/integrated-strategy-engine.js` 산출물과의 호환성 검증을 포함한다.

Codex가 화면·캘린더·계좌 통합을 진행 중이므로 **이번 개발에서는 `index.html`, `js/page-*.js`, GAS, Sheets, Properties, NH API, main, release/pages를 수정하지 않았다.**

실제 화면에 연동할 때에는 현행 `InvestWorkflow` 캐시에서 만든 결과만 전달하고, 중복 API 조회 0건을 확인한다. UI는 '신규 후보 관찰'과 '보유종목 위험 점검'을 별도 탭/리스트로 구분하되, 이 검토 순서를 수익률 순위로 표기해서는 안 된다. 344·690·1440px 화면 및 기존 전체 GitHub 회귀 검사를 추가로 통과한 뒤에만 사용자에게 운영 승인을 요청한다.

**현재 상태:** 독립 엔진 및 결정론적 모의 테스트 구현 완료. 실데이터·기존 화면 연동/전체 CI·폴드6 실기기 검증은 별도.
