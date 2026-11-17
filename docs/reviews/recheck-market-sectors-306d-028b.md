# 글로벌시장 UI / 산업·테마 통합 재검증 (2026-11-17)

대상: feat/nh-integration-v2, 기존 PR #7.
- 306d2e056b2b8872222e6401216032b7a43df6ab
- 028b527e9a9699da94cc9ae7927a277918564a7a

전체 상태 PARTIAL: 두 UI의 합성 검증 PASS, 실제 배포 테마 경로 FAIL.
기존 정상 UI/집계/인증/중계/GAS/계좌 저장 코드는 이번에 재작성하지 않았다.
실제 주문·NH·저장·AI 호출과 운영 설정 변경은 0이다.

## 결과

| 항목 | 상태 | 근거 |
|---|---|---|
| 미국장 카드/버튼 문구 유지 | PASS (합성) | 미국장 전환 → 산업·테마 → 시장 복귀, 두 상태 모두 미국장. 1440/690/344px |
| 출처·관측·수신 시각 | PASS (합성) | 서로 한 시간 다른 두 타임스탬프가 각 관측/수신으로 표시. 출처 Yahoo 확인 |
| 관측시각 없음·잘못된 문자열 | PASS (합성) | 관측시각 미확인, 수신시각은 유지. 현재 시각으로 채우지 않음 |
| 금리·금·WTI·미국/국내 선물 단위 | PASS (합성 표시) | 금리 %, 금 USD/트로이온스, WTI USD/배럴, 미 선물 연속선물/롤 조정 미확인, 국내 계약/만기 미확인 |
| 기존 수집·직렬화·선물 어댑터 | PASS (합성 회귀19) | 추가 심볼 요청, 종목 집합 캐시/직렬화, 로그아웃 취소, FQ→Q.k3, 심볼 검증 유지 |
| 국내 테마 최초 진입 | PASS (합성) | 최초 list 요청1회, 중복 수집 없음, 테마2개 및 관측 요약 표시 |
| 국내 테마 새로고침 | PASS (합성) | 클릭 후 list 누적2회. 새로고침당 목록 조회1회 |
| 강도·상승/하락/보합·상승비율 | PASS (합성 독립 비교) | A: 강도35, 상승1/하락1/보합1, 33.3%; B: 강도45, 상승2/하락1/보합0, 66.7% |
| 후보 정렬·중복 제거·종목명 | PASS (합성) | 거래대금500/400/300/200/100 내림차순. 두 테마에 중복된005930은 한 번만 표시. 이름과 코드 확인 |
| 후보→종목분석 | PASS (합성) | 첫 후보 KCC글라스(344820) 실제 버튼 클릭 → #/stocks → 344820.KS 일봉 요청 → 분석 완료/종목명 표시 |
| PC1440 / Fold690 / Fold344 | PASS (모의 화면) | 가로 페이지 넘침·스크립트 오류 없음. 표의 모바일 가로 스크롤과 팝업 세로 스크롤 유지 |
| 실제 Fold6 기기 | NOT_RUN | 모의 viewport 검증과 구분 |
| 미국 섹터·5/20일 시계열·스윙 추천 | NOT_IMPLEMENTED | 미국 실제 순위 미표시. 기간별 자료 없음 안내. 스윙은 당일 관찰이며 추천 아님 명시 |
| 실제 배포 중계의 국내 테마 목록 | FAIL | 아래 실제 증거. UI를 배포해도 중계 동기화 전 실제 테마 수신은 해결되지 않음 |
| 실제 사용자 로그인 후 새 UI 종단 검증 | NOT_RUN | 소유자 사용자 인증정보/세션 없음. 합성 PASS로 대체하지 않음 |

국내 선물 단위 검증은 표시 계약의 검증이다. 실제 KOSDAQ150 시세·만기를 검증했다는 뜻이 아니다.
테마 거래대금은 원천 단위 확인 필요 문구를 유지한다. 전체 시장 순위/순매수/AI 추천으로 표시하지 않는다.

