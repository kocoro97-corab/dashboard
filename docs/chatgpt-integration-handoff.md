# MY INVEST V2 — ChatGPT 인계서 및 Codex 통합 경계

기준: 사용자 2026-11-16 통합 지시서. ChatGPT 화면·기본 로직 커밋
`aa8d399e0f2f111e79da4e0c0ef922dd2f77a128`까지 보존한다.
Codex는 새 UI/분석 로직을 중복 개발하지 않고 실행·중계·게시·CI를 담당한다.
아래 A/C 과제는 사용자가 ChatGPT에 전달한다. 자동 메시지 전송은 하지 않는다.
실제 인증·쓰기 미실행 항목을 합성 테스트 PASS로 대체하지 않는다.

## A-01 / 우선순위 1 — 계좌관리 종합 시각화

- **대상 파일:** `js/page-accounts.js`, 필요시 새 공개 UI 파일 및 `css/dashboard-shell.css`.
- **현재 문제:** 표 기반 6개 하위 페이지·집계는 있으나 계좌 구성 도넛, 손익 비교,
  종목 기여도/집중도 시각화는 아직 없다. 기존 총평가액은 현금·예수금을 포함한
  총순자산이 아니라 조회된 보유종목 평가액이다.
- **기존 의존성:** `docs/modular-dashboard.md`, `js/app-context.js`,
  `js/account-overview.js`, `js/work-portfolio.js`, 원본 계좌 DOM 및 외부계좌 UI.
- **수정 요청:** KPI·계좌 구성·국내외 비중·계좌/종목 손익·집중도·상세표를 제공하되
  기존 메뉴 순서와 편집·저장·OCR 팝업을 보존한다. 기존 표를 삭제하지 않는다.
  새 화면에 가상 자산을 채우거나 계산 엔진을 다시 작성하지 않는다.
- **입력/출력:** `context.snapshot()`을 읽어 DOM만 출력한다.
  `result.summary={valueKrw,costKrw,profitKrw,returnPct}`,
  `result.accounts/byCurrency/exposures=[{key,valueKrw,costKrw,profitKrw,returnPct,weight}]`,
  `result.risk={concentrated,unknownExposure,incomplete}`, `byMarket`, `knownSubtotal`,
  `complete`, `status`, `draft`, `nhLoaded`, `externalLoaded`, `testRows`를 활용한다.
  `details[i]`와 `result.rows[i]`가 대응한다.
  상세에는 `accountKey,broker,accountLabel,accountType,code,market,currency,quantity,
  avgPrice,currentPrice,source,observedAt,receivedAt,storedAt`가 있다.
  `combined`는 검증된 식별자·시장·통화 기준으로만 통합한 종목 배열이다.
  모두 읽기 전용으로 취급한다. 토큰을 props/로그에 넣지 않는다.
- **완료 기준:** 부분합계·미조회·누락가격·임시목록을 명시하고 null을 0으로 바꾸지
  않는다. 원화인 NH 평가금액을 다시 환산하지 않는다. 개별 평단은 유지한다.
  관측시각과 수신시각을 구분하고 없는 FX 기준시각은 미확인으로 표시한다.
- **예상 검증:** 여러 계좌/통화, 일부 실패·누락, 빈 계좌, 합성자료 제외,
  집중도 분모, 344/690/1440 px, 라우트 이동·로그아웃 후 차트 정리.
- **인계 이유:** 사용자 지정 A형 화면·차트 표현 과제. Codex는 반환 코드의
  실제 렌더·계좌 연결·성능을 검증한다.

## A-02 / 우선순위 2 — 여섯 화면 디자인 통일

- **대상 파일:** `page-{market,sectors,stocks,strategy,news,accounts}.js`,
  공통 `css/dashboard-shell.css`, 필요시 `page-adapter.js`의 공개 계약.
