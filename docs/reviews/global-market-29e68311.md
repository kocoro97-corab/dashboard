# 글로벌시장 29e68311 통합 검증 — 2026-11-17

전체 상태 PARTIAL. 기존 feat/nh-integration-v2 / PR #7 유지.
운영 GAS·Sheets·Calendar·계좌 저장자료·주문·AI 제공자 변경/호출 없음.
실제 데이터 공급자 직접 읽기와 캡처 재생, 실제 로그인한 상시 중계 통과는 별개다.

## 화면·기능

| 항목 | 결과 | 근거 |
|---|---|---|
| 지표 중복 제거 | PASS (합성 브라우저) | 상단 6개 카드만 표시. legacy 시장/$TICK/거시경제 영역은 닫힌 details 1개 안에 유지 |
| 기존 상세 펼치기 | PASS (합성) | 클릭 후 기존 marketSection/tickSection 표시. shell 회귀에서 펼친 뒤 거시경제 실제 시세 버튼도 클릭 |
| 라우트·새로고침·로그인/로그아웃 | PASS (합성) | details 기본 접힘, 설정 목록 복원, 세션 유지, 팝업/래퍼 제거 및 재로그인 확인 |
| 한국/미국 전환 | PASS (요청·표시) / FAIL (복귀 버튼 문구) | 변경된 선택 목록으로 수집. 다른 메뉴 복귀 시 문구 결함 G-UI01 |
| 지표 편집·순서 저장 | PASS (합성) | 금 선물을 실제 체크·▲ 이동·저장, 상단 순서와 새 시세 요청, 새로고침 보존 |
| 확대 차트 | PASS (합성 일/주/월/년, 실제 응답 재생 일봉) | 15개 공개 지표 일봉 canvas 표시. 데이터 없는 선물/$TICK은 차트 미연결 안내 |
| 시장 국면·관측 지표 | PASS (관측값 팝업) / NOT_IMPLEMENTED (판정 엔진) | 받은 값·등락률만 출력. 확정 국면/매매 신호 미생성 |
| 단타·스윙 대응 | PASS (체크리스트·이동) / NOT_IMPLEMENTED (자동 추천) | 두 탭, 관측지표 수, 섹터 및 매매계획 이동 확인 |
| 산업·테마·투자전략 이동 | PASS (합성) | 실제 버튼으로 이동/복귀 |
| PC1440/Fold690/344 | PASS (레이아웃) | 가로 넘침·스크립트 오류 없음. 실제 Fold6 기기 및 실제 인증은 NOT_RUN |

## 재현 후 수정한 연결 오류 3개

수정 전 1440px: 12개 기능 검사 중 9 PASS / 3 FAIL.

1. `page-market.js`의 지역·편집 목록과 `market.js`의 CFG 기반 수집 목록이 달랐다.
   미국장 전환 후 NQ=F, 새 금 선물 선택 후 GC=F 요청이 생기지 않았다.
2. `fillFutures()`는 KOSPI200을 FQ.k3에 저장하지만 새 카드가 읽는 Q.k3에는 없었다.
3. 화면 선택 목록 변경 시 기존 컨텍스트의 단일 market 캐시만으로는 누락 시세를 수집할 수 없었다.

최소 수정:
- `page-market.js`: 기존 ctx.market에 선택 목록 및 관측에 필요한 VIX/FX/TNX/SOX 전달.
  지역·순서 저장 후 기존 legacy refresh 호출만 연결. UI/추천/분석 계산 재작성 없음.
- `app-context.js`: 종목 집합별 캐시, 직렬 요청, 로그아웃 후 대기 작업 취소.
- `market.js`: 기존 수집기에 검증 형식의 추가 심볼 전달, 기존 FQ를 유지하며 Q.k3/SRC/QT 읽기 어댑터 추가.
  Yahoo 시세는 요청 심볼 일치 및 유한 양수 확인, 관측시각이 있으면 보존.
- 새 데이터 제공처·중계 권한·GAS/NH 권한을 추가하지 않았다. Worker 재배포는 이번 수정에 필요 없다.

## 지표별 데이터 및 차트

아래 PASS는 공급자 HTTP200/JSON, 심볼 일치 및 일봉 가용성, 실제 응답을 사용한
화면 재생이다. 사용자의 실제 로그인 세션에서 상시 Worker publicFetch 통과는 모두 NOT_RUN.
수신시각을 관측시각으로 대체하지 않고, 관측되지 않은 수치를 실시간으로 부르지 않는다.

| 지표 | 시세·일봉 원천 | 시세 | 확대 일봉 | 남은 항목 |
|---|---|---|---|---|
| KOSPI/KOSDAQ | 기존 Naver 우선, Yahoo ^KS11/^KQ11 fallback | PASS | PASS | 수집기와 표시 지표 선택 연동 수정 |
| S&P500/NASDAQ/DOW | 기존 Naver/Yahoo ^GSPC/^IXIC/^DJI | PASS | PASS | 실제 인증 중계 검증 |
| SOX/VIX | 기존 Naver/Yahoo ^SOX/^VIX | PASS | PASS | 지역과 관계없이 관측에 필요한 심볼 수집 |
| NASDAQ/S&P500/DOW 선물 | Yahoo NQ=F/ES=F/YM=F | PASS | PASS | 공급자 롤링 심볼. 특정 만기물/롤 조정방법 검증은 별도 |
| 미국10년/단기금리 | 기존 Naver/Yahoo ^TNX/^IRX | PASS | PASS | 금리값은 통화 평가액이 아님. UI 단위 명료화 G-UI03 |
| 원/달러 | 기존 Naver/Yahoo KRW=X | PASS | PASS | 실제 인증 중계 검증 |
| 금/WTI | Yahoo GC=F/CL=F | PASS | PASS | 현물 대신 공급자 선물 심볼임을 유지 |
| KOSPI200 선물 | 기존 Daum 고정 코드 KR4A016C0004 | PASS (기존 수신값 표시) | NOT_IMPLEMENTED | 직접 응답에 계약 식별자/만기 필드 없어 별도 확인 필요 |
| KOSDAQ150 선물 | k4, 기존 NH A06 후보; 개발 NH 선물 수집 비활성 | FAIL (미연결) | NOT_IMPLEMENTED | 실제 상품·거래소·만기 확인 및 승인된 조회 연결 필요. 추정 코드/현물로 대체 안 함 |
| NYSE $TICK | 개발 CSP/프로필에서 외부 TradingView 위젯 비활성, 구조화된 공급자 없음 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | 인증된 실제 TICK 공급자/권한 필요. 수동값과 실시간 feed를 구분 |

