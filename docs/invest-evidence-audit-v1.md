# MY INVEST V2 — 투자 분석 근거·최신성·수집 필요성 관리 V1

기준일 2026-11-23. **Codex 화면·캘린더 작업과 충돌 방지**를 위해 신규 독립 모듈·테스트·CI만 추가했다.

## 구현 파일

- `js/invest-evidence-audit.js` — 한국/미국 시장·산업·종목·공식 이벤트 근거 점검. 추가 API·NH·Google·계좌 호출 없이 이미 계산된 분석 결과를 읽는다.
- `tests/invest-evidence-audit.test.cjs` — 출처 누락·원천시각 오류·수신시각 지연·미래 거래일·오래된 일봉·일부 일정 미연결·공개 결과 개인정보 누락 검증.
- `.github/workflows/invest-evidence-audit.yml` — Node 22 구문·단위 테스트.

## 데이터 계약

```js
const audit=MYInvestEvidenceAudit.audit({
  mode:'swing',market:'US',nowDay:verifiedUsMarketDay,now:Date.now(),
  marketData:MYInvestMarketRegime.assess(/* already fetched quotes */),
  sectorData:verifiedSectorCandidate,
  stockData:MYInvestStockSetup.assess(/* already fetched OHLCV */),
  eventData:MYInvestIntegratedEventAdapter.eventsFromPublicContext(/* cached */),
  opportunity:MYInvestOpportunityQueue.summarize(/* verified strategy */,verifiedUsMarketDay)
});
```

- `marketData.evidence[].asOf`는 **원천 지수 관측 ISO 시각**; `receivedAt`은 **대시보드 수신 ISO 시각**. 둘을 혼동하면 안 된다. 30분 이상 수신 지연 자료는 `stale`로 표시하며, 미래 관측 또는 원천 관측이 수신보다 5분 이상 앞서면 `invalid`.
- `sectorData.asOf`·`stockData.asOf`는 **검증된 거래소 거래일**(YYYY-MM-DD), 수신시각과 별개. 현재 `nowDay`보다 미래거나 보수적 10달력일을 초과하면 거부. 휴장일과 장전/장후의 정확한 판정은 별도 시장 거래일 계층 담당.
- `eventData.coverageVerified`가 false면 **일부 일정 미연결**, `eventData.events`에 이미 확인된 고중요도 공지가 있더라도 '모든 위험 없음'으로 판단하지 않음.
- `opportunity`는 별도 승인된 `MYInvestOpportunityQueue.summarize()`의 **개인정보 제거된 결과**만 연결. 계좌 원본 레코드는 모듈에 전달하지 않는다.
- 미연결/오류 데이터는 점수로 대체하지 않는다. `canPresentAsVerified=false`와 `refreshPlan`에 판단 보류 근거와 다음 확인할 원천을 표시한다.

## 출력

```js
{
 schemaVersion:1,market:'US',mode:'swing',nowDay:'YYYY-MM-DD',symbol:'...',
 status:'ready'|'incomplete'|'invalid',
 canPresentAsVerified:false,
 evidence:[{component:'market'|'sector'|'stock'|'event',
            status:'usable'|'missing'|'stale'|'partial'|'invalid'|'failed',
            reasons:[...],basis:[...]}],
 refreshPlan:[{component,reason,next,allowAutoFetch:false}],
 queueStatus:{lane,reviewBlocked,requiresEvidence}|null,
 coverage:{total:4,usable:0,missing:['market',...]},
 note:'...'
}
```

`refreshPlan`은 **실제 API 실행 계획이 아닌 사용자/기존 조회 파이프라인의 점검 안내**다. 호출을 제어하거나 캐시를 강제 갱신하지 않는다. 필요한 데이터를 조회하지 말라는 의미가 아니며, 실제 원천 연결·갱신 여부는 각 개발 영역에서 별도 관리한다.

## 개발 영역·실데이터 검증 조건

Codex 작업 중인 `js/page-*.js`, `index.html`, GAS·Sheets·Properties, 운영 `main`, `release/pages`는 이번 작업에서 변경하지 않았다.

```sh
node --check js/invest-evidence-audit.js
node tests/invest-evidence-audit.test.cjs
```

**실제 데이터/화면 통합 후 확인할 항목:**

1. 실 원천에서 `observedAt`와 `receivedAt`가 명확히 따로 전달되는지 확인.
2. `marketData`가 지연 종가인지 실시간 호가인지 공급자 정책과 출처를 그대로 표시.
3. 시장/산업/종목이 같은 국가·시장·거래일인지 확인하고, 누락 시 판단 보류.
4. 공식 이벤트가 일부 미연결이면 주요 발표 위험 소거하지 말 것.
5. 기존 캐시 재사용을 확인하고 이 모듈로 추가 API 조회 **0건**.
6. 1440px/690px/344px 브라우저 및 폴드6, 자동 전체 CI, NH 조회 전용·실제 주문 0회.
7. 사용자 승인 없는 운영 배포·Google OAuth 비밀 설정 금지.

현재 상태는 **독립 코드와 모의 테스트 개발 완료**이며, 실제 시세 데이터·화면 통합/전체 회귀 테스트는 별도 인수 단계다.