## 실제 중계 실패 증거

2026-11-17, 기존 개발 Worker:
`https://myinvest-v2-dev-relay.kocoro97.workers.dev/api`

기존 허용 예정 목록의 URL:
`https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100`

알려진 무효 합성 토큰으로 요청 검증 단계만 확인했다. 실제 토큰·계좌정보는 사용/출력하지 않았다.
결과: HTTP403 / JSON / RELAY_PUBLIC_URL_DENIED.
이는 현재 배포본이 해당 경로를 URL 검증 단계에서 차단한다는 증거다.
현재 저장소의 Worker에는 기존 승인된 이 정확한 경로가 이미 포함되어 있다.
새 URL을 추가한 것이 아니라 이전 테마 수정의 개발 Worker 반영이 필요한 상태다.

이번 지시는 중계 변경을 금지하므로 Worker 코드·설정·권한·배포를 바꾸지 않았다.
실제 로그인 인증 후 데이터 수신이나 인증 성공으로 기록하지 않는다.

## 기존 CI 실패와 테스트 수정

CI44081535004는 `.sva h3`의 이전 `035720 · 기술적 분석` 문구를 찾다가 실패했다.
기존 종목명 표시 커밋 이후 제목은 `종목명 (035720) · 기술적 분석` 또는
`035720 · 종목명 미확인 · 기술적 분석`이다. UI 연결 실패가 아니라 기존 선택자의 계약 불일치였다.

- `browser_review_selectors.py`: 정확한 코드 경계를 유지하는 제목/관심표 선택자.
- 기존 보유/관심 행 검증은 새 후보 표를 제외한 관심표로 범위를 한정.
- `browser_work_handoff.py`, `browser_commit_review.py`: 위 선택자를 사용.
- 잘못된 심볼/통화, 미래·역순·중복 봉, 응답 역전·늦은 응답·로그아웃 검사는 그대로 유지.
- `browser_commit_review.py --only`로 이번 관련 SECTOR_/STOCK_/ROUTE_만 실행 가능하게 함.
- 새 42개 UI 검사를 기존 PR CI의 합성 브라우저 단계에 추가. 운영 배포 workflow는 변경하지 않음.

## 수행한 관련 검증

- 신규 UI42 PASS: 시장18 + 산업·테마24, 3개 viewport.
- 기존 관련 Node19 PASS: market-transport7, market-context3, dev-market7, themes-runtime2.
- 제목/관심표 선택자 수정 후 관련 식별자/응답/정리 회귀78 PASS.
- 인계 연결 브라우저 1440/344/690: 관련 탐색·분석·오류·정리 PASS.
  기존 Calendar Escape/focus 미구현 발견은 이전부터 있는 별도 항목이며 이번에 변경하지 않음.
- 전체 저장소 테스트/기존 NH 실계좌 검증은 반복 실행하지 않음.

실행:
```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_market_sector_recheck.py
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_commit_review.py --extended --only SECTOR_ STOCK_ ROUTE_
```

증거:
- `/workspace/output/market-sector-recheck/results.json`
- `/workspace/output/market-sector-recheck/344-market-provenance.png`
- `/workspace/output/market-sector-recheck/344-market-units.png`
- `/workspace/output/market-sector-recheck/344-sectors-leaders.png`
- `/workspace/output/market-sector-identity-recheck/`

URL:
- https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/market
- https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/sectors

## 다음 개발 대상과 담당

다음 우선순위: 기존 국내 테마 경로의 개발 Worker 배포 동기화 및 실제 사용자 로그인 후 수신 확인.
담당 Codex, 소유자 Cloud Shell 인증이 필요한 작업. 이번 검증 범위에서는 수행하지 않는다.
새 계정/프로젝트/권한 확대 없이 기존 격리 GAS와 Worker를 유지해야 한다.
ChatGPT의 G-UI01~03 보완은 이번 합성 재검증에서 해결됐다. 이전 색상 C-M01~05와 미구현 미국/장기 섹터는 별도 후순위로 남는다.
