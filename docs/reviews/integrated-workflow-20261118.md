# MY INVEST V2 고밀도 UI·종목분석·전략 통합 검증

2026-11-18 KST. 작업 상태 **PARTIAL**. 소스는 기존 `feat/nh-integration-v2`, 게시 대상은 기존 `dashboard-v2-dev/dev-pages`만 사용한다. 사용자 최신 지시서의 실제 UI·분석 개발 요구에 따라 기존 모듈을 확장했다. 운영 브랜치·GAS·Sheets·Properties·인증정보·실계좌 저장자료 변경과 주문 호출은 없다.

## 구현 범위

| 파일 | 변경 |
|---|---|
| `css/dashboard-dense.css`, `js/dashboard-presentation.js` | 공통 간격·헤더·표·숫자 표시, 1440/690/344 및 배율별 재배치, 모바일 도구 메뉴 |
| `js/instrument-names.js`, `data/us-instruments.json` | 공식 상장 마스터·검증된 한국어 이름, ETF 구분, 모호한 이름의 직접 티커 선택, 실패 시 티커·미확인 |
| `js/invest-workflow.js` | 공통 테마/보유/직접 검색 선택기, 기존 선택 키 재사용, 1시간 TTL, 공개 메타데이터만 저장, 분석 캐시·진행 요청 중복 방지·로그아웃 무효화 |
| `js/page-sectors.js`, `js/themes.js` | 중복 관심종목 UI 제거, 국내 상세 기간 조회, 미국 일반종목 6개 테마·30종목 표본, 1/5/20/60일·상대강도·관측값·보유 표기·분석 이동 |
| `js/page-stocks.js` | 기존 OHLCV 계산 재사용, 공통 선택·근거/조건부 판단, 상하단 전략 버튼, 늦은 이전 응답 무효화 |
| `js/page-news.js` | 늦게 끝난 뉴스 갱신이 입력 중인 수동 일정 폼을 초기화하지 않도록 최소 수정. Calendar API·저장 로직 변경 없음 |
| `js/page-strategy.js` | 동일 종목·모드·기준 데이터 연결, 20봉 고점/MA20·저점의 조건부 진입/손절과 1R/2R 목표, 기존 수량/자본·위험 계산기 유지 |
| `js/read-status.js`, `js/transport.js` | 민감정보 없는 단계/HTTP/코드/시간/요청ID/유형·재연결, 일시적 공개 읽기 최대 1회 재시도, 공개/계좌 오류 분리, 계좌/인증/저장 재시도 없음 |
| `js/market.js`, `js/page-market.js` | 요청한 k4가 NH 수집 조건에 포함되도록 수정, 검증 NH 결과를 NQ→Q로 전달, 9개 핵심 지표와 TICK 참고 위젯 유지 |
| `gas/Nhplug.gs` | 소스만 수정: 공식 9자리 요청/8자리 응답 형식, 상품·계약·만기·확장 부호 검증. 운영/격리 GAS 모두 이번 환경에서 배포하지 않음 |
| `relay/worker/worker.mjs`, `js/dev_connect.js`, `js/dev_market.js`, `tools/nh_v2_persistent.py` | 소스만 수정: 기존 인증·격리 검사 뒤 고정 A01/A06 선물 읽기 선택적 허용, 기본 차단 유지. 실제 Worker 변경하지 않음 |
| `tools/refresh_public_reference.py`, `tools/workflows/refresh-public-reference.yml` | 기존 무료 공식 자료 갱신 도구와 수동 실행 워크플로. 운영 자동 배포나 신규 인증 없음 |

## 데이터 및 판단 경계

- 국내 종목의 거래소는 기존 검증 마스터로 `.KS/.KQ`를 결정한다. 미국은 공식 NasdaqTrader 상장 목록 12,851건과 기존 공개 시세의 심볼·통화·거래소 검증을 사용한다. 한국어 이름은 Naver 미국 종목 응답에서 검증한 31건이며 나머지는 영문명으로 표시한다.
- 미국 테마는 ARK 공식 운용자료의 미국 상장 **일반종목 표본**이다. 전체 미국 산업·테마 순위가 아니다. 섹터 ETF 수익률과 일반종목 테마 수익률을 분리한다.
- 현재가에 관측시각이 없으면 미확인. 일봉 종가·공통 관측일 수익률과 실시간 현재가를 구분한다. 거래대금이 없는 미국 종목에 추정 거래대금을 만들지 않는다.
- 기술 조건의 규칙 기반 분류이며 실제 AI 모델 호출/성공 확률이 아니다. 시장 방향 관측시각·테마가 미확인되면 매수 후보 조건을 충족시키지 않는다.
- 60개 유효 일봉·최근 기준시각이 없으면 판단 불가. 일봉만으로 단타 진입·손절·목표 신호를 생성하지 않는다. 스윙 목표는 관측 저점 기준 위험폭의 1R/2R 계산으로 예측 가격이 아니다.
- 계좌별 보유 수량·평단은 기존 세션 귀속 자료에서 읽으며 새 선택 상태·URL·오류 로그에 저장하지 않는다. 미수신을 미보유로 단정하지 않는다. 서로 다른 통화·거래소의 가격 비교는 제외한다.
- 실적·기관 수급·분봉·호가·실시간 체결·AI 추천은 미연결/미구현이다.

## 검증 증거