- **문제:** 화면별 인라인 디자인과 입력/팝업 동작이 다르고 계좌 표와 카드 밀도도 다르다.
- **의존성:** `DashboardPages.register`, page `mount/refresh/unmount/getStatus`,
  `DashboardShell.connect`, `context.once/subscribe` 계약 및 기존 ID 기반 DOM.
- **수정 요청:** 공통 간격·표·카드·오류·미조회·조회시각·반응형·키보드 규칙을 정리한다.
  인증·중계·GAS·계좌 저장 파일은 수정하지 않는다.
- **입력/출력:** 기존 context 및 선택 이벤트를 소비해 화면만 갱신한다.
  종목 선택은 `MYInvestStockSelection.open(symbol,{name,theme,mode})`,
  전략 선택은 `myinvest_strategy_selection_v2` 세션 자료를 재사용한다.
- **완료 기준:** 메뉴/기능 링크 유지, 가로 화면 넘침 없음, 팝업 초점 이동·trap·복귀,
  Escape 닫기, 화면 이동/로그아웃 시 이벤트·차트·타이머 해제.
- **검증:** PC·Fold6 접힘/펼침, 텍스트 확대, 긴 이름/빈 결과, 키보드만 조작.
- **인계 이유:** A형 UI·UX. Codex가 실제 브라우저 캡처와 회귀를 수행한다.

## C-01 / 우선순위 0 — 실행으로 재현한 종목 응답 식별자 결함

- **대상:** `js/page-stocks.js`의 `analyze`, `holdingsFor`, `renderHolding`.
- **문제/근거:** 요청은 `GOOG`, 합성 응답 `meta.symbol='WRONG'`인데
  `GOOG · 기술적 분석`이 완료된다. `tests/browser_work_handoff.py`가
  `STOCK_RESPONSE_SYMBOL_NOT_VALIDATED`로 재현한다. 실제 금융값은 쓰지 않았다.
- **의존성/입출력:** 기존 `getJSON`의 Yahoo chart result `meta.symbol,currency,
  exchangeName`과 `timestamp/indicators.quote`. 국내 `.KS/.KQ`는 검증된 상장
  마스터 시장을 사용하고 응답 종목·시장·통화 일치를 확인한 봉만 분석에 전달한다.
  거래소 식별자가 없는 해외 보유종목은 추정 매칭하지 않는다.
- **필요 수정/완료 기준:** 불일치·미확인 응답을 명확한 분석 불가로 표시하고 이전
  결과를 지운다. 차트 통화와 계좌 통화가 다르면 수익률 비교를 만들지 않는다.
- **검증:** 정상 국내/해외, 다른 심볼·거래소·통화, 누락 메타, 오래된/미래 봉,
  연속 검색 응답 역전, 계좌 평단 유지.
- **인계 이유:** C형 데이터 검증·기본 분석 로직은 ChatGPT가 보완하고 Codex가
  실제 중계와 브라우저에서 재검증한다. UI 전체를 재작성하지 않는다.

## C-02 / 우선순위 1 — 섹터 보유종목 연결

- **대상:** `js/page-sectors.js`의 `holdings`, `mount/refresh/unmount`.
- **문제:** 보유종목을 이전 `H` 배열만 읽는다. 격리 개발 계좌에서
  `NH_ACCOUNTS/EXT_ASSETS`에 확인된 `035720`이 있어도 보유로 표시되지 않는다.
  브라우저 결과: `SECTOR_HOLDINGS_USES_LEGACY_H_ONLY`.
- **의존성/입출력:** A-01의 `context.snapshot()`; `details[i]`와 계산 행의
  검증 identity·market·currency를 확인해 보유종목 집합을 만든다.
- **수정/완료 기준:** 확인된 계좌 자료만 읽고 미조회와 미보유를 구분한다.
  draft/미확인 식별자 제외, 관심종목과 구분, context 갱신을 구독하고 해제한다.
