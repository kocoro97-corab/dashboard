# MY INVEST V2 — 시장/산업/종목 투자전략 변화 추적 V1

## 변경 범위

**Codex 작업과 충돌하지 않도록 신규 파일만 추가:** `js/analysis-change-tracker.js`, `js/analysis-change-snapshot.js`, `tests/analysis-change-tracker.test.cjs`, `tests/analysis-change-snapshot.test.cjs`, `.github/workflows/analysis-change-tracker.yml`.

기존 `index.html`, `js/page-*.js`, 운영 GAS/Sheets/Properties, NH 계좌, GitHub `main`/`release/pages`는 변경하지 않는다.

## 구현 동작

이전 확정 거래일과 현재 확정 거래일의 **검증된 분석 결과**를 비교해 변화가 발생한 근거를 설명한다. 단순히 후보 점수나 주가 예측을 생성하지 않는다.

1. 시장 방향 `up/down/mixed` 변화; VIX 기반 `high/elevated/reference-low/unknown` 위험 구간 변화.
2. **동일 산업**만 비교하는 5일 상대수익률 퍼센트포인트 변화. 차이 `>= 0.5%p`일 때 관측 변경 표시. 비교 산업이 다르면 직접 비교 금지.
3. 종목별 신규 위험 차단 `market-high-risk` / `event-near`, 근거 보완 필요, 신규 관측 종목, 후보 목록에서 더 이상 관측되지 않은 종목, 기술 관찰조건 변화.
4. 이전 위험이 해소된 것으로 보일 때에는 **현재 근거 범위가 완전할 때만** '위험 해소 여부 재확인'을 표시한다. 일부 공식 자료 미연결이라면 경고는 해제되지 않는다.
5. 신규 후보와 보유종목을 독립적으로 비교한다. 두 목록 사이에 예상수익률 점수나 매수 우선순위를 만들지 않는다.
6. 이전/현재 분석 국가·단타/스윙 모드·거래일이 맞지 않거나 중복 종목이 있으면 분석 중단. 사용자 계좌정보·평단·수량·토큰은 저장/출력하지 않는다.

## 재사용 데이터와 입력

`MYInvestChangeSnapshotAdapter.make({audit,queue,regime,sector,day})`:

- `audit`는 `MYInvestEvidenceAudit.audit()`의 결과.
- `queue`는 `MYInvestOpportunityQueue.collect()`의 결과.
- `regime`은 `MYInvestMarketRegime.assess()`, `sector`는 `MYInvestSectorRotation.assess().candidates[*]`의 실제 검증된 항목.
- `day`는 실제 **거래소 검증 날짜**. `regime`의 두 핵심 지수 관측 기준일과 `sector.asOf`가 같은 경우에만 `signals`을 생성.
- 기존 데이터가 없으면 스냅샷 비교에서 해당 사실을 명시. **본 모듈은 데이터 조회를 직접 수행하지 않는다.**

```js
const past=MYInvestChangeSnapshotAdapter.make({audit:oldAudit,queue:oldQueue,
  regime:oldMarket,sector:oldSector,day:oldVerifiedMarketDay});
const latest=MYInvestChangeSnapshotAdapter.make({audit:newAudit,queue:newQueue,
  regime:newMarket,sector:newSector,day:newVerifiedMarketDay});
if(past.status==='ready'&&latest.status==='ready'){
 const change=MYInvestAnalysisChangeTracker.compare({
  previous:past.snapshot,current:latest.snapshot,today:verifiedToday
 });
 // change.changes, change.sourceChanges, change.recheck 를 UI에서 읽기 전용 표시.
}
```

**데이터 보존 한계:** 이 모듈 자체에는 저장 기능이 없다. 전일 스냅샷은 기존 사용자가 승인한 로컬 보호 저장소/캐시로 관리할 수 있으나, 누가 읽고 쓸 수 있는지 보안 검증하기 전에는 계좌와 섞어 저장하거나 공개 Pages/Sheets에 기록하면 안 된다. 별도 저장 허가 없으면 세션 동안 확보한 두 분석 결과만 비교한다.

### 반환

`{schemaVersion,status,market,mode,previousDay,currentDay,evaluatedOn,sourceChanges,changes,recheck,coverage,warnings}`

- `status:'comparable'`: 이전/현재 모두 4개 공식 근거영역 `usable`로 검증됨.
- `status:'partial'`: 비교는 가능하지만 일부 근거가 부족함; 위험 감소·안전 판정에 사용 금지.
- `status:'unavailable'`: 거래일·시장·모드·스키마 불일치 또는 중복/손상 분석 자료.
- `changes[*].kind`: `risk-escalated`, `risk-appears-resolved`, `market-direction-changed`, `market-risk-changed`, `sector-relative-strength-changed`, `new-observation`, `no-longer-observed`, `review-lane-changed`, `evidence-need-changed`, `technical-observation-changed`.
- `recheck`: 확인할 순서의 **업무 목록**이지 주문·매매 지시가 아니다.

## 검증

```sh
node --check js/analysis-change-tracker.js
node --check js/analysis-change-snapshot.js
node tests/analysis-change-tracker.test.cjs
node tests/analysis-change-snapshot.test.cjs
```

GitHub 자동 테스트: `.github/workflows/analysis-change-tracker.yml`.

테스트는 최초 검증자료, 위험 신호 발생, 위험 해소 시 일부 출처 누락, 시장 방향과 위험도 변화, 산업 상대강도 변화, 동일 산업 확인, 종목 미관측 상태, 중복 후보 전부 제외, 사용자별 비공개 데이터 제거, 미래/오래된 거래일을 포함한다.

## 다음 통합 단계 조건

1. Codex 캘린더 최종 통합 작업과 병합 충돌이 없는 시점에 기존 홈/전략/뉴스 화면에 변화 근거 UI를 추가.
2. 원천 관측 거래일을 확인하지 못하거나 데이터 미갱신으로 단순 시점만 바뀐 경우 변경 추정 금지.
3. 이미 확보된 분석 캐시를 재사용하고 **추가 API 호출 0회** 검증. 새로운 데이터가 실제로 필요한 경우 기존 조회 모듈에서만 수집하고 출처 표기.
4. 사용자 계좌·Google 개인 일정이 공개 스냅샷에 전달되지 않는지 브라우저 및 로그에서 확인.
5. 344/690/1440px 화면, PC/폴드6, 전체 CI 및 기존 계좌/뉴스 기능 회귀 검증.
6. `main`, `release/pages`, 운영 GAS/Sheets/Properties 및 주문 기능은 별도 사용자 승인 전 변경 금지.

**상태:** 독립 엔진 + 결정론적 모의 단위 테스트 단계. 실제 시세/화면·실기기 통합은 미완료.
