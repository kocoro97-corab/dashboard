# 시장 기능 정상화 점검 (2026-11-16)

전체 상태: PARTIAL. 운영 GAS/Sheets/Calendar/계좌 저장자료/주문/AI 제공자에는 쓰거나 호출하지 않았다.
기존 PR #7과 feat/nh-integration-v2를 유지한다. ChatGPT 커밋 5964def1/f0e1172 포함.

## 기능 상태

| 기능 | 상태 | 근거 및 남은 항목 |
|---|---|---|
| 8개 메뉴·1440/690/344px·로그아웃 | PASS (합성) | 48개 점검, 화면 넘침·브라우저 오류 없음. 별도 shell 회귀 4개 구성 PASS |
| 시장 지표 카드 방향 색상 | PASS (합성) | 상승 #ff7777, 하락 #79b8ff, 보합 #e7eef9 확인 |
| 전체 화면 색상 통일 | FAIL | 아래 UI 인계 항목 존재. 카드 색상만으로 전체 PASS 처리하지 않음 |
| 국내 테마 수집 | PASS (공급자 직접 읽기 및 응답 재생) / NOT_RUN (새 Worker 실사용) | 구 목록 API 404. 검증한 mobile groups API 및 구성종목으로 기존 수집기 연결. Worker 갱신 필요 |
| 미국 전체 섹터·5/20일 강도·산업 추천 | NOT_IMPLEMENTED | page-sectors.js가 명시적으로 미연결 표시. 수집기·시계열·추천 엔진 없음 |
| 뉴스 | PASS (공급자 직접 읽기 및 응답 재생) / NOT_RUN (로그인 후 실제 Worker) | Google RSS 2개 각 100건 수신, 화면 각6건. 원본 뉴스 수집/렌더 유지 |
| 삼성전자·AAPL 분석 | PASS (실제 공개 OHLCV 응답 재생) / NOT_RUN (로그인 후 실제 Worker) | 244/251봉, KRW/USD, 종가·MA20 독립 비교 일치 |
| 실제 AI 모델·시장 국면·AI 투자전략 | NOT_IMPLEMENTED | 종목 화면은 MA/RSI 계산. 모델 제공자 연결 없음. 모델 분석 완료로 기록하지 않음 |
| 코스닥150 선물 k4 | FAIL (미연결), 상품·만기 실검증 NOT_RUN | 아래 경로 참조. 타 지수/현물/합성값으로 채우지 않음 |

## 확인한 원인과 최소 수정

- `stock.naver.com/api/domestic/market/theme/list?...` HTTP404/JSON.
- `m.stock.naver.com/api/stocks/theme?page=1&pageSize=100` HTTP200/JSON `{groups:[...]}`.
- 목록에서 받은 12개 실제 no만 사용해 `/api/stocks/theme/{no}?page=1&pageSize=100` 조회: 모두200, `{stocks:[...]}`.
- `js/themes.js`: 기존 parseTheme/parseStock/강도/캐시/화면 재사용. 새 목록 URL 및 groups 인식만 추가.
  실패 후 분석중 문구를 종료하고 이전 자료 유지 여부 표시. 상승 후보가 실제로 없으면 이전 순위 제거.
- `js/app-shell.js`: renderThemes 완료도 기존 context 갱신에 전달. 기존 테마 갱신 버튼으로 새 V2 순위까지 즉시 반영.
- `relay/market_routes.py`, `relay/worker/worker.mjs`: 새 목록 경로 한 개, page=1/pageSize=100만 허용.
  사용자 인증·출처·크기·주문 차단 유지. 임의 쿼리·다른 페이지·다른 크기·내부 URL 차단 검증.
- `js/transport.js`, `js/market.js`: 공개 읽기 실패의 허용된 코드·HTTP 상태·공급자 분류만 기존 진단 창에 기록.
  원문 응답·토큰·전체 요청 URL·계좌자료 기록 없음. 뉴스/분석이 빈 경우 이제 진단 창에서 경계 실패 구분 가능.
- 브라우저 테스트는 공개 고정 설정과 임시 중계 합성 설정을 명시적으로 분리했다. 실제 게시 빌드는 기존 고정 설정을 사용한다.

## k4 경로와 연결하지 않은 이유

`js/data.js DEF.KR[k4] m:1` → `NHF.k4=A06` → `market.js fillNH/nhQuotes` →
`gas/Nhplug.gs handleNhQuotes/nhFutQuote_` → NH `/krfuture/quote/v1/day`.
개발용 `js/dev_market.js`는 fillNH를 비활성화하며 현재 Worker 허용 목록에 nhQuotes가 없다.
공개 Daum 경로는 k3 한 개만 있고, k4의 검증된 공개 식별자가 없다.
기존 NH 코드의 A06+달력 기반 분기월 생성은 공식 상품·거래소·현재 만기 검증 증거가 아니다.
따라서 nhQuotes를 무작정 열거나 생성한 코드를 유효 상품으로 게시하지 않았다.
k4의 현재가/전일비/등락률/관측시각/상품마스터/만기/OHLCV/연속선물 조정방식은 미검증이다.
상품마스터와 공식 API 스키마로 실재 만기물을 확인한 뒤 해당 조회 전용 경로만 연결해야 한다.
개별 만기물과 연속선물은 다른 자료이며 현재 연속선물 시계열 수집기는 미구현이다.

