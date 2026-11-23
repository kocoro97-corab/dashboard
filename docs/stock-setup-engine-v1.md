# MY INVEST V2 — 단타·스윙 종목 분석 엔진 V1

**기준:** 2026-11-23 KST / `kocoro97-corab/dashboard` / `feat/nh-integration-v2`

## 구현 상태와 소유 경계

- `js/stock-setup-engine.js` — 독립·결정론적, 무조회·무주문 종목 분석. 상승/하락 추세, 5/20/60일 이동평균, 20봉 전고점 돌파, 거래량 20봉 평균 대비 확대, 스윙 20일선 근접 관측, ATR14/참조 지지선 위험, 실측 기준지수 대비 5/20일 상대성과.
- `js/stock-setup-adapter.js` — 기존 `js/page-stocks.js` `InvestWorkflow.ensure`가 조회·캐시한 OHLCV `{t,o,h,l,c,v}`를 안전하게 재사용. 원천 거래일 및 완료봉 여부를 확인하지 못한 경우 **분석 불가**.
- `tests/stock-setup-engine.test.cjs`, `tests/stock-setup-adapter.test.cjs`, `.github/workflows/stock-setup.yml` — Node 22 단위 검증과 CI 설정.
- **기존** `js/page-stocks.js`, `js/page-strategy.js`, `js/invest-workflow.js`, `js/page-market.js`, `js/page-sectors.js`, `index.html`, 계좌·GAS·Pages는 이번 작업에서 수정하지 않았다. Codex의 캘린더 최종 통합과 충돌 방지를 우선한다.

## 기존 데이터 재사용 입력

현행 종목 페이지는 Yahoo Finance 공식 응답 중 `result.meta.symbol`, 통화와 거래소를 검사하고 1년치 OHLCV를 `InvestWorkflow`로 노출한다. 그러나 **거래소 기준 거래일과 일봉 최종 확정 여부는 기존 `bars[].t`만으로 정확히 보장할 수 없다**. 새 어댑터는 독립 검증된 `dates`와 완료된 날짜 `closedDates`를 반드시 요구한다.

```js
// 데이터는 예시입니다. 실제 연동 전까지 화면에 표시하지 마십시오.
const existing=await InvestWorkflow.ensure({symbol:'SERV'}); // 현재 페이지가 실제로 사용 중인 조회/캐시
const adapted=MYInvestStockSetupAdapter.adapt(existing,{
  symbol:existing.symbol,market:'US',
  verifiedSource:true, // 원천 symbol/거래소/통화 등 검증한 호출자만 true
  dates:verifiedExchangeSessionDates, // raw bars와 같은 길이의 거래소 공식 거래일 배열
  closedDates:verifiedClosedSessions // 실제 마감된 일봉만
});
if(adapted.status==='ready'){
 const result=MYInvestStockSetup.assess({
  symbol:adapted.symbol,market:adapted.market,currency:adapted.currency,
  verified:adapted.verified,source:adapted.source,bars:adapted.bars,
  nowDay:verifiedExchangeToday,mode:'swing',
  benchmark:verifiedSameMarketBenchmark,
  regime:verifiedMarketRegime,sector:verifiedSectorRotation
 });
}
```

실제로 `InvestWorkflow.ensure`가 수신 중인 종목을 재조회하지 말 것. 필요 데이터가 캐시에 없을 때만 원천 정책/사용자 갱신 기준을 따르며, 백엔드 유료 데이터 호출이나 종목 재검색을 새 분석 엔진이 직접 수행하지 않는다.

## 필수 신원 확인과 데이터 품질

