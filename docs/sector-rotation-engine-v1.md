# MY INVEST V2 — 산업·테마 상대강도 및 로테이션 엔진 V1

## 작업 현황 (2026-11-23)

승인된 산업·섹터·테마 개발계획에 따라 **기존 화면/연동 파일을 덮어쓰지 않고** 순수 분석 엔진·기존 데이터 변환 어댑터·테스트를 개발 브랜치에 추가했다.

- `js/sector-rotation-engine.js`: 검증된 일봉의 1/5/20/60 **거래일** 수익률, 시장 대비 상대수익률(퍼센트포인트), 5/20일 단기·중기 비교, 상대강도 순위, 확인 가능한 표본 상승비율·거래대금, 표본 내 후보 순위. 데이터 없으면 `insufficient`/`unavailable`.
- `js/sector-rotation-adapter.js`: 기존 `js/page-sectors.js`가 이미 읽어 `SERIES_CACHE`에 보관하는 검증된 시계열 구조를 엔진의 입력 DTO로 변환한다. **추가 API 호출 없음.** 원천 거래소 기준일(`dates`) 검증 자료가 없으면 보수적으로 실패한다.
- `tests/sector-rotation-engine.test.cjs`, `tests/sector-rotation-adapter.test.cjs`: 미국 ETF 표본·국내 산업, 거래일 정렬, 금액 단위, 시간·종목 식별·실패 자료 검증.
- `.github/workflows/sector-rotation.yml`: Node 22 구문·단위 테스트 자동 수행.

## 데이터/근거 계약

`engine.assess({market,benchmark,candidates,nowDay})`

`market`: `KR` 또는 `US`.

`benchmark`: `{market:'US',symbol:'SPY',verified:true,source:'...',bars:[{date:'2026-11-20',close:...},...]}` 또는 한국 `^KS11`. 기준지수 정체성이 검증되어야 한다. `nowDay`를 넘기면 해당 날짜보다 지수 기준일이 미래이거나 **10일 초과 오래된 자료를 거부**한다. 이는 휴일 전후를 포괄하는 보수적인 경고 기준이지 공식 거래소 휴장상태 인식은 아니다.

`candidates`: 배열 (최대 150개), 각 항목은
```js
{
 id:'XLK',name:'미국 정보기술 ETF 표본',
 market:'US',type:'sector_etf_proxy',currency:'USD',
 source:'원천 공급자 / 실체 확인',verified:true,
 bars:[{date:'YYYY-MM-DD',close:100,volume:1000},...],
 members:[{symbol:'MSFT',name:'...',changePct:1.2,turnover:1000,sourceVerified:true,source:'...'},...],
 membersAsOf:'YYYY-MM-DD', // 기준지수 마지막 검증 거래일과 같아야 함
 universeCount: /* 실제 구성 종목 총수 확인된 경우에만 숫자 */,
 turnoverCurrency:'USD' // 통화/원천 단위 실제 확인한 경우에만
}
```

주요 투자 기간의 n일 변화는 **거래일 지수 기준일로 n+1개의 실제 관측치**가 모두 일치할 때만 계산한다. 한국 지수는 한국 거래일, 미국 ETF는 미국 거래일을 적용한다. 두 시장의 서로 다른 공휴일/시차를 섞어 상대강도를 산출하지 않는다. 등락률 %와 상대강도는 `relativePp`(퍼센트포인트)로 구분한다.

산업·테마 상대강도는 비교하는 원천이 ETF proxy인 경우 **실제 전체 산업 수익률로 표기 금지**. 결과에 `isProxy:true`, `type:'sector_etf_proxy'`, `scope:제공된 후보만 순위`가 포함된다. 산업 내 상승종목 비율도 수신된 구성종목 표본에 대한 값으로만 표시한다. 확인된 전체 구성종목 수와 실제 표본이 일치하며 동일 거래일 시세를 모두 확인했을 때만 `fullUniverseVerified:true`.

`turnover`는 **원천 통화가 검증된 구성종목 거래대금 합계**이지 기관·외국인 순매수나 산업 자금 유입이 아니다. `turnoverCurrency`나 `membersAsOf`가 확인되지 않으면 거래대금·상승종목·주도종목 순위를 `unavailable` 처리한다.

`memberRank.leaders`/`laggards`는 등락률·거래대금·동일 거래일·원천 확인 조건을 충족한 **후보 표본 순위**다. 홍인기 단타 또는 2~3주 스윙의 확정 매수 신호로 사용하거나 시장 전체 1위라고 주장하지 않는다.

## 기존 데이터 캐시 재사용 안내

현재 `js/page-sectors.js`의 `series(ctx,symbol)` 함수는 자체 `SERIES_CACHE`를 사용하고 다음과 같은 검증된 데이터를 돌려준다.

```js
{
  bars:[100.0,101.0,...],
  times:[unixSeconds,...],
  volume:[100000,...],
  currency:'USD',exchange:'NMS',instrumentType:'ETF'
}
```

**현재 `series`는 거래소 기준 일자 배열 `dates`를 노출하지 않는다.** 시간대를 고려하지 않은 `new Date(t*1000).toISOString().slice(0,10)`은 거래소 장 날짜를 잘못 판단할 수 있으므로 추정 변환 금지. 원천 공급자의 공식 날짜 또는 정확한 거래소 세션 메타데이터를 검증한 뒤 `MYInvestSectorSeriesAdapter.adapt(existingSeries,{symbol,market,dates,source,instrumentType})`를 호출한다. 이 요구는 화면 연동 시 확인할 통합 관문이다.

`turnover`도 기존 `volume`만으로 실제 거래대금으로 치환하지 않는다. 원천 turnover/실제 약정대금이 같은 통화로 확인된 경우만 입력하고, 그렇지 않으면 `unavailable` 유지.

## 로테이션 해석

1. 5일·20일 상대수익률이 모두 양수: '시장 대비 지속 우위'.
2. 5일 상대수익률은 양수/20일은 0 이하: '단기 상대강도 개선'.
3. 5일은 0 이하/20일은 양수: '단기 상대강도 약화'.
4. 둘 다 0 이하: '시장 대비 지속 열위'.
5. 필요한 동시 거래일 자료가 부족: 판단 보류.

로테이션 순위는 **입력 후보 내 5일 상대수익률 내림차순**이며, 투자 자금 흐름·기관 수급·주도주 확정을 뜻하지 않는다.

## 검사와 Codex 연동 경계

```sh
node --check js/sector-rotation-engine.js
node --check js/sector-rotation-adapter.js
node tests/sector-rotation-engine.test.cjs
node tests/sector-rotation-adapter.test.cjs
```

기존 Codex 캘린더 통합 작업과의 충돌 회피를 위해 이번 단계는 `js/page-sectors.js`, `index.html`, `main`, `release/pages`, 운영 GAS/Sheets/Properties를 **변경하지 않았다**.

후속 통합 때에만 `index.html`에 한 번 로드하고 `#/sectors`의 기존 `series()`/캐시를 어댑터로 넘긴다. 344/690/1440px 화면 검증, 일봉 원천 거래일/통화/심볼 검증, 누락 종목 부분 커버리지, API 요청량 증가 0회, 전체 GitHub CI와 보유 계좌 회귀 테스트를 요구한다. 실 데이터 연동·브라우저/실기기 검증 전에는 개발 완료가 아니라 **독립 엔진 구현 및 모의 검증 완료**로 보고한다.