| 검증 | 결과/범위 |
|---|---|
| JS 문법 | 44개 파일 PASS |
| Node | 선택/판단/1R·2R/세션 정리, 오류 분류·재시도, NH 계약, 기존 transport/Worker/NH 경계·시장·기간 계산 관련 11개 테스트 파일 PASS |
| Python | Worker 정책 3, 공개 개발 격리 14, 상시 중계 11, 공개 참조 자료 3 PASS |
| 전체 밀도 | 13화면×3폭×1/1.25/1.5 viewport/DPR 117 PASS; 가로 넘침 없음. 물리 Fold6·브라우저 네이티브 배율 조작 자체는 NOT_RUN |
| 신규 통합 | 1440/690/344, 5경로씩 15 PASS: KR·US 테마→분석→전략→복귀, 모드/새로고침 유지, 요청 역전, 계좌별 평단, 오류/로그아웃·저장/주문 0 |
| 테마 회귀 | 관련 12 PASS. 기준지수 마지막 봉 누락 시 공통 거래일 사용, 5/20/60일, ETF 응답 거부, KST 경계 |
| 이름 | PC/Fold 접힘 PASS: 애플→AAPL, Alphabet→GOOG/GOOGL 구분 선택, SPY ETF, 알 수 없는 티커 |
| 실제 응답 재생 | 새 6개 테마·30종목+SPY HTTP 200, PC/344px 1/5/20/60일 수익률·상대강도 대조 2 PASS. 모의 로그인으로 실제 응답을 재생한 결과이며 실제 중계 로그인 검증 아님 |
| 실제 공개 API | 공급자 직접 AAPL USD/NMS 251봉, 삼성전자 KRW/KSC 245봉 HTTP 200. 로그인·중계 경유 증명은 아님 |
| 상시 중계 | 이 작업 환경의 appVersion 확인 1회 HTTP 403. 실패 서버를 HTTP만으로 특정하지 않으며 과거 502 조사/서버 복구/반복 검사는 수행하지 않음 |
| TICK | 공급자 iframe HTTP 200·실제 차트/장 종료 표시 확인. 부모 카드의 수치 API·실시간 관측시각은 미검증 |
| KOSDAQ150 선물 | 요청 경로·형식·상품 계약 검증은 모의 PASS, 실제 NH 응답·최종 카드 표시는 NOT_RUN. 연결 완료 아님 |

재현 가능한 명령:

```sh
node --test tests/invest-workflow.test.cjs tests/read-status.test.cjs tests/nh-futures-contract.test.cjs tests/worker-relay.test.cjs tests/transport.test.cjs tests/market-transport.test.cjs tests/nh-request-boundary.test.cjs tests/dev-market.test.cjs tests/market-context.test.cjs tests/sector-series-runtime.test.cjs tests/instrument-names.test.cjs
python3 -m unittest discover -s tests -p 'test_worker_policy.py'
python3 -m unittest discover -s tests -p 'test_public_dev.py'
python3 -m unittest discover -s tests -p 'test_persistent*.py'
python3 -m unittest discover -s tests -p 'test_public_reference.py'
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_invest_workflow.py
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_dense_review.py --output /workspace/output/dense-integration-final
```

모의 인증·시세·보유자료 검증과 실제 공개 응답 재생은 분리한다. 실제 소유자 로그인·실제 NH·저장·복구·주문 호출은 이번 검증에 포함하지 않는다. 이전 테스트에서 실패했던 오래된 시계/확장 전 19종목 응답 자료는 최종 PASS 근거로 사용하지 않는다.

## KOSDAQ150 선물 남은 연결 작업 — 다음 담당 Codex

1. 이번 수정의 두 원인: 요청된 k4가 수집 실행 조건에 누락됨; NH 수신 결과가 NQ에만 남고 V2가 읽는 Q에 전달되지 않음. 공식 N2 PLUG day 명세의 요청 `iem_cd`는 9자(`KA0169000` 예시), 응답은 8자다.
2. 기존 소유자 환경에서 **격리 테스트 GAS만** 현재 `Nhplug.gs` 수정분을 적용하고 기존 격리 증명 메타데이터를 갱신해야 한다. 이 환경에는 소유자 배포 환경 파일·Cloudflare 토큰·로그인 세션이 없다. 운영 GAS를 가져오거나 대체 프로젝트를 만들지 않는다.
3. 기존 상시 중계 배포 도구의 `--public-futures`는 A01/A06 두 상품 시세 읽기만 활성화한다. 기존 격리 증명/소유자 인증/세션/주문 차단을 유지한다. UI에서 임의 활성화할 수 없다. 기존 승인된 배포 절차에서만 사용한다.
4. 실제 응답의 상품명·계약코드·만기·가격·대비·수신시각을 확인한 뒤 카드 PASS 판정. `bsop_hour`만으로 날짜가 포함된 관측시각을 만들지 않는다.
5. NH선물 `prd=06`은 N2 PLUG 코드가 아니다. 공식 REST SDK 문서상 별도 인증이 필요하여 새 계정·계약을 만들지 않았다. 코스콤/KIS도 기존 인증 부재 상태에서 임의 연결하지 않는다.

개발 URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/sectors
공유 URL에 인증 토큰·계좌 자료·임의 쿼리 파라미터를 넣지 않는다.

기존 뉴스 캘린더의 Escape 닫기/포커스 복귀는 미구현으로 남는다. 별도 UI 보완 대상이다. 수동 일정 입력 중 뉴스 갱신으로 폼이 지워지는 문제를 재현하여 갱신 종료 시 일정 폼의 불필요한 재생성만 제거했다.
