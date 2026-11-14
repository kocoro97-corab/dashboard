# MY INVEST V2 신규 모듈 인계

저장소 `kocoro97-corab/dashboard`, 브랜치 `feat/nh-integration-v2`. 아래 순서대로 통합한다. 각 모듈은 classic script에서 고유 전역 API를 제공하며 Node에서는 CommonJS로 불러온다. 서드파티 패키지 설치가 필요 없다.

| 순서 | 모듈 | 상태 | 소스 | 테스트 | 통과 | 커밋 SHA |
|---|---|---|---|---|---:|---|
| 1 | 맞춤 뉴스·테마 | READY_FOR_INTEGRATION | `js/work-personal-news.js` | `tests/work-personal-news.test.cjs` | 3 | `5165a930fb35d3895f46bb5e3ff4bda4db16f27a` |
| 2 | 시장별 개인화 | READY_FOR_INTEGRATION | `js/work-market-settings.js` | `tests/work-market-settings.test.cjs` | 3 | `84af7142a9404036f499323af519295041a89b6e` |
| 3 | 데이터 품질 | READY_FOR_INTEGRATION | `js/work-data-quality.js` | `tests/work-data-quality.test.cjs` | 3 | `8be528da1e259f079c4901a4ec8c779ed8b96735` |
| 4 | 단타·스윙 전략 | READY_FOR_INTEGRATION | `js/work-trading-strategy.js` | `tests/work-trading-strategy.test.cjs` | 3 | `a5ac099cd57cb215b8b3f6e3fbb82644ef3a568a` |
| 5 | 포트폴리오 | READY_FOR_INTEGRATION | `js/work-portfolio.js` | `tests/work-portfolio.test.cjs` | 3 | `3d52839ce67846b147b9da80684cfc70894ec262` |
| 6 | AI 분석 | READY_FOR_INTEGRATION | `js/work-ai-analysis.js` | `tests/work-ai-analysis.test.cjs` | 3 | `ec4caddaaae940c6c3451448f0021966057af9ed` |

Node v24.22.1에서 위 합성 단위 테스트 18개 통과. 개별 실행 명령은 `node --test tests/work-<이름>.test.cjs`이다. PowerShell에서 전체 신규 파일만 실행하려면 `node --test (Get-ChildItem tests/work-*.test.cjs | ForEach-Object FullName)`을 사용한다.

## 1. 맞춤 뉴스와 테마

- `WorkPersonalNews.buildQueries(holdings, watchlist)`는 `{market:'KR'|'US', symbol, name}` 배열을 받아 최대 20개의 `{key, market, query}`를 만든다. 계좌키·수량·평단가를 검색어에 넣지 않는다.
- `readExisting(marketData, {topic, provenance})`에 기존 `MarketDataV2.create({readText: url => getTxt(url)})` 인스턴스를 주입한다. 출처·게시 시각이 있는 기존 `{t,l,s,d:Date}` 기사에 `live|synthetic` 태그를 붙인다.
- `classify({articles,holdings,watchlist,themes})`는 `{news,themes}`를 반환한다. 뉴스에 관련 종목 키·점수, 테마, 출처, epoch ms 게시 시각을 기록한다. 기본 국내·미국 키워드와 사용자 지정 `{market,id,terms[]}`를 지원한다. URL 및 제목/출처 중복은 데이터 종류별로 처리한다. 뉴스 제목과 출처는 텍스트로 렌더링한다.
- 연결 위치는 `js/market.js`의 `loadNews` 및 `js/themes.js`의 테마 표시 경계다. 먼저 고정 피드의 로컬 분류를 연결한다. 기존 공개 중계 `relay/market_routes.py`는 고정 검색어 두 개만 허용한다. 동적 검색은 별도의 제한된 인증 경로가 필요하다. 기존 임의 URL 제한을 유지하고 보유종목 검색어가 외부 제공자에게 공개되는 동작을 통합 시 검토한다.