- KR 종목 6자리/원화/KRX 실체, 미국 종목 코드/달러/NYSE·NASDAQ 거래소를 확인한다.
- 신뢰할 수 없는 신원, 미래/중복/역순 거래일, OHLC 가격 모순, 음수 거래량, 미확정 장중봉은 거절한다.
- 거래일 누락은 실제 수익률을 추정하지 않는다. 기준지수와 비교할 때 동일 국가·통화·검증된 종가 기준일을 맞춘다. 기준지수는 KR: `^KS11`, `^KQ11`; US: `SPY`, `^GSPC`, `^IXIC`.
- 20봉 전고점은 **최근봉 이전 20개의 고가 중 최댓값**과 최신 확정봉 종가를 비교한다. 장중 순간 돌파가 확정봉 종가 돌파로 표시되지 않도록 한다.
- 거래량 20봉 평균은 **직전 20봉**으로 계산한다. 수신 거래량이 없거나 직전 평균이 0이면 거래량 확대를 판정하지 않는다.
- 20봉 이상이면 `MA20`, 60봉 이상이면 `MA60`, 15봉 이상이면 `ATR14`를 계산할 수 있다. 자료가 부족하면 null/unknown을 유지한다.
- 종가·전일 종가·지지선 비교로 위험 크기의 *참조 비율*을 보여주지만, 실제 손절가·주문단위·진입 확정·목표가격을 제시하지 않는다. 갭·슬리피지·세금·수수료를 포함하지 않는다.
- 시장 국면은 `MYInvestMarketRegime.assess`에서, 산업·테마 상대강도는 `MYInvestSectorRotation.assess`에서 **실제로 검증된 값만** 인계한다. 분석 시점/시장 불일치 시 `unknown` 반환.
- 실적 발표 위험·뉴스 원문·NYSE `$TICK`·호가·외국인 순매수 자료는 별도 검증 계약이 없으면 추정해서 합성하지 않는다.

## 단타·스윙 구별

### 단타 분석 (마감 확정 일봉 기반)
- 마지막 확정봉 종가가 직전 20봉 고점보다 높고 거래량이 직전 20봉 평균의 **1.5배 이상**인 경우, `breakout_volume` *관측 조건* 표시.
- 고점만 돌파했고 거래량이 부족하거나 미확인이라면 `breakout_unconfirmed_volume`로 표시. 이는 매수 지시가 아니다.
- **장중 실제 돌파/체결강도는 이 일봉 분석으로 확인할 수 없음**을 UI에 반드시 안내한다.

### 스윙 분석 (수일~2~3주 관점)
- 마지막 확정봉 종가가 직전 20봉 고점보다 높고 거래량 1.2배 이상이면 `breakout_swing` 표기.
- MA20이 MA60 위이며 종가가 MA20 위, 최신봉이 MA20 ±3.5% 범위에서 양봉을 형성한 경우 `pullback_ma20` *관측 조건*으로 표기한다.
- 추세/거래량 조건은 임의 추론이 아니며 설정된 간단한 규칙이다. 역사적 성공률·수익을 입증한 백테스트가 아니므로 확률·승률·강한 매수 추천 표현 금지.

## 반환 스키마

`MYInvestStockSetup.assess({...})` →

`{status,symbol,market,mode,asOf,setup,references,relative,marketContext,sectorContext,evidence,warnings,role}`

실제 화면에서는 `status`, `setup.candidates`, `setup.trend`, `setup.volumeRatio20`, `relative.period5/period20.relativePp`, `references.atrPct`, `references.riskToObservedSupportPct`, `evidence.asOf` 및 경고문을 분리 표기한다. 데이터 없으면 **판단 보류**다.

## 자동 테스트

```sh
node --check js/stock-setup-engine.js
node --check js/stock-setup-adapter.js
node tests/stock-setup-engine.test.cjs
node tests/stock-setup-adapter.test.cjs
```

검증 범위: 미국/한국 종목 및 거래소 식별, 20봉 돌파·거래량 확대·5/20/60일선, 기준지수 5/20일 상대수익률, 거래일 불일치, 결측/장중봉 거부, ATR 부족 처리, 해외 기준지수 오인용 방지, 기존 OHLCV 캐시 재사용, 주문 API 부재.

## 추후 통합 및 인수 관문

이번 단계는 *독립 엔진 + 모의 단위 검증*. **실제 시세와의 화면 연결은 아직 하지 않았다.**

Codex의 캘린더 화면 작업이 종료된 뒤 다음을 통합한다.

1. `index.html`에 신규 모듈을 기존 종목·전략 화면보다 먼저 1회 로드.
2. 현재 종목 조회 캐시의 시세/원천 시간·거래소 기준일·마감봉을 검증 후 변환. 기존 조회·캐시 흐름 중복 호출 0회.
3. `#/stocks`에서 단타/스윙 관측 조건과 근거·확정일·자료 누락 상태 표시.
4. `#/strategy`에서 **신규 후보 vs 보유종목**을 구분하고 계좌 자료는 사용자 측 메모리만 사용. 포트폴리오 정보가 공개 데이터 캐시에 전송되지 않아야 한다.
5. PC 1440px, Fold6 펼침 690px·접힘 344px 회귀와 실 NH 호출/주문 0건, 전체 CI PASS 후 배포 승인.