- **검증:** NH/외부계좌, 같은 종목 여러 계좌, 세션 초기화, 미조회, 관심 목록만 존재.
- **인계 이유:** C형 화면 간 데이터 연결·기본 집계. Codex는 원본 계좌에 쓰지 않고
  브라우저에서 연결을 검증한다.

## C-03 / 우선순위 2 — 캘린더 UI·정책을 서버 계약과 맞추기

- **대상:** `js/page-news.js`, `js/invest-calendar-policy.js`,
  `docs/invest-calendar-sync-design.md`.
- **문제:** 일정은 브라우저 수동 메모이며 정책 모듈은 아직 화면에 연결되지 않았다.
  Escape로 닫히지 않음(`CALENDAR_ESCAPE_AND_FOCUS_NOT_IMPLEMENTED`).
  서버 endpoint·Calendar 권한·감사로그 UI는 미구현이다.
- **수정:** A-02 팝업 동작, 계정별 캐시 범위·로그아웃 정책, 승인 대기·명시적 거부/
  삭제·감사 표시와 API DTO를 확정한다. GET endpoint 표기를 기존 중계의
  인증된 POST action 계약과 조정한다. 브라우저 결정을 서버 권한으로 취급하지 않는다.
- **입력/출력:** event key/publisher/type/symbol/date와 UTC+IANA 시간,
  provenance·revision·idempotency_key. `state/decision/sync/audit`의 요청/응답,
  페이지 크기, 오류코드, 단일 승인과 가족 규칙의 차이를 명문화한다.
- **완료/검증:** 거부/삭제 우선, 재등록 금지, 별도 규칙 승인, 중복·날짜 변경·
  재시도·타 사용자·동시성·타임존. 실제 Calendar 쓰기 승인을 UI가 대체하지 않는다.
- **인계 이유:** A/C형 UI·기본 정책·API 계약 확정은 ChatGPT 소유.
  Codex는 확정된 계약으로 기존 격리 GAS/Sheets 서버 강제·동기화를 구현한다.
  전용 캘린더 ID/소유자 권한/테스트 이벤트 별도 승인 전 외부 쓰기는 수행하지 않는다.

## Codex 독립 수행 및 남은 환경 조건

- 최신 소스/기존 PR/CI 확인, 공개 자산 빌드·개발 Pages 반영, PC/모바일 실행 검증.
- 실제 중계 정책으로 정상 분석·실패 표시·메뉴 이동·계좌 평단·수동 일정·로그아웃 검사.
- 시장 차트가 사용하는 `range=3mo/5y`만 기존 Yahoo GET 허용집합에 추가.
  origin/code/session/리다이렉트/주문 차단은 유지한다.
- 테스트 GAS owner Cloud Shell의 비공개 계획 및 Google 인증은 현재 실행환경에 없다.
  실제 계좌/GAS/Sheets 저장 확인은 NOT_RUN이며 과거 NH PASS와 구분한다.
- Calendar OAuth scope와 서버 handler가 현 소스에 없고 전용 캘린더 ID도 확인되지 않았다.
  새 Google 환경·캘린더·Sheet 탭을 임의 생성하지 않는다.
- Drive는 기존 합의대로 마지막 단계. 운영 코드/자료/브랜치·실제 주문은 변경하지 않는다.

ChatGPT는 완료 후 변경 파일, 기존 브랜치 커밋, 실행한 검사와 미실행 검사를 반환한다.
Codex는 해당 차이만 통합·테스트·개발 게시하고 정상 모듈을 반복 재검증하지 않는다.

## 시장 정상화 추가 인계 (2026-11-16)

5964def1/f0e1172 검증 결과와 C-M01~C-M05 색상·분석 과제는
[시장 기능 점검 보고서](reviews/market-normalization-20261116.md)에 정리했다.
지표 카드3색은 PASS이나 테마·분석 수익률·계좌 손익 배경은 별도 보완이 필요하다.