## 2. 시장별 개인화

- `WorkMarketSettings.normalize(settings,defaults)` 및 `edit(settings,market,{type,id,card,to},defaults)`는 `invest_cfg_v4`와 동일한 `{KR:[],US:[]}` 구조를 사용한다. `edit`는 `add|remove|move`를 지원한다. 배열 순서가 우선순위이며 `vis`, `tv`, `inv`, `fut`, `y`, `t`, `m`을 보존한다.
- `layout(settings,{defaults,now,calendar})`는 07:00~20:59 서울시각 KR 우선, 그 외 US 우선의 `{primary,order,cards,visibleCards,tradingDays}`를 반환한다. 달력은 시장별 현지 `YYYY-MM-DD`를 `open|closed`에 매핑한다. 달력이 없으면 주말만 휴장 처리하고 평일을 미확인으로 둔다. 장중 개장 여부와 표시 우선순위는 독립적이다.
- `js/data.js`의 `DEF`를 기본값으로 전달하고, `js/market.js`의 `sess/renderCards/swTab/mv/addItem/saveSettings` 경계에 연결한다. 기존 저장과 HTML 이스케이프 규칙을 유지한다. 공휴일·조기폐장 데이터는 제공되지 않는다.

## 3. 데이터 품질

- `WorkDataQuality.inspect(quote,policy)`에 `{p,prev,changePct,source,currency,unit,observedAt,receivedAt,delivery,apiError}`를 전달한다. 시간은 epoch ms, `changePct`는 퍼센트 값이다. `unit`은 `price|indexPoints|percent|fxRate`다. 정책에서 예상 단위·통화·출처, 변동 허용폭 및 최대 경과시간을 지정한다.
- 결과 `{p,prev,changePct,status,issues,source,currency,unit,observedAt,receivedAt,ageMs,usable}`를 반환한다. `status`는 `realtime|delayed|stale|unconfirmed`다. 오래되거나 이상이 있는 수치도 확인용으로 남을 수 있으므로 표시와 후속 분석에서 `usable`을 확인한다.
- `js/market.js`의 `Q/SRC/QT`와 `renderCards` 사이 또는 `js/market-data-v2.js` 호출 결과 경계에서 연결한다. 기존 `QT`는 수신 시각이며 공급자의 관측 시각은 별도로 전달한다. 공급자 시각 또는 지연 여부가 없는 데이터는 미확인으로 표시한다. 기본 양수 검사는 음수 허용 지표에 별도 정책을 적용한다.

## 4. 단타·스윙 전략

- `WorkTradingStrategy.analyze({mode,interval,bars,capital,riskPct,maxAllocationPct,lotSize})`는 오름차순 봉 `{t,o,h,l,c,volume,turnover}`를 입력받는다. 자본과 가격·거래대금의 통화를 일치시킨다. 단타는 분봉/시간봉 21개 이상, 스윙은 일봉 31개 이상을 사용한다. `riskPct`와 `maxAllocationPct`는 퍼센트 값이다.
- 이동평균, 5봉 모멘텀, ATR(14), 이전 범위의 지지·저항, 상대 거래량·거래대금과 돌파 근거를 계산한다. 진입·손절·목표가 후보 및 위험과 배정 한도를 충족하는 수량을 반환한다. 목표가는 위험 배수로 산출한 후보로 체결·수익을 예측하지 않는다. 수수료, 슬리피지, 호가단위, 공매도, 백테스트는 모델링하지 않는다.
- `js/chart.js`의 `nvChart/loadQ` 공급자 파싱 경계에서 거래량·거래대금·봉 간격을 보존한 분석용 배열을 만든다. 기존 개발 중계의 Yahoo 허용 간격은 일/주/월봉이다. 단타는 승인된 장중 봉 수집 경로가 필요하다. 데이터 품질, 완료 봉 및 거래 시간은 호출 전에 확인한다. 거래량·거래대금이 없으면 신호가 `watch`로 유지된다. 화면은 `js/market.js`의 시나리오 주변에 참고 정보로 연결한다.