## 데이터·캐시·갱신

- 테마: 최초 페이지 진입·명시적 갱신, 메모리10분 캐시. force는 THM_AT=0.
- 뉴스: 최초 진입·현재 페이지 갱신, 기존 RSS 중복 제거/게시시각 정렬/원문 링크. 종목별 개인화 피드는 아직 외부 검색 링크.
- 종목 분석: 직접 검색 시 Yahoo1y 일봉; 심볼·통화·봉 검증 후 단순 MA/RSI. 메모리 결과만 유지.
- 미국 섹터·장기 테마·자동추천: 데이터와 캐시·갱신 수집기 자체가 없음.
- 실제 OHLCV 마지막 봉: 삼성전자 2026-11-16T00:00:00Z, AAPL 2026-11-13T14:30:00Z.
  관측/마지막 봉과 수신시각을 구분하며 실시간으로 오인하지 않는다.

## ChatGPT UI·분석 수정 인계

1440/690/344px 모두 같은 문제. 실제 계좌자료가 아닌 합성 계좌로 캡처했다.
캡처 경로는 `/workspace/output/market-feature-review/`, 최종 손실 막대 확대 캡처는
`/workspace/output/market-feature-review-final/1440-accounts-profit.png`.

| 항목 | 파일·선택자 | 재현 및 요청 |
|---|---|---|
| C-M01 | js/page-sectors.js renderRanks/detail; .stv2-card p, .stv2-table td:nth-child(2) | 테마 수신 후 양/음 등락률을 표시해도 방향 class가 없어 중립색. 수치 노드를 분리해 rise/fall/flat class 부여 |
| C-M02 | js/page-stocks.js display/renderHolding; .sva-card h3 (직전 봉 대비) | 정상 종목 검색 후 양의 변화율이 #e7eef9. 계좌 평단 대비 수익률도 동일. 기본 계산 재작성 없이 방향 class 부여 |
| C-M03 | js/page-accounts.js portfolioVisuals; .pv-fill, .pv-fill.negative | .negative 배경 #e58b8b(빨강), 기본 이익 막대 #69a7e9(파랑). CSS color만 덮는 공통 규칙으로 background는 바뀌지 않음. profit모드에만 명시적 방향 class/background 적용; 평가액/비중 막대를 손익색으로 오염시키지 말 것 |
| C-M04 | js/page-accounts.js .pv-kpi strong, 요약·상세표 및 page-strategy.js 수익률 노드 | -100원/-9.09%가 중립색. 손익·수익률에만 방향 class 적용하고 값누락은 보합으로 치환하지 말 것 |
| C-M05 | js/chart.js drawQ, js/page-market.js openChart 캔들 | 소스상 >= 비교가 보합도 상승색으로 처리. 보합봉과 팝업/레거시 .up/.down의 공통 토큰 적용 범위 점검 필요. 이 항목의 보합봉 별도 화면 실검증은 NOT_RUN |

시장 국면·산업 추천·AI 투자전략·미국 전체 섹터와 장기 강도는 UI 오류와 구분한 신규 분석 개발 과제다.
실제 AI 모델 호출/비용/근거 계약 없이는 완료 표시하지 말 것.

## 관련 검증만 수행

- Node: Worker14, transport20, dev-market7, themes-runtime2, work-ai-analysis3 = 46 PASS.
- Python: market-relay10, worker-policy3, public-dev14 = 27 PASS.
- 화면: 1440/690/344 합성48개 PASS, 실제 공개 응답 재생16개 PASS.
- 변경된 shell 회귀: 개발1440/690/344 + 일반1440 = 4구성 PASS.
- UI 결함은 위 별도 FAIL 인계. 기능 렌더 PASS가 색상 전체 PASS를 뜻하지 않는다.
- 실제 브라우저 로그인/새 테마 경로의 배포 Worker 통과: 사용자 인증·소유자 Worker 갱신이 필요해 NOT_RUN.
- 운영 변경0, 실제 NH/주문/계좌저장/유료 AI 호출0.

## 소유자 Worker 갱신 후 남은 확인

소유자 Cloud Shell 외에는 Cloudflare 배포 토큰이 없다. 코드 검토·게시까지 진행하고,
기존 승인된 소유자 CLI로 Worker만 갱신해야 새 목록 경로가 실제 허용된다.
새 프로젝트·권한 확대·운영 GAS 반영은 하지 않는다.

```bash
cd "$HOME/myinvest-v2-live" &&
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only FETCH_HEAD &&
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_persistent.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --free-plan-confirmed --prompt-token
```

페이지: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/sectors
갱신 후 산업·테마 → 현재 페이지 갱신, 뉴스·이벤트 → 현재 페이지 갱신,
종목 분석 → 005930/AAPL 검색. 여전히 비면 설정·진단 → 연결 진단의 공급자별
허용된 코드만 공유. 비밀번호·토큰·실계좌 화면은 공유하지 않는다.