## ChatGPT 인계

G-UI01 (재현 FAIL):
- 파일: `js/page-market.js mount`, 선택자 `.miv-top .miv-controls button:first-child`.
- 재현: 미국장 전환 → 산업·테마 이동 → 글로벌시장 복귀.
- 실제: 미국장 카드가 유지되지만 버튼은 `한국장 표시 · 미국장 전환`.
- 원인: mount에서 region과 관계없이 문구를 한국장으로 초기화.
- 요청: 기존 region으로 초기 문구를 산출. 실제 시세 수집 로직은 재작성하지 말 것.
- 캡처: `/workspace/output/global-market-ui-label-review/344-region-label.png`.

G-UI02 (관측 표시 보완):
- `.miv-observation-row`에는 값/등락률만 있고 출처·관측/수신시각이 없음.
- 관측값 상세에 출처와 시각을 표시하고 없는 시각은 미확인으로 유지할 것.
- 캡처: `/workspace/output/global-market-review/344-observations.png`.

G-UI03 (표현 보완):
- 금리와 원자재 차트/카드의 단위 및 선물 심볼 성격을 명확히 표시할 것.
- 국면 판정·단타/스윙 자동 추천은 별도 미구현 과제이며 체크리스트 동작을 분석 완료로 표시하지 말 것.
- 이전 색상 인계 C-M01~C-M05는 본 커밋이 수정하지 않았으며 이전 보고서 참조.

## 관련 검증과 한계

- Node 관련48 PASS: 시장전송7, 컨텍스트3, 개발시장7, MarketDataV2 7, 시나리오4, 전송보안20.
- PC1440/Fold690/344 기능 클릭·레이아웃36 PASS.
- 실제 공개 응답 전용 재생, 개별18지표 및 레이아웃19 PASS.
  이 중 k3/k4/TICK PASS는 미연결 차트 안내 검증이며 차트 데이터 PASS가 아니다.
- shell 회귀: 개발1440/690/344 및 일반1440, 총4구성 PASS.
- 지정 커밋의 기존 CI 실패는 details 래퍼를 고려하지 않은 직접 자식 selector와 접힌 거시경제 버튼 접근 가정.
  해당 테스트만 의도된 접기 UI에 맞게 수정했다.
- 긴 연속 클릭 캡처 세션에서 CL 차트 시간초과 후 후속6건도 실패했다.
  이 세션의 HTTP 상태를 확보하지 못해 직접 원인을 확정하지 않았다(합성 중계120/IP/분 제한 가능성).
  이전 요청과 분리한 지표 전용 세션은 55응답 모두200이며 19검사 PASS였다.
  장시간 대량 클릭 스트레스 안정성까지 PASS로 확대하지 않는다.
- 실제 로그인·새로고침 세션·시세 수신의 상시 중계 종단 검증: NOT_RUN(사용자 인증 없음).
- 실제 NH·주문·계좌 저장·유료AI 호출0, 운영 변경0.

명령:
```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_global_market_review.py
# 확보한 공개 데이터만 재생, 합성 로그인. 서비스 실제 인증 검증 아님:
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_global_market_review.py --widths 1440 --public-fixture /tmp/myinvest-global-review/feeds.json --all-indicators --indicators-only
```

테스트 URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/market

## 직접 공급자 응답 증거 (공개 데이터)

| 심볼 | HTTP | 관측 UTC (공급자) | 3개월 일봉수 |
|---|---|---|---|
| ^KS11 | 200 | 2026-11-17T06:32:50+00:00 | 62 |
| ^KQ11 | 200 | 2026-11-17T06:33:00+00:00 | 62 |
| ^GSPC | 200 | 2026-11-16T22:22:10+00:00 | 65 |
| ^IXIC | 200 | 2026-11-16T22:15:59+00:00 | 65 |
| ^DJI | 200 | 2026-11-16T22:28:10+00:00 | 65 |
| ^SOX | 200 | 2026-11-16T22:15:59+00:00 | 65 |
| ^VIX | 200 | 2026-11-17T11:02:16+00:00 | 67 |
| KRW=X | 200 | 2026-11-17T11:17:13+00:00 | 67 |
| ^TNX | 200 | 2026-11-16T19:59:53+00:00 | 65 |
| ^IRX | 200 | 2026-11-16T19:59:53+00:00 | 65 |
| GC=F | 200 | 2026-11-17T11:07:16+00:00 | 66 |
| CL=F | 200 | 2026-11-17T11:07:13+00:00 | 66 |
| NQ=F | 200 | 2026-11-17T11:07:19+00:00 | 66 |
| ES=F | 200 | 2026-11-17T11:07:17+00:00 | 66 |
| YM=F | 200 | 2026-11-17T11:07:17+00:00 | 66 |