## 5. 포트폴리오

- `WorkPortfolio.analyze({holdings,fxToKrw,partial,concentrationThreshold})`는 `{market,accountKey,code,instrumentId,country,assetClass,quantity,currentPrice,avgPrice,currency,evalAmount,profit}` 배열을 입력받는다. `accountKey`는 UI 전용 가명, 해외 `instrumentId`는 검증된 거래소 포함 식별자, 환율은 외화 한 단위당 원화다.
- `summary,accounts,byAssetClass,byCountry,byCurrency,exposures,risk` 및 행별 누락 사유를 반환한다. 국내·해외 NH의 `evalAmount/profit`는 이미 원화다. 원화 평가액이 없을 때만 수량·가격·환율을 사용한다. 현재 환율로 해외 원가를 재구성하지 않는다. 불완전 조회 시 비중을 숨기고, 검증되지 않은 종목은 미확인으로 묶는다.
- `js/market.js`의 `loadNHAccounts/mergeNhAccountResultsV2/renderNHAccounts` 주변에서 성공 응답을 읽기 전용으로 매핑한다. `gas/NhAccountsV2.gs`의 국내·해외 `partial` 및 계좌별 오류를 전달한다. `js/external_accounts.js`에서 가져올 경우 검토 완료 행만 사용한다. 현금·배당·입출금·기간 수익률은 범위 밖이며 결과는 보유종목 기준 평가손익이다.

## 6. AI 투자 분석

- `WorkAIAnalysis.build(input)`은 `{scope,asOf,provenance,evidence,maxInputTokens,maxOutputTokens,maxCost,pricing}`를 검증한다. `scope`는 `market|symbol|portfolio`이며 증거는 허용된 수치 지표와 `observedAt/source/provenance`를 가진다. 가격은 토큰 백만 개당 `inputPerMillion/outputPerMillion/currency`로 전달한다.
- `analyze(input,{provider,estimateInputTokens})`는 주입 어댑터를 호출한다. 어댑터는 `{messages,maxOutputTokens}`를 받아 `{analysis:{summary,findings:[{text,risk,evidenceIds}]},usage:{inputTokens,outputTokens}}`을 반환한다. 결과에 근거 시각, 출처, 인용 증거와 사용량·추정 비용을 붙인다. 사전 예상 및 응답 사용량을 검증한다. 실제 과금 상한과 누적 예산은 공급자/서버 쪽에서 강제해야 한다.
- 통합 후보는 `js/market.js`의 `generateScenario` 주변 사용자 실행 버튼이다. 먼저 합성 어댑터만 연결한다. 실제 호출 승인 이후 서버 측 자격증명·시간제한·예산 강제를 별도 연결한다. 자유 입력, 원본 뉴스, 원본 계좌 응답, 토큰, 계좌 식별자를 요청으로 전달하지 않고 AI 응답은 텍스트로 렌더링한다.

## 통합 공통 사항

`index.html`과 `tools/build_dev_pages.py`에서 도입하는 모듈만 기존 스크립트 순서와 개발 자산 목록에 추가한다. 기존 인증과 릴레이를 재사용하고 조회 중 세션 전환·만료 시 오래된 화면 업데이트를 폐기한다. 위 순서는 뉴스·화면 표시·품질부터 연결한 뒤 신호와 계좌 분석 및 AI로 진행하기 위한 것이다.

이 작업은 개발 브랜치에 독립 소스와 단위 테스트를 추가했다. UI 및 개발 자산 연결, 브라우저·GAS·외부 데이터 검증, 개발 페이지 반영은 후속 작업이다. 실제 계좌·외부 API 호출이나 운영 배포는 수행하지 않았다.
